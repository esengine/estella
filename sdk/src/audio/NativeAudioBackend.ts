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
 */
import type { AudioMixer } from './AudioMixer';
import type {
    AudioBackendInitOptions, AudioBufferHandle, AudioHandle,
    PlatformAudioBackend, PlayConfig,
} from './PlatformAudioBackend';
import type { NativeAudioBridge } from '../platform/native/bridge';
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
        this.audio_.stop(this.id);
        this.onDispose_();
    }

    /** @internal The host reported this voice ended on its own (pushed through
     *  {@link NativeAudioBridge.onEnded}). Fire onEnd once; a later stop() no-ops. */
    handleEnded_(): void {
        if (this.done_) return;
        this.done_ = true;
        this.onEnd?.();
        this.onDispose_();
    }

    pause(): void { this.audio_.pause(this.id); }
    resume(): void { this.audio_.resume(this.id); }
    setVolume(volume: number): void { this.audio_.setVolume(this.id, volume); }
    setPan(pan: number): void { this.audio_.setPan(this.id, scalar.clamp(pan, -1, 1)); }
    setLoop(loop: boolean): void { this.audio_.setLoop(this.id, loop); }
    setPlaybackRate(rate: number): void { this.audio_.setRate(this.id, rate); }

    get isPlaying(): boolean { return this.audio_.voiceState(this.id)?.playing ?? false; }
    get currentTime(): number { return this.audio_.voiceState(this.id)?.currentTime ?? 0; }
    get duration(): number { return this.duration_; }
}

export class NativeAudioBackend implements PlatformAudioBackend {
    readonly name = 'native';
    readonly mixer: AudioMixer | null = null;
    readonly isReady = true;

    private readonly voices_ = new Map<number, NativeAudioHandle>();
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

    async loadBuffer(url: string): Promise<AudioBufferHandle> {
        // On native the audio ref resolver hands back a packaged path (not bytes),
        // so read the file through the same platform channel as every other asset,
        // then let the native engine decode it.
        return this.loadFromBytes_(await platformReadFile(url));
    }

    async loadBufferFromData(_url: string, data: ArrayBuffer): Promise<AudioBufferHandle> {
        return this.loadFromBytes_(data);
    }

    private loadFromBytes_(bytes: ArrayBuffer): AudioBufferHandle {
        const decoded = this.audio_.load(bytes);
        if (!decoded) throw new Error('[native] audio decode failed');
        return { id: decoded.id, duration: decoded.duration, bytes: decoded.bytes };
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

    suspend(): void { this.audio_.suspendAll(); }
    resume(): void { this.audio_.resumeAll(); }

    dispose(): void {
        for (const handle of this.voices_.values()) handle.stop();
        this.voices_.clear();
        this.offEnded_();
    }
}
