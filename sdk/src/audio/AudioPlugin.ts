// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import type { Entity, Vec3 } from '../types';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Audio, AudioAPI, setAudioHostSuspended } from './Audio';
import { AudioSource, AudioListener, type AudioSourceData, type AudioListenerData } from './AudioComponents';
import { WorldTransform, type WorldTransformData } from '../ecs/component';
import { getPlatform, isPlatformInitialized, platformCreateAudioBackend, platformOnMemoryWarning } from '../platform/base';
import { q } from '../math/quat';
import { calculateAttenuation, calculatePanning, spatialDistance, type SpatialAudioConfig, AttenuationModel } from './SpatialAudio';
import type { AudioHandle } from './PlatformAudioBackend';
import { isEditor, isPlayMode } from '../ecs/env';
import { log } from '../util/logger';
import { Assets } from '../asset/AssetPlugin';
import { SoundEvents, SoundEventPlayback } from './SoundEventPlayback';
import { disposeAll } from '../util/disposeAll';
import { SoundEventSourceController } from './SoundEventSource';

/**
 * Where a transform IS, which for a parented entity is not where it says it is:
 * `position` is the offset from its parent, and a footstep loop under a walking
 * character would stay at the character's origin forever. The engine derives the
 * world fields; the fallback is for a world running without them.
 */
function worldPositionOf(t: WorldTransformData): Vec3 {
    return t.worldPosition ?? t.position;
}

/**
 * The voice a source currently has, and the clip it is a play OF. A source whose
 * clip changed is no longer described by the sound in flight, and telling them
 * apart is what lets one AudioSource play a second sound.
 */
interface ActiveVoice {
    handle: AudioHandle;
    completedNaturally: boolean;
    clip: string;
    volume: number;
    pitch: number;
    loop: boolean;
    spatial: boolean;
    /** How far up it is, 0..1: below 1 while it comes in or goes out. What the voice is given is the source's volume times this. */
    fade: number;
    /** Its source lowered `playing` and it is going down over the source's fadeOut; it stops at nothing. */
    leaving: boolean;
}

interface AudioPluginState {
    activeSourceHandles: Map<number, ActiveVoice>;
    playedEntities: Set<number>;
    audio: AudioAPI;
    events: SoundEventPlayback;
    eventSources: SoundEventSourceController;
    offCoreDisconnect: () => void;
    released: boolean;
    offMemoryWarning: () => void;
    offAudioMute: () => void;
    offExecution: () => void;
    offDespawn: () => void;
}

export interface AudioPluginConfig {
    initialPoolSize?: number;
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
}

export class AudioPlugin implements Plugin {
    name = 'audio';
    private config_: AudioPluginConfig;
    private readonly states_ = new WeakMap<App, AudioPluginState>();
    private latestState_: AudioPluginState | null = null;

    constructor(config: AudioPluginConfig = {}) {
        this.config_ = config;
    }

