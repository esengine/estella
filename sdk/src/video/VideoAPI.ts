// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Per-app video service — the imperative face of the video system, exposed as
// the VideoPlayer resource.
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { defineResource } from '../ecs/resource';
import { log } from '../util/logger';

export type VideoHandle = VideoStreamHandle;
export type VideoPlayOptions = VideoStreamOptions;

export class VideoAPI {
    private readonly backend_: PlatformVideoBackend;
    private readonly handles_ = new Set<VideoStreamHandle>();
    private refResolver_: ((ref: string) => string) | null = null;
    private disposed_ = false;
    baseUrl = '';

    constructor(backend: PlatformVideoBackend) {
        this.backend_ = backend;
    }

    get backendName(): string { return this.backend_.name; }

    setRefResolver(resolver: ((ref: string) => string) | null): void {
        this.refResolver_ = resolver;
    }

    private resolveUrl_(ref: string): string {
        if (this.refResolver_) return this.refResolver_(ref);
        if (!this.baseUrl || ref.includes('://') || ref.startsWith('/') || ref.startsWith('blob:') || ref.startsWith('data:')) {
            return ref;
        }
        return `${this.baseUrl}/${ref}`;
    }

    play(source: string, options: VideoPlayOptions = {}): VideoStreamHandle {
        const handle = this.backend_.createStream(this.resolveUrl_(source), {
            ...options,
            audioTrackUrl: options.audioTrackUrl ?? this.resolveAudioTrack_(source),
        });
        this.handles_.add(handle);
        return handle;
    }

    /**
     * Resolve the cook-demuxed audio-track sibling through the realm's ref
     * resolver: the cook registers it as `<source path>.m4a` (path refs) or
     * `<uuid>-audio` (uuid refs). A resolver miss returns the ref unchanged —
     * treated as "no cooked sibling" so backends fall back to URL derivation.
     */
    private resolveAudioTrack_(source: string): string | undefined {
        if (!this.refResolver_) return undefined;
        const siblingRef = source.startsWith('@uuid:') ? `${source}-audio` : `${source}.m4a`;
        const resolved = this.refResolver_(siblingRef);
        return resolved !== siblingRef ? resolved : undefined;
    }

    update(module: ESEngineModule | null): void {
        if (this.disposed_) return;
        for (const handle of this.handles_) {
            // One stream's decode failure (wasm abort, detached heap) must not
            // stall every other video this tick.
            try {
                handle.pump(module);
            } catch (err) {
                log.error('video', `pump failed for stream #${handle.id} — stopping it`, err);
                this.handles_.delete(handle);
                try { handle.stop(); } catch { /* already broken */ }
                handle.onError?.(err);
            }
        }
    }

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

export const VideoPlayer = defineResource<VideoAPI>(null!, 'VideoPlayer');
