// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NativeAudioBackend.ts
 * @brief   A PlatformAudioBackend over the native host's audio engine (embedded
 *          Dawn + JS engine on iOS/Android).
 * @details A thin adapter over {@link NativeAudioBridge}, exactly as the WeChat
 *          backend is over InnerAudioContext: decode, mixing and output all run
 *          in the host's native engine (miniaudio), so nothing per-sample touches
 *          JS — the no-JIT budget forbids it. `mixer` is therefore null (no JS
 *          DSP graph), like WeChat; per-voice volume / pan / rate / loop are the
 *          full control surface.
 *
 *          A clip the importer (or its length, under `auto`) says to stream is
 *          handed to the host to keep compressed: the rule is audioStreaming.ts,
 *          the one the web backend follows, so the two agree on which clips.
 */
import type { AudioMixer } from './AudioMixer';
import type {
    AudioBackendInitOptions, AudioBufferHandle, AudioHandle,
    PlatformAudioBackend, PlayConfig,
} from './PlatformAudioBackend';
import type { NativeAudioBridge } from '../platform/native/bridge';
import type { AudioLoadOptions } from './PlatformAudioBackend';
import { decodedPcmBytes, shouldStream } from './audioStreaming';
import { platformReadFile } from '../platform/base';
import { scalar } from '../math/scalar';

class NativeAudioHandle implements AudioHandle {
    onEnd?: () => void;
    private done_ = false;

    constructor(
        readonly id: number,
        private readonly audio_: NativeAudioBridge,
        private readonly duration_: number,
        private readonly onDispose_: () => void,
    ) {}

    stop(): void {
        if (this.done_) return;
        this.done_ = true;
        try { this.audio_.stop(this.id); } finally { this.onDispose_(); }
    }

    /** @internal The host reported this voice ended on its own (pushed through
     *  {@link NativeAudioBridge.onEnded}). Fire onEnd once; a later stop() no-ops. */
    handleEnded_(): void {
        if (this.done_) return;
        this.done_ = true;
        this.onDispose_();
        this.onEnd?.();
    }

    pause(): void { if (!this.done_) this.audio_.pause(this.id); }
    resume(): void { if (!this.done_) this.audio_.resume(this.id); }
    setVolume(volume: number): void { if (!this.done_) this.audio_.setVolume(this.id, volume); }
    setPan(pan: number): void { if (!this.done_) this.audio_.setPan(this.id, scalar.clamp(pan, -1, 1)); }
    setLoop(loop: boolean): void { if (!this.done_) this.audio_.setLoop(this.id, loop); }
    setPlaybackRate(rate: number): void { if (!this.done_) this.audio_.setRate(this.id, rate); }

    get isPlaying(): boolean { return !this.done_ && (this.audio_.voiceState(this.id)?.playing ?? false); }
    get currentTime(): number { return this.done_ ? 0 : this.audio_.voiceState(this.id)?.currentTime ?? 0; }
    get duration(): number { return this.duration_; }
}

export class NativeAudioBackend implements PlatformAudioBackend {
    readonly name = 'native';
    readonly delivery = 'bytes' as const;
    readonly mixer: AudioMixer | null = null;
    readonly isReady = true;

    private readonly voices_ = new Map<number, NativeAudioHandle>();
    /** Reused across frames: a visualizer asks every frame, and a fresh view per
     *  ask would be garbage the interpreter has to collect at 60 Hz. */
    private spectrumView_: Uint8Array | null = null;
    private readonly offEnded_: () => void;

    constructor(private readonly audio_: NativeAudioBridge) {
        // The host pushes a voice-ended id (like touch); route it to that handle.
        this.offEnded_ = audio_.onEnded((voiceId) => {
            this.voices_.get(voiceId)?.handleEnded_();
        });
    }

    // The native engine is brought up by the host at boot; nothing to initialize
    // or resume here (no user-gesture requirement, unlike a browser AudioContext).
    async initialize(_options?: AudioBackendInitOptions): Promise<void> {}
    async ensureResumed(): Promise<void> {}

    async loadBuffer(url: string, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        // On native the audio ref resolver hands back a packaged path (not bytes),
        // so read the file through the same platform channel as every other asset,
        // then let the native engine decode it.
        return this.loadFromBytes_(await platformReadFile(url), options);
    }

    async loadBufferFromData(_url: string, data: ArrayBuffer, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        return this.loadFromBytes_(data, options);
    }

    private loadFromBytes_(bytes: ArrayBuffer, options?: AudioLoadOptions): AudioBufferHandle {
        const loaded = this.audio_.load(bytes, shouldStream(options?.loadType, bytes));
        if (!loaded) throw new Error('[native] audio decode failed');
        // What the host DID, not what was asked: one that could not stream the file decoded it, and its PCM
        // is then what counts against the budget.
        if (!loaded.streamed) return { id: loaded.id, duration: loaded.duration, bytes: loaded.bytes };
        return {
            id: loaded.id, duration: loaded.duration, bytes: loaded.bytes, streamed: true,
            savedBytes: Math.max(0, decodedPcmBytes(loaded.duration) - loaded.bytes),
        };
    }

    unloadBuffer(handle: AudioBufferHandle): void {
        this.audio_.unload(handle.id);
    }

    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        const voiceId = this.audio_.play(
            buffer.id,
            config.volume ?? 1,
            scalar.clamp(config.pan ?? 0, -1, 1),
            config.loop ?? false,
            config.playbackRate ?? 1,
        );
        const handle = new NativeAudioHandle(
            voiceId, this.audio_, buffer.duration, () => this.voices_.delete(voiceId),
        );
        this.voices_.set(voiceId, handle);
        return handle;
    }

    /**
     * The host's analyser, in the layout the web's getByteFrequencyData uses —
     * so a visualizer written against the web reads the same bytes here. False
     * when the host has no analyser tap, which the caller treats exactly as it
     * treats a backend with no analysis at all.
     */
    getFrequencyData(out: Uint8Array): boolean {
        const bytes = this.audio_.spectrum?.(out.length);
        if (!bytes) return false;
        if (!this.spectrumView_ || this.spectrumView_.buffer !== bytes) {
            this.spectrumView_ = new Uint8Array(bytes);
        }
        out.set(this.spectrumView_.subarray(0, out.length));
        return true;
    }

    suspend(): void { this.audio_.suspendAll(); }
    resume(): void { this.audio_.resumeAll(); }

    dispose(): void {
        for (const handle of this.voices_.values()) handle.stop();
        this.voices_.clear();
        this.offEnded_();
    }
}
