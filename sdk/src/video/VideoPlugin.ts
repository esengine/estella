// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Wires the video system into an App: builds the backend, exposes VideoPlayer,
// and runs one play-mode system that streams each Video onto its renderable.
import type { App, Plugin } from '../app/app';
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { VideoPlayer, VideoAPI } from './VideoAPI';
import { Video, type VideoData } from './VideoComponents';
import { Sprite, MeshRenderer, type SpriteData, type MeshRendererData } from '../ecs/component';
import type { UIVisualData } from '../ecs/component.generated';
import { UIVisual } from '../ui/core/ui-visual';
import type { VideoStreamHandle } from './PlatformVideoBackend';
import { NullVideoBackend } from './NullVideoBackend';
import { Audio } from '../audio/Audio';
import { getPlatform } from '../platform/base';
import { isEditor, isPlayMode } from '../ecs/env';
import { log } from '../util/logger';

const UI_VISUAL_IMAGE = 2; // UIVisualType.Image — samples the texture

// Drive the entity's renderable sibling (Sprite / UIVisual / MeshRenderer) from the
// current frame. Builtin get() is a snapshot copy, so mutations need world.insert;
// the handle is stable, so we write back only on change. Returns false if the
// entity has no renderable to show the video on.
function driveRenderable(world: World, entity: Entity, handle: VideoStreamHandle, video: VideoData): boolean {
    const tex = handle.textureHandle;

    const sprite = world.tryGet(entity, Sprite) as SpriteData | null;
    if (sprite) {
        let dirty = false;
        if (sprite.texture !== tex) { sprite.texture = tex; dirty = true; }
        if (video.fitSize && handle.width > 0 &&
            (sprite.size.x !== handle.width || sprite.size.y !== handle.height)) {
            sprite.size = { x: handle.width, y: handle.height };
            dirty = true;
        }
        if (dirty) world.insert(entity, Sprite, sprite);
        return true;
    }

    const uiv = world.tryGet(entity, UIVisual) as UIVisualData | null;
    if (uiv) {
        let dirty = false;
        if (uiv.texture !== tex) { uiv.texture = tex; dirty = true; }
        if (uiv.visualType !== UI_VISUAL_IMAGE) { uiv.visualType = UI_VISUAL_IMAGE; dirty = true; }
        if (dirty) world.insert(entity, UIVisual, uiv);
        return true;
    }

    const mesh = world.tryGet(entity, MeshRenderer) as MeshRendererData | null;
    if (mesh) {
        if (mesh.texture !== tex) { mesh.texture = tex; world.insert(entity, MeshRenderer, mesh); }
        return true;
    }

    return false;
}

export class VideoPlugin implements Plugin {
    name = 'video';
    private video_: VideoAPI | null = null;
    private handles_: Map<number, VideoStreamHandle> | null = null;

    build(app: App): void {
        // createVideoBackend is optional; fall back to the silent Null backend.
        // The context's getters are lazy so the wasm backend resolves the
        // side-module host / audio service per stream (they may attach to the
        // app after plugins build).
        const backend = getPlatform().createVideoBackend?.({
            sideModules: () => app.sideModules,
            audio: () => {
                try { return app.getResource(Audio); } catch { return null; }
            },
        }) ?? new NullVideoBackend();
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
                    // Null on a native core: the frame upload goes through the
                    // ResourceManager's byte path instead of a wasm heap.
                    const module = world.getWasmModule();

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

                        const v = world.get(entity, Video) as VideoData;
                        if (!driveRenderable(world, entity, handle, v) && !warnedNoSprite.has(id)) {
                            log.warn('video', `entity ${id} has a Video but no renderable (Sprite/UIVisual/MeshRenderer) to show it on`);
                            warnedNoSprite.add(id);
                        }
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
