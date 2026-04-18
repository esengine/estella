import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { Res, Time, type TimeData } from '../resource';
import { Audio, AudioAPI } from './Audio';
import { AudioSource, AudioListener, type AudioSourceData, type AudioListenerData } from './AudioComponents';
import { WorldTransform, type WorldTransformData } from '../component';
import { getPlatform } from '../platform/base';
import { calculateAttenuation, calculatePanning, type SpatialAudioConfig, AttenuationModel } from './SpatialAudio';
import type { AudioHandle } from './PlatformAudioBackend';
import { isEditor, isPlayMode } from '../env';
import { log } from '../logger';

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

    constructor(config: AudioPluginConfig = {}) {
        this.config_ = config;
    }

    build(app: App): void {
        const backend = getPlatform().createAudioBackend();
        const config = this.config_;

        backend.initialize({ initialPoolSize: config.initialPoolSize }).catch(err => {
            log.warn('audio', 'backend initialization failed', err);
        });

        const mixer = backend.mixer;
        const audio = new AudioAPI(backend, mixer);
        this.audio_ = audio;
        app.insertResource(Audio, audio);

        if (mixer) {
            if (config.masterVolume !== undefined) mixer.master.volume = config.masterVolume;
            if (config.musicVolume !== undefined) mixer.music.volume = config.musicVolume;
            if (config.sfxVolume !== undefined) mixer.sfx.volume = config.sfxVolume;
        }

        const activeSourceHandles = new Map<number, AudioHandle>();
        this.activeSourceHandles_ = activeSourceHandles;
        const playedEntities = new Set<number>();
        this.playedEntities_ = playedEntities;

        app.world.onDespawn((entity: Entity) => {
            const handle = activeSourceHandles.get(entity);
            if (handle) {
                handle.stop();
                activeSourceHandles.delete(entity);
            }
            playedEntities.delete(entity);
        });
        const liveEntities = new Set<number>();
        let spatialListenerWarned = false;
        let wasPlayMode = false;

        app.addSystemToSchedule(
            Schedule.PreUpdate,
            defineSystem(
                [Res(Time), Res(Audio)],
                (_time: TimeData, audioAPI: AudioAPI) => {
                    const playMode = !isEditor() || isPlayMode();

                    if (!playMode) {
                        if (wasPlayMode) {
                            spatialListenerWarned = false;
                            wasPlayMode = false;
                        }
                        return;
                    }
                    wasPlayMode = true;

                    const world = app.world;

                    let listenerX = 0;
                    let listenerY = 0;
                    let hasListener = false;
                    const listeners = world.getEntitiesWithComponents([AudioListener, WorldTransform]);
                    for (const entity of listeners) {
                        const listener = world.get(entity, AudioListener) as AudioListenerData;
                        if (listener.enabled) {
                            const wt = world.get(entity, WorldTransform) as WorldTransformData;
                            listenerX = wt.position.x;
                            listenerY = wt.position.y;
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
                                const handle = backend.play(buffer, {
                                    bus: source.bus,
                                    volume: source.volume,
                                    loop: source.loop,
                                    playbackRate: source.pitch,
                                });
                                activeSourceHandles.set(id, handle);
                                playedEntities.add(id);
                            } else {
                                log.warn(
                                    'audio',
                                    `playOnAwake: clip "${source.clip}" not preloaded`,
                                );
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
                            const srcX = wt?.position.x ?? 0;
                            const srcY = wt?.position.y ?? 0;
                            const dx = srcX - listenerX;
                            const dy = srcY - listenerY;
                            const distance = Math.sqrt(dx * dx + dy * dy);

                            const spatialConfig: SpatialAudioConfig = {
                                model: source.attenuationModel as AttenuationModel,
                                refDistance: source.minDistance,
                                maxDistance: source.maxDistance,
                                rolloff: source.rolloff,
                            };

                            const attenuation = calculateAttenuation(distance, spatialConfig);
                            const pan = calculatePanning(
                                srcX, srcY,
                                listenerX, listenerY,
                                source.maxDistance
                            );

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
        this.stopAllSources();
        this.audio_?.dispose();
        this.audio_ = null;
    }
}

export const audioPlugin = new AudioPlugin();
