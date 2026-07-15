// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Per-app video service — the imperative face of the video system, exposed as
// the VideoPlayer resource.
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
        const handle = this.backend_.createStream(this.resolveUrl_(source), options);
        this.handles_.add(handle);
        return handle;
    }

    update(module: ESEngineModule): void {
        if (this.disposed_) return;
        for (const handle of this.handles_) handle.pump(module);
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
