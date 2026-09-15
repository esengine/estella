// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import type { Entity, Vec3 } from '../types';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Audio, AudioAPI } from './Audio';
import { AudioSource, AudioListener, type AudioSourceData, type AudioListenerData } from './AudioComponents';
import { WorldTransform, type WorldTransformData } from '../ecs/component';
import { platformCreateAudioBackend, platformOnMemoryWarning } from '../platform/base';
import { q } from '../math/quat';
import { calculateAttenuation, calculatePanning, spatialDistance, type SpatialAudioConfig, AttenuationModel } from './SpatialAudio';
import type { AudioHandle } from './PlatformAudioBackend';
import { isEditor, isPlayMode } from '../ecs/env';
import { log } from '../util/logger';

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
    clip: string;
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
    private activeSourceHandles_: Map<number, ActiveVoice> | null = null;
    private playedEntities_: Set<number> | null = null;
    private audio_: AudioAPI | null = null;
    private offMemoryWarning_: (() => void) | null = null;
    private offDespawn_: (() => void) | null = null;

    constructor(config: AudioPluginConfig = {}) {
        this.config_ = config;
    }

    build(app: App): void {
        const backend = platformCreateAudioBackend();
        const config = this.config_;

        backend.initialize({ initialPoolSize: config.initialPoolSize }).catch(err => {
            log.warn('audio', 'backend initialization failed', err);
        });

        const mixer = backend.mixer;
        const audio = new AudioAPI(backend, mixer);
        this.audio_ = audio;
        app.insertResource(Audio, audio);

        // OS memory pressure → drop the decoded-buffer warm cache. Held
        // buffers keep playing; re-fetch cost returns only for evicted ones.
        this.offMemoryWarning_ = platformOnMemoryWarning(() => {
            const freed = audio.trimBufferCache();
            if (freed > 0) log.info('audio', `memory warning: trimmed ${freed} cached buffer(s)`);
        });

        if (mixer) {
            if (config.masterVolume !== undefined) mixer.master.volume = config.masterVolume;
            if (config.musicVolume !== undefined) mixer.music.volume = config.musicVolume;
            if (config.sfxVolume !== undefined) mixer.sfx.volume = config.sfxVolume;
        }

        const activeSourceHandles = new Map<number, ActiveVoice>();
        this.activeSourceHandles_ = activeSourceHandles;
        const playedEntities = new Set<number>();
        this.playedEntities_ = playedEntities;

        this.offDespawn_ = app.world.onDespawn((entity: Entity) => {
            const voice = activeSourceHandles.get(entity);
            if (voice) {
                voice.handle.stop();
                activeSourceHandles.delete(entity);
            }
            playedEntities.delete(entity);
        });
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
                    const playMode = !isEditor() || isPlayMode();

                    if (!playMode) {
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
                                activeSourceHandles.set(id, {
                                    clip: source.clip,
                                    handle: audioAPI.playBuffer(buffer, {
                                        bus: source.bus,
                                        volume: source.volume,
                                        loop: source.loop,
                                        playbackRate: source.pitch,
                                        priority: source.priority,
                                    }),
                                });
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
                            stopVoice(id);
                        } else if (playing && voice && !voice.handle.isPlaying) {
                            // The voice ended by itself. Lowering the flag here is
                            // what makes it readable as "is this sounding" rather
                            // than "was it ever asked to sound".
                            activeSourceHandles.delete(id);
                            world.update(entity, AudioSource, draft => {
                                draft.playing = false;
                                draft.finished = true;
                            });
                        }

                        const sounding = activeSourceHandles.get(id);
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

                            sounding.handle.setVolume(source.volume * attenuation);
                            sounding.handle.setPan(pan);
                        }
                    }

                    // Sources the pass above did not reach at all. Their voices are
                    // STOPPED, not just forgotten: a dropped handle is a sound
                    // nothing can reach any more.
                    for (const entityId of [...activeSourceHandles.keys()]) {
                        if (!liveEntities.has(entityId)) stopVoice(entityId);
                    }
                },
                { name: 'AudioUpdateSystem' }
            )
        );
    }

    stopAllSources(): void {
        if (this.activeSourceHandles_) {
            for (const voice of this.activeSourceHandles_.values()) {
                voice.handle.stop();
            }
            this.activeSourceHandles_.clear();
        }
        this.playedEntities_?.clear();
    }

    cleanup(): void {
        this.offMemoryWarning_?.();
        this.offMemoryWarning_ = null;
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.stopAllSources();
        this.audio_?.dispose();
        this.audio_ = null;
    }
}

export const audioPlugin = new AudioPlugin();
