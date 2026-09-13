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

export interface AudioPluginConfig {
    initialPoolSize?: number;
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
}

export class AudioPlugin implements Plugin {
    name = 'audio';
    private config_: AudioPluginConfig;
    private activeSourceHandles_: Map<number, AudioHandle> | null = null;
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

        const activeSourceHandles = new Map<number, AudioHandle>();
        this.activeSourceHandles_ = activeSourceHandles;
        const playedEntities = new Set<number>();
        this.playedEntities_ = playedEntities;

        this.offDespawn_ = app.world.onDespawn((entity: Entity) => {
            const handle = activeSourceHandles.get(entity);
            if (handle) {
                handle.stop();
                activeSourceHandles.delete(entity);
            }
            playedEntities.delete(entity);
        });
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
                        if (!source.enabled || !source.clip) continue;
                        const id = entity as number;
                        liveEntities.add(id);

                        if (source.playOnAwake && !playedEntities.has(id) && !activeSourceHandles.has(id) && backend.isReady) {
                            const buffer = audioAPI.getBufferHandle(source.clip);
                            if (buffer) {
                                // Through the API, not straight at the backend: the
                                // voice cap and the soft bus gain are decided there,
                                // and a sound outside that door gets neither.
                                const handle = audioAPI.playBuffer(buffer, {
                                    bus: source.bus,
                                    volume: source.volume,
                                    loop: source.loop,
                                    playbackRate: source.pitch,
                                    priority: source.priority,
                                });
                                activeSourceHandles.set(id, handle);
                                playedEntities.add(id);
                            } else if (!unplayableClips.has(source.clip)) {
                                // A scene setting playOnAwake has already said to play
                                // it; demanding a preload call beside it is a component
                                // that silently does nothing. Unplayed until it lands.
                                if (!loadingClips.has(source.clip)) {
                                    const clip = source.clip;
                                    loadingClips.add(clip);
                                    void audioAPI.preload(clip)
                                        .catch((err) => {
                                            unplayableClips.add(clip);
                                            log.warn('audio', `playOnAwake: cannot load clip "${clip}"`, err);
                                        })
                                        .finally(() => loadingClips.delete(clip));
                                }
                            }
                        }

                        if (source.spatial && activeSourceHandles.has(id)) {
                            const handle = activeSourceHandles.get(id)!;
                            if (!handle.isPlaying) {
                                activeSourceHandles.delete(id);
                                continue;
                            }

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

                            handle.setVolume(source.volume * attenuation);
                            handle.setPan(pan);
                        }
                    }

                    for (const [entityId, handle] of activeSourceHandles) {
                        if (!liveEntities.has(entityId) || !handle.isPlaying) {
                            activeSourceHandles.delete(entityId);
                        }
                    }
                },
                { name: 'AudioUpdateSystem' }
            )
        );
    }

    stopAllSources(): void {
        if (this.activeSourceHandles_) {
            for (const handle of this.activeSourceHandles_.values()) {
                handle.stop();
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
