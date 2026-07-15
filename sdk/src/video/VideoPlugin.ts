// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Wires the video system into an App: builds the backend, exposes VideoPlayer,
// and runs one play-mode system that streams each Video and drives its Sprite.
import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { Res, Time, type TimeData } from '../resource';
import { VideoPlayer, VideoAPI } from './VideoAPI';
import { Video, type VideoData } from './VideoComponents';
import { Sprite, type SpriteData } from '../component';
import type { VideoStreamHandle } from './PlatformVideoBackend';
import { NullVideoBackend } from './NullVideoBackend';
import { getPlatform } from '../platform/base';
import { isEditor, isPlayMode } from '../env';
import { log } from '../logger';

export class VideoPlugin implements Plugin {
    name = 'video';
    private video_: VideoAPI | null = null;
    private handles_: Map<number, VideoStreamHandle> | null = null;

    build(app: App): void {
        // createVideoBackend is optional; fall back to the silent Null backend.
        const backend = getPlatform().createVideoBackend?.() ?? new NullVideoBackend();
        const video = new VideoAPI(backend);
        this.video_ = video;
        app.insertResource(VideoPlayer, video);

        const handles = new Map<number, VideoStreamHandle>();
        this.handles_ = handles;
        const warnedNoSprite = new Set<number>();
        const live = new Set<number>();

        app.world.onDespawn((entity: Entity) => {
            const handle = handles.get(entity as number);
            if (handle) {
                video.stop(handle);
                handles.delete(entity as number);
            }
            warnedNoSprite.delete(entity as number);
        });

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Time), Res(VideoPlayer)],
                (_time: TimeData, videoAPI: VideoAPI) => {
                    if (isEditor() && !isPlayMode()) return;
                    const world = app.world;
                    const module = world.getWasmModule();
                    if (!module) return;

                    const entities = world.getEntitiesWithComponents([Video]);
                    live.clear();

                    // Start streams before the pump so a new one uploads this tick.
                    for (const entity of entities) {
                        const v = world.get(entity, Video) as VideoData;
                        if (!v.enabled || !v.source) continue;
                        const id = entity as number;
                        live.add(id);
                        if (!handles.has(id)) {
                            handles.set(id, videoAPI.play(v.source, {
                                autoplay: v.autoplay,
                                loop: v.loop,
                                muted: v.muted,
                                volume: v.volume,
                                playbackRate: v.playbackRate,
                            }));
                        }
                    }

                    videoAPI.update(module);

                    for (const entity of entities) {
                        const id = entity as number;
                        const handle = handles.get(id);
                        if (!handle || !handle.textureHandle) continue;

                        const sprite = world.tryGet(entity, Sprite) as SpriteData | null;
                        if (!sprite) {
                            if (!warnedNoSprite.has(id)) {
                                log.warn('video', `entity ${id} has a Video but no Sprite to render into — add a Sprite component`);
                                warnedNoSprite.add(id);
                            }
                            continue;
                        }

                        // Builtin get() is a snapshot copy — needs world.insert to
                        // persist. The handle is stable, so write back only on change.
                        let dirty = false;
                        if (sprite.texture !== handle.textureHandle) {
                            sprite.texture = handle.textureHandle;
                            dirty = true;
                        }
                        const v = world.get(entity, Video) as VideoData;
                        if (v.fitSize && handle.width > 0 &&
                            (sprite.size.x !== handle.width || sprite.size.y !== handle.height)) {
                            sprite.size = { x: handle.width, y: handle.height };
                            dirty = true;
                        }
                        if (dirty) world.insert(entity, Sprite, sprite);
                    }

                    // Reap streams whose entity is gone, disabled, or source-cleared.
                    for (const [id, handle] of handles) {
                        if (!live.has(id)) {
                            videoAPI.stop(handle);
                            handles.delete(id);
                            warnedNoSprite.delete(id);
                        }
                    }
                },
                { name: 'VideoUpdateSystem' }
            )
        );
    }

    stopAll(): void {
        if (this.handles_) {
            for (const handle of this.handles_.values()) handle.stop();
            this.handles_.clear();
        }
    }

    cleanup(): void {
        this.stopAll();
        this.video_?.dispose();
        this.video_ = null;
    }
}

export const videoPlugin = new VideoPlugin();
