// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AudioMixer } from './AudioMixer';
import type { AudioMixerConfig } from './AudioMixer';

export interface AudioHandle {
    readonly id: number;
    stop(): void;
    pause(): void;
    resume(): void;
    setVolume(volume: number): void;
    setPan(pan: number): void;
    setLoop(loop: boolean): void;
    setPlaybackRate(rate: number): void;
    readonly isPlaying: boolean;
    readonly currentTime: number;
    readonly duration: number;
    onEnd?: () => void;
}

export interface AudioBufferHandle {
    readonly id: number;
    readonly duration: number;
    /**
     * Decoded size in bytes, for the audio residency budget. Backends that
     * hold real decoded PCM (WebAudio) report it; streaming backends (WeChat
     * InnerAudioContext plays from file) omit it — 0/undefined means
     * untracked, and untracked entries never count against the budget.
     */
    readonly bytes?: number;
}

export interface PlayConfig {
    volume?: number;
    pan?: number;
    loop?: boolean;
    playbackRate?: number;
    bus?: string;
    priority?: number;
    startOffset?: number;
}

export interface AudioBackendInitOptions {
    initialPoolSize?: number;
    mixerConfig?: AudioMixerConfig;
}

/**
 * What a backend needs in order to play a clip: `bytes` decodes a buffer the
 * caller fetched, `url` hands the host a source it fetches itself (a mini-game's
 * InnerAudioContext). A `url` backend given a cache KEY rather than a resolved
 * source plays a file the package does not carry.
 */
export type AudioDelivery = 'bytes' | 'url';

export interface PlatformAudioBackend {
    readonly name: string;
    readonly mixer: AudioMixer | null;
    readonly isReady: boolean;
    /** See {@link AudioDelivery}. */
    readonly delivery: AudioDelivery;
    initialize(options?: AudioBackendInitOptions): Promise<void>;
    ensureResumed(): Promise<void>;
    /** @param src a RESOLVED source the host can fetch — never a cache key. */
    loadBuffer(src: string): Promise<AudioBufferHandle>;
    /** @param src as {@link loadBuffer}; `bytes` backends use `data` and ignore it. */
    loadBufferFromData(src: string, data: ArrayBuffer): Promise<AudioBufferHandle>;
    unloadBuffer(handle: AudioBufferHandle): void;
    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle;
    suspend(): void;
    resume(): void;
    dispose(): void;
    /** Fill `out` with the master output's frequency magnitudes (0-255 per bin,
     *  low→high), returning true. Optional: backends without analysis (e.g.
     *  WeChat) omit it, and callers treat a missing method as silence. */
    getFrequencyData?(out: Uint8Array): boolean;
}
