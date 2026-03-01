import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { Res, Time, type TimeData } from '../resource';
import { Audio } from './Audio';
import { AudioSource, AudioListener, type AudioSourceData, type AudioListenerData } from './AudioComponents';
import { WorldTransform, type WorldTransformData } from '../component';
import { getPlatform } from '../platform/base';
import { calculateAttenuation, calculatePanning, type SpatialAudioConfig, AttenuationModel } from './SpatialAudio';
import type { AudioHandle } from './PlatformAudioBackend';

export interface AudioPluginConfig {
    initialPoolSize?: number;
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
}

export class AudioPlugin implements Plugin {
    name = 'AudioPlugin';
    private config_: AudioPluginConfig;
    private activeSourceHandles_: Map<number, AudioHandle> | null = null;

    constructor(config: AudioPluginConfig = {}) {
        this.config_ = config;
    }

    build(app: App): void {
        const backend = getPlatform().createAudioBackend();
        const config = this.config_;

        backend.initialize({ initialPoolSize: config.initialPoolSize });

        const mixer = backend.mixer;
        Audio.init(backend, mixer);

        if (mixer) {
            if (config.masterVolume !== undefined) mixer.master.volume = config.masterVolume;
            if (config.musicVolume !== undefined) mixer.music.volume = config.musicVolume;
            if (config.sfxVolume !== undefined) mixer.sfx.volume = config.sfxVolume;
        }

        const activeSourceHandles = new Map<number, AudioHandle>();
        this.activeSourceHandles_ = activeSourceHandles;
        let spatialListenerWarned = false;

        app.addSystemToSchedule(
            Schedule.PreUpdate,
            defineSystem(
                [Res(Time)],
                (_time: TimeData) => {
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
                    const liveEntities = new Set<number>();

                    for (const entity of sources) {
                        const source = world.get(entity, AudioSource) as AudioSourceData;
                        if (!source.enabled || !source.clip) continue;
                        liveEntities.add(entity as number);

                        if (source.playOnAwake && !activeSourceHandles.has(entity) && backend.isReady) {
                            const buffer = Audio.getBufferHandle(source.clip);
                            if (buffer) {
                                const handle = backend.play(buffer, {
                                    bus: source.bus,
                                    volume: source.volume,
                                    loop: source.loop,
                                    playbackRate: source.pitch,
                                });
                                activeSourceHandles.set(entity, handle);
                            } else {
                                console.warn(
                                    `[AudioPlugin] playOnAwake: clip "${source.clip}" not preloaded`
                                );
                            }
                        }

                        if (source.spatial && activeSourceHandles.has(entity)) {
                            const handle = activeSourceHandles.get(entity)!;
                            if (!handle.isPlaying) {
                                activeSourceHandles.delete(entity);
                                continue;
                            }

                            if (!hasListener && !spatialListenerWarned) {
                                console.warn('[AudioPlugin] spatial audio used but no AudioListener entity found');
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

    cleanup(): void {
        if (this.activeSourceHandles_) {
            for (const handle of this.activeSourceHandles_.values()) {
                handle.stop();
            }
            this.activeSourceHandles_.clear();
        }
        Audio.dispose();
    }
}

export const audioPlugin = new AudioPlugin();
