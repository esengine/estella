// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    video/NullVideoBackend.ts
 * @brief   Silent no-op video backend — the visual mirror of NullAudioBackend.
 *          Used on headless Node (authoritative server), as the WeChat fallback
 *          until WeChatVideoBackend lands, and anywhere a platform advertises no
 *          video capability. Every call succeeds and does nothing; the frame
 *          texture stays 0 so a driven Sprite simply shows no video. DOM-free,
 *          so importing it never pulls browser globals into a headless bundle.
 */
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';

let nextId_ = 1;

class NullVideoStreamHandle implements VideoStreamHandle {
    readonly id = nextId_++;
    readonly textureHandle = 0;
    readonly width = 0;
    readonly height = 0;
    readonly isReady = false;
    private playing_: boolean;
    onReady?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;

    constructor(options: VideoStreamOptions) {
        this.playing_ = options.autoplay ?? true;
    }

    get isPlaying(): boolean { return this.playing_; }
    get currentTime(): number { return 0; }
    get duration(): number { return 0; }

    play(): void { this.playing_ = true; }
    pause(): void { this.playing_ = false; }
    stop(): void { this.playing_ = false; this.onEnded = undefined; }
    seek(): void { /* no-op */ }
    setVolume(): void { /* no-op */ }
    setMuted(): void { /* no-op */ }
    setLoop(): void { /* no-op */ }
    setPlaybackRate(): void { /* no-op */ }
    pump(): void { /* no frames */ }
}

export class NullVideoBackend implements PlatformVideoBackend {
    readonly name = 'null';

    createStream(_url: string, options: VideoStreamOptions): VideoStreamHandle {
        return new NullVideoStreamHandle(options);
    }

    dispose(): void { /* nothing to release */ }
}
