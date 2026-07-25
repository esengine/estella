// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MiniGameAudioBackend.ts
 * @brief   Audio for the mini-game platform family — one player per sound over
 *          the host's `createInnerAudioContext()`.
 *
 *          Written against the normalized {@link MiniGameInnerAudioContext}, not
 *          `wx`, so every vendor of the family gets it without an implementation
 *          of its own. There is no mixer: mini-game hosts expose finished
 *          players, not a DSP graph, so routing labels are honored by the engine
 *          and the graph itself is absent (`mixer` is null by contract).
 */
import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions } from './PlatformAudioBackend';
import type { AudioMixer } from './AudioMixer';
import type { MiniGameGlobal, MiniGameInnerAudioContext } from '../platform/minigame/api';
import { scalar } from '../math/scalar';
import { log } from '../logger';

class MiniGameAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private ctx_: MiniGameInnerAudioContext;
    private contexts_: Map<number, MiniGameInnerAudioContext>;
    private done_ = false;

    constructor(id: number, ctx: MiniGameInnerAudioContext, contexts: Map<number, MiniGameInnerAudioContext>) {
        this.id = id;
        this.ctx_ = ctx;
        this.contexts_ = contexts;
    }

    // Guarded so stop() after a natural end (or a double stop()) can't destroy the
    // audio context twice — the second destroy() throws on-device.
    private dispose_(alsoStop: boolean): void {
        if (this.done_) return;
        this.done_ = true;
        if (alsoStop) this.ctx_.stop();
        this.ctx_.destroy();
        this.contexts_.delete(this.id);
    }

    stop(): void {
        this.dispose_(true);
    }

    /** @internal The context ended on its own — dispose without a redundant stop(). */
    onNaturalEnd(): void {
        this.dispose_(false);
    }

    pause(): void {
        this.ctx_.pause();
    }

    resume(): void {
        this.ctx_.play();
    }

    setVolume(volume: number): void {
        // The host's volume is only valid in [0,1] — out-of-range writes are
        // rejected on-device rather than clamped.
        this.ctx_.volume = scalar.clamp01(volume);
    }

    private panWarned_ = false;

    setPan(_pan: number): void {
        if (!this.panWarned_) {
            log.warn('audio', 'mini-game audio contexts do not support stereo panning');
            this.panWarned_ = true;
        }
    }

    setLoop(loop: boolean): void {
        this.ctx_.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        this.ctx_.playbackRate = rate;
    }

    get isPlaying(): boolean {
        return !this.ctx_.paused;
    }

    get currentTime(): number {
        return this.ctx_.currentTime;
    }

    get duration(): number {
        return this.ctx_.duration;
    }
}

export class MiniGameAudioBackend implements PlatformAudioBackend {
    readonly name: string;

    private readonly g_: MiniGameGlobal;
    private contexts_ = new Map<number, MiniGameInnerAudioContext>();
    private urlCache_ = new Map<number, string>();
    private nextId_ = 0;

    constructor(global: MiniGameGlobal, label = 'MiniGame') {
        this.g_ = global;
        this.name = label;
    }

    get mixer(): AudioMixer | null {
        return null;
    }

    get isReady(): boolean {
        return true;
    }

    async initialize(_options?: AudioBackendInitOptions): Promise<void> {
        // createInnerAudioContext does not require global initialization
    }

    async ensureResumed(): Promise<void> {
        // Mini-game hosts do not gate playback on a user gesture
    }

    async loadBuffer(url: string): Promise<AudioBufferHandle> {
        const id = ++this.nextId_;
        this.urlCache_.set(id, url);
        return { id, duration: 0 };
    }

    async loadBufferFromData(url: string, _data: ArrayBuffer): Promise<AudioBufferHandle> {
        return this.loadBuffer(url);
    }

    unloadBuffer(handle: AudioBufferHandle): void {
        this.urlCache_.delete(handle.id);
    }

    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        const url = this.urlCache_.get(buffer.id);
        if (!url) {
            throw new Error(`Buffer ${buffer.id} not found`);
        }

        const ctx = this.g_.createInnerAudioContext();
        ctx.loop = config.loop ?? false;
        ctx.volume = scalar.clamp01(config.volume ?? 1.0);
        ctx.playbackRate = config.playbackRate ?? 1.0;
        ctx.startTime = config.startOffset ?? 0;
        ctx.obeyMuteSwitch = false;

        const handleId = ++this.nextId_;
        this.contexts_.set(handleId, ctx);

        const handle = new MiniGameAudioHandle(handleId, ctx, this.contexts_);
        ctx.onEnded(() => {
            handle.onEnd?.();
            if (!ctx.loop) handle.onNaturalEnd(); // guarded dispose (a later stop() is a no-op)
        });
        ctx.onError((res) => {
            log.error('audio', `Playback error for "${url}"`, res.errMsg);
        });

        ctx.src = url;
        ctx.play();

        return handle;
    }

    suspend(): void {
        for (const ctx of this.contexts_.values()) {
            ctx.pause();
        }
    }

    resume(): void {
        for (const ctx of this.contexts_.values()) {
            if (ctx.paused) {
                ctx.play();
            }
        }
    }

    dispose(): void {
        for (const ctx of this.contexts_.values()) {
            ctx.destroy();
        }
        this.contexts_.clear();
        this.urlCache_.clear();
    }
}
