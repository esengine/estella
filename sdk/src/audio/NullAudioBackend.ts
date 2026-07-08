// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NullAudioBackend.ts
 * @brief   A silent PlatformAudioBackend for hosts with no audio device — the
 *          headless Node server, muted embeds, tests. Every call succeeds and
 *          does nothing, so gameplay code that plays sounds runs unchanged on
 *          an authoritative server.
 */
import type { AudioMixer } from './AudioMixer';
import type {
    AudioBackendInitOptions, AudioBufferHandle, AudioHandle,
    PlatformAudioBackend, PlayConfig,
} from './PlatformAudioBackend';

class NullAudioHandle implements AudioHandle {
    constructor(readonly id: number) {}
    stop(): void {}
    pause(): void {}
    resume(): void {}
    setVolume(): void {}
    setPan(): void {}
    setLoop(): void {}
    setPlaybackRate(): void {}
    get isPlaying(): boolean { return false; }
    get currentTime(): number { return 0; }
    get duration(): number { return 0; }
}

export class NullAudioBackend implements PlatformAudioBackend {
    readonly name = 'null';
    readonly mixer: AudioMixer | null = null;
    readonly isReady = true;
    private nextId_ = 1;

    async initialize(_options?: AudioBackendInitOptions): Promise<void> {}
    async ensureResumed(): Promise<void> {}

    async loadBuffer(_url: string): Promise<AudioBufferHandle> {
        return { id: this.nextId_++, duration: 0, bytes: 0 };
    }

    async loadBufferFromData(_url: string, _data: ArrayBuffer): Promise<AudioBufferHandle> {
        return { id: this.nextId_++, duration: 0, bytes: 0 };
    }

    unloadBuffer(_handle: AudioBufferHandle): void {}

    play(_buffer: AudioBufferHandle, _config: PlayConfig): AudioHandle {
        return new NullAudioHandle(this.nextId_++);
    }

    suspend(): void {}
    resume(): void {}
    dispose(): void {}
}