    build(app: App): void {
        this.cleanup(app);
        const backend = platformCreateAudioBackend();
        const config = this.config_;

        backend.initialize({ initialPoolSize: config.initialPoolSize }).catch(err => {
            log.warn('audio', 'backend initialization failed', err);
        });

        const mixer = backend.mixer;
        const audio = new AudioAPI(backend, mixer);
        app.insertResource(Audio, audio);
        const events = new SoundEventPlayback(audio,
            () => app.hasResource(Assets) ? app.getResource(Assets) : null,
            owner => app.world.valid(owner) && (app.world.getCppRegistry()?.valid(owner) ?? true),
            owner => app.world.has(owner, WorldTransform) ? worldPositionOf(app.world.get(owner, WorldTransform)) : null);
        app.insertResource(SoundEvents, events);
        const eventSources = new SoundEventSourceController(app.world, events, audio);
        const offCoreDisconnect = app.world.onCoreDisconnect(() => {
            disposeAll([() => eventSources.reset(), () => events.resetOwners()], action => action());
        });
        const muteOwner = {};
        const offAudioMute = (isPlatformInitialized()
            ? getPlatform().onAudioMute?.(muted => setAudioHostSuspended(audio, muteOwner, muted))
            : undefined) ?? (() => {});
        const executionOwner = {};
        const offExecution = app.onExecutionChange(held => setAudioHostSuspended(audio, executionOwner, held));

        // OS memory pressure → drop the decoded-buffer warm cache. Held
        // buffers keep playing; re-fetch cost returns only for evicted ones.
        const offMemoryWarning = platformOnMemoryWarning(() => {
            const freed = audio.trimBufferCache();
            if (freed > 0) log.info('audio', `memory warning: trimmed ${freed} cached buffer(s)`);
        });

        if (mixer) {
            if (config.masterVolume !== undefined) mixer.master.volume = config.masterVolume;
            if (config.musicVolume !== undefined) mixer.music.volume = config.musicVolume;
            if (config.sfxVolume !== undefined) mixer.sfx.volume = config.sfxVolume;
        }

        const activeSourceHandles = new Map<number, ActiveVoice>();
        const playedEntities = new Set<number>();

        const offDespawn = app.world.onDespawn((entity: Entity) => {
            const voice = activeSourceHandles.get(entity);
            activeSourceHandles.delete(entity); playedEntities.delete(entity);
            disposeAll([() => eventSources.remove(entity), () => events.stopOwner(entity), () => voice?.handle.stop()], action => action());
        });
        const state = { activeSourceHandles, playedEntities, audio, events, eventSources, offCoreDisconnect, offMemoryWarning, offAudioMute, offExecution, offDespawn, released: false };
        this.states_.set(app, state);
        this.latestState_ = state;
        const stopVoice = (id: number): void => {
            const voice = activeSourceHandles.get(id);
            if (!voice) return;
            voice.handle.stop();
            activeSourceHandles.delete(id);
        };
        const liveEntities = new Set<number>();
        /** Clips an authored playOnAwake is waiting on, and ones that will never arrive. */
        const loadingClips = new Set<string>();
        const unplayableClips = new Set<string>();
        let spatialListenerWarned = false;
        let wasPlayMode = false;

        app.addSystemToSchedule(
            Schedule.PreUpdate,
            defineSystem(
                [Res(Time), Res(Audio)],
                (time: TimeData, audioAPI: AudioAPI) => {
                    if (state.released) return;
                    const playMode = !isEditor() || isPlayMode();

                    if (!playMode) {
                        eventSources.reset();
                        if (wasPlayMode) {
                            spatialListenerWarned = false;
                            wasPlayMode = false;
                        }
                        return;
                    }
                    wasPlayMode = true;

                    // Volume ramps ride the frame, not the browser's rAF: a device
                    // has no such global, and a fade should pause with the game.
                    audioAPI.updateFades(time.delta);
                    audioAPI.updateDucking();

                    const world = app.world;

                    let listenerAt: Vec3 = { x: 0, y: 0, z: 0 };
                    // Which way is the listener's right, for the stereo image. Its own,
                    // not the world's: turn the camera and the room turns with it.
                    let listenerRight: Vec3 = { x: 1, y: 0, z: 0 };
                    let hasListener = false;
                    const listeners = world.getEntitiesWithComponents([AudioListener, WorldTransform]);
                    for (const entity of listeners) {
                        const listener = world.get(entity, AudioListener) as AudioListenerData;
                        if (listener.enabled) {
                            const wt = world.get(entity, WorldTransform) as WorldTransformData;
                            listenerAt = worldPositionOf(wt);
                            listenerRight = q.rotate(wt.worldRotation ?? wt.rotation, { x: 1, y: 0, z: 0 });
                            hasListener = true;
                            break;
                        }
                    }
                    events.update(time.delta, listenerAt, listenerRight);
                    eventSources.update();

                    const sources = world.getEntitiesWithComponents([AudioSource]);
                    liveEntities.clear();

                    for (const entity of sources) {
                        const source = world.get(entity, AudioSource) as AudioSourceData;
                        const id = entity as number;

                        if (!source.enabled) {
                            // Switching a source off has to silence the voice it
                            // already has: dropping the handle alone leaves a sound
                            // playing that nothing can reach any more.
                            stopVoice(id);
                            continue;
                        }
                        if (!source.clip) continue;
                        liveEntities.add(id);

                        // playOnAwake is one trigger expressed through the switch
                        // everything else reads, so a scene that starts a sound and
                        // an FSM hook that starts one take the same path.
                        let playing = source.playing;
                        if (source.playOnAwake && !playedEntities.has(id)) {
                            playedEntities.add(id);
                            if (!playing) {
                                playing = true;
                                world.update(entity, AudioSource, draft => { draft.playing = true; });
                            }
                        }

                        let voice = activeSourceHandles.get(id);
                        // A source that names a different clip now is not the one
                        // this voice is playing, so the voice goes and the raised
                        // flag plays what the source says today.
                        if (voice && voice.clip !== source.clip) {
                            stopVoice(id);
                            voice = undefined;
                        }

                        if (playing && !voice && backend.isReady) {
                            const buffer = audioAPI.getBufferHandle(source.clip);
                            if (buffer) {
                                // Through the API, not straight at the backend: the
                                // voice cap and the soft bus gain are decided there,
                                // and a sound outside that door gets neither.
                                const voice: ActiveVoice = {
                                    clip: source.clip,
                                    volume: source.volume,
                                    pitch: source.pitch,
                                    loop: source.loop,
                                    spatial: source.spatial,
                                    completedNaturally: false,
                                    // Up from nothing where the source asks to come in over a time.
                                    fade: source.fadeIn > 0 ? 0 : 1,
                                    leaving: false,
                                    handle: audioAPI.playBuffer(buffer, {
                                        bus: source.bus,
                                        volume: source.fadeIn > 0 ? 0 : source.volume,
                                        loop: source.loop,
                                        ...(source.loop && source.loopStart > 0 ? { loopStart: source.loopStart } : {}),
                                        playbackRate: source.pitch,
                                        priority: source.priority,
                                    }),
                                };
                                const previousEnd = voice.handle.onEnd;
                                voice.handle.onEnd = () => {
                                    voice.completedNaturally = !voice.loop;
                                    previousEnd?.call(voice.handle);
                                };
                                activeSourceHandles.set(id, voice);
                                // Whoever raised the flag is asking for this clip
                                // from the top, so the latch from the last one goes.
                                if (source.finished) {
                                    world.update(entity, AudioSource, draft => { draft.finished = false; });
                                }
                            } else if (!unplayableClips.has(source.clip)) {
                                // A source asking to play has already said so;
                                // demanding a preload call beside it is a component
                                // that silently does nothing. Unplayed until it lands.
                                if (!loadingClips.has(source.clip)) {
                                    const clip = source.clip;
                                    loadingClips.add(clip);
                                    void audioAPI.preload(clip)
                                        .catch((err) => {
                                            unplayableClips.add(clip);
                                            log.warn('audio', `cannot load clip "${clip}"`, err);
                                        })
                                        .finally(() => loadingClips.delete(clip));
                                }
                            }
                        } else if (!playing && voice) {
                            // Lowered: it goes at once, or down over the time the source gives and then goes.
                            if (source.fadeOut > 0 && voice.handle.isPlaying && voice.fade > 0) voice.leaving = true;
                            else stopVoice(id);
                        } else if (playing && voice && !voice.handle.isPlaying) {
                            // The voice is no longer active. Lowering the flag here is
                            // what makes it readable as "is this sounding" rather
                            // than "was it ever asked to sound".
                            activeSourceHandles.delete(id);
                            world.update(entity, AudioSource, draft => {
                                draft.playing = false;
                                draft.finished = voice.completedNaturally;
                            });
                        }

                        let sounding = activeSourceHandles.get(id);
                        let faded = false;
                        if (sounding) {
                            // Raised again while it was going out: it turns round from where it is.
                            if (playing && sounding.leaving) sounding.leaving = false;
                            const before = sounding.fade;
                            if (sounding.leaving) sounding.fade = Math.max(0, sounding.fade - time.delta / source.fadeOut);
                            else if (sounding.fade < 1) sounding.fade = source.fadeIn > 0 ? Math.min(1, sounding.fade + time.delta / source.fadeIn) : 1;
                            faded = sounding.fade !== before;
                            if (sounding.leaving && sounding.fade <= 0) {
                                stopVoice(id);
                                sounding = undefined;
                            }
                        }
                        if (sounding) {
                            if (sounding.pitch !== source.pitch) sounding.handle.setPlaybackRate(source.pitch);
                            if (sounding.loop !== source.loop) sounding.handle.setLoop(source.loop);
                            if (!source.spatial) {
                                if (sounding.volume !== source.volume || sounding.spatial || faded) sounding.handle.setVolume(source.volume * sounding.fade);
                                if (sounding.spatial) sounding.handle.setPan(0);
                            }
                            sounding.volume = source.volume;
                            sounding.pitch = source.pitch;
                            sounding.loop = source.loop;
                            sounding.spatial = source.spatial;
                        }
                        if (source.spatial && sounding) {
                            if (!hasListener && !spatialListenerWarned) {
                                log.warn('audio', 'spatial audio used but no AudioListener entity found');
                                spatialListenerWarned = true;
                            }

                            const wt = world.tryGet?.(entity, WorldTransform) as WorldTransformData | undefined;
                            const sourceAt: Vec3 = wt ? worldPositionOf(wt) : { x: 0, y: 0, z: 0 };
                            const distance = spatialDistance(sourceAt, listenerAt);

                            const spatialConfig: SpatialAudioConfig = {
                                model: source.attenuationModel as AttenuationModel,
                                refDistance: source.minDistance,
                                maxDistance: source.maxDistance,
                                rolloff: source.rolloff,
                            };

                            const attenuation = calculateAttenuation(distance, spatialConfig);
                            const pan = calculatePanning(sourceAt, listenerAt, listenerRight, source.maxDistance);

                            sounding.handle.setVolume(source.volume * attenuation * sounding.fade);
                            sounding.handle.setPan(pan);
                        }
                    }

                    // Sources the pass above did not reach at all. Their voices are
                    // STOPPED, not just forgotten: a dropped handle is a sound
                    // nothing can reach any more.
                    for (const entityId of activeSourceHandles.keys()) {
                        if (!liveEntities.has(entityId)) stopVoice(entityId);
                    }
                },
                { name: 'AudioUpdateSystem' }
            )
        );
    }

    private stopSources_(state: AudioPluginState): void {
        const voices = [...state.activeSourceHandles.values()];
        state.activeSourceHandles.clear();
        state.playedEntities.clear();
        disposeAll(voices, voice => voice.handle.stop());
    }

    stopAllSources(): void {
        if (this.latestState_) this.stopSources_(this.latestState_);
    }

    cleanup(app?: App): void {
        const state = app ? this.states_.get(app) : this.latestState_;
        if (!state || state.released) return;
        state.released = true;
        if (app) this.states_.delete(app);
        if (state === this.latestState_) this.latestState_ = null;
        disposeAll([state.offAudioMute, state.offExecution, state.offMemoryWarning, state.offDespawn, state.offCoreDisconnect,
            () => state.eventSources.dispose(), () => state.events.dispose(), () => this.stopSources_(state), () => state.audio.dispose()], action => action());
    }
}

export const audioPlugin = new AudioPlugin();
