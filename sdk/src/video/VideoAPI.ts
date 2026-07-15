// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    video/VideoAPI.ts
 * @brief   Per-app video service — the imperative face of the video system and
 *          the visual mirror of AudioAPI. Code-driven playback (cutscenes,
 *          splash) calls `video.play(src)`; the declarative `Video` component's
 *          system uses the same API under the hood. Each `App` owns one
 *          instance, created by `VideoPlugin.build()` and exposed as the
 *          {@link VideoPlayer} resource (`Res(VideoPlayer)` / `getResource`).
 *
 * Video texture residency is simpler than audio's: a stream owns one pathless,
 * non-evictable frame texture for its lifetime and frees it on stop — there is
 * no re-fetchable decoded buffer to warm-cache, so there is no eviction budget.
 */
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { defineResource } from '../resource';

export type VideoHandle = VideoStreamHandle;
export type VideoPlayOptions = VideoStreamOptions;

export class VideoAPI {
    private readonly backend_: PlatformVideoBackend;
    private readonly handles_ = new Set<VideoStreamHandle>();
    private refResolver_: ((ref: string) => string) | null = null;
    private disposed_ = false;
    /** Legacy prefix for plain project-relative refs; `refResolver` wins. */
    baseUrl = '';

    constructor(backend: PlatformVideoBackend) {
        this.backend_ = backend;
    }

    get backendName(): string { return this.backend_.name; }

    /**
     * Route source refs through the realm's asset resolver — the same channel
     * every other asset resolves through (uuid manifest, cooked logical→staged
     * map, project base). Mirrors {@link AudioAPI.setRefResolver}.
     */
    setRefResolver(resolver: ((ref: string) => string) | null): void {
        this.refResolver_ = resolver;
    }

    private resolveUrl_(ref: string): string {
        if (this.refResolver_) return this.refResolver_(ref);
        // Absolute or scheme-bearing (estella://, blob:, data:, http(s)://,
        // leading /) — already a URL the element can open.
        if (!this.baseUrl || ref.includes('://') || ref.startsWith('/') || ref.startsWith('blob:') || ref.startsWith('data:')) {
            return ref;
        }
        return `${this.baseUrl}/${ref}`;
    }

    /**
     * Start a video from a source ref, returning its live handle. The frame
     * texture is created lazily on the first decoded frame (see the handle's
     * `textureHandle`); poll `handle.isReady`/`onReady` before sampling it.
     */
    play(source: string, options: VideoPlayOptions = {}): VideoStreamHandle {
        const handle = this.backend_.createStream(this.resolveUrl_(source), options);
        this.handles_.add(handle);
        const userEnded = handle.onEnded;
        handle.onEnded = () => {
            userEnded?.();
            // A finished non-looping stream stays in the set (its last frame is
            // still valid to show); explicit stop() releases it.
        };
        return handle;
    }

    /** Advance every live stream: upload any newly-decoded frame into its
     *  texture. Called once per frame by the video system with the live module. */
    update(module: ESEngineModule): void {
        if (this.disposed_) return;
        for (const handle of this.handles_) handle.pump(module);
    }

    /** Stop one stream and release its frame texture. */
    stop(handle: VideoStreamHandle): void {
        if (this.handles_.delete(handle)) handle.stop();
    }

    stopAll(): void {
        for (const handle of this.handles_) handle.stop();
        this.handles_.clear();
    }

    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.stopAll();
        this.backend_.dispose();
    }
}

/**
 * The per-app video service resource. Consume via `Res(VideoPlayer)` in a
 * system or `app.getResource(VideoPlayer)` outside ECS code.
 */
export const VideoPlayer = defineResource<VideoAPI>(null!, 'VideoPlayer');
