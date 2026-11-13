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
import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions, AudioLoadOptions } from './PlatformAudioBackend';
import type { AudioMixer } from './AudioMixer';
import type { MiniGameGlobal, MiniGameInnerAudioContext } from '../platform/minigame/api';
import { scalar } from '../math/scalar';
import { log } from '../util/logger';

interface MiniGameAudioDeviceState {
    suspended: boolean;
    pending: Map<number, MiniGameInnerAudioContext>;
}

class MiniGameAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private ctx_: MiniGameInnerAudioContext;
    private contexts_: Map<number, MiniGameInnerAudioContext>;
    private done_ = false;

    constructor(id: number, ctx: MiniGameInnerAudioContext, contexts: Map<number, MiniGameInnerAudioContext>,
        private readonly device_: MiniGameAudioDeviceState) {
        this.id = id;
        this.ctx_ = ctx;
        this.contexts_ = contexts;
    }

    private isLive_(): boolean {
        return !this.done_ && this.contexts_.get(this.id) === this.ctx_;
    }

    // Guarded so stop() after a natural end (or a double stop()) can't destroy the
    // audio context twice — the second destroy() throws on-device.
    private dispose_(alsoStop: boolean): void {
        if (!this.isLive_()) return;
        this.done_ = true;
        this.contexts_.delete(this.id);
        this.device_.pending.delete(this.id);
        try {
            if (alsoStop) this.ctx_.stop();
        } finally {
            this.ctx_.destroy();
        }
    }

    stop(): void {
        this.dispose_(true);
    }

    /** Where a loop comes back to when it is not the start; the host's own loop only knows the start. */
    private loopFrom_ = 0;
    private looping_ = false;

    /** @internal A loop that comes back to @p seconds: the context is not left to loop, and is sent back when it ends. */
    loopFrom(seconds: number): void {
        this.loopFrom_ = seconds;
        this.looping_ = true;
        this.ctx_.loop = false;
    }

    /** @internal The context ended on its own — dispose without a redundant stop(). */
    onNaturalEnd(): void {
        if (!this.isLive_() || this.ctx_.loop) return;
        if (this.looping_) {
            // A context that has ended starts from its startTime when it is played again.
            this.ctx_.startTime = this.loopFrom_;
            this.resume();
            return;
        }
        this.dispose_(false);
        this.onEnd?.();
    }

    pause(): void {
        if (!this.isLive_()) return;
        this.device_.pending.delete(this.id);
        this.ctx_.pause();
    }

    resume(): void {
        if (!this.isLive_()) return;
        if (this.device_.suspended) this.device_.pending.set(this.id, this.ctx_);
        else this.ctx_.play();
    }

    setVolume(volume: number): void {
        if (!this.isLive_()) return;
        // The host's volume is only valid in [0,1] — out-of-range writes are
        // rejected on-device rather than clamped.
        this.ctx_.volume = scalar.clamp01(volume);
    }

    private panWarned_ = false;

    setPan(_pan: number): void {
        if (!this.isLive_()) return;
        if (!this.panWarned_) {
            log.warn('audio', 'mini-game audio contexts do not support stereo panning');
            this.panWarned_ = true;
        }
    }

    setLoop(loop: boolean): void {
        if (!this.isLive_()) return;
        if (this.loopFrom_ > 0) this.looping_ = loop;
        else this.ctx_.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        if (!this.isLive_()) return;
        this.ctx_.playbackRate = rate;
    }

    get isPlaying(): boolean {
        // Device suspension preserves playback intent, like a suspended WebAudio context.
        return this.isLive_() && (!this.ctx_.paused || this.device_.pending.get(this.id) === this.ctx_);
    }

    get currentTime(): number {
        return this.isLive_() ? this.ctx_.currentTime : 0;
    }

    get duration(): number {
        return this.ctx_.duration;
    }
}

export class MiniGameAudioBackend implements PlatformAudioBackend {
    readonly name: string;
    // The host owns the fetch: a player is handed a `src` and streams it.
    readonly delivery = 'url' as const;

    private readonly g_: MiniGameGlobal;
    private contexts_ = new Map<number, MiniGameInnerAudioContext>();
    private readonly device_: MiniGameAudioDeviceState = { suspended: false, pending: new Map() };
    private urlCache_ = new Map<number, string>();
    /** The silence encoding put before a clip the exporter re-encoded, by buffer: a player is started past it. */
    private leads_ = new Map<number, number>();
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

    async loadBuffer(src: string, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        const id = ++this.nextId_;
        this.urlCache_.set(id, src);
        // The player decodes the file itself and its length is not known here, so the lead the exporter measured is taken as it is.
        if (options?.trim && options.trim.lead > 0) this.leads_.set(id, options.trim.lead);
        return { id, duration: options?.trim?.seconds ?? 0 };
    }

    /** No decoder here — the player streams from `src`, and the bytes are dropped.
     *  Callers avoid the wasted fetch by reading {@link delivery} first. */
    async loadBufferFromData(src: string, _data: ArrayBuffer, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        return this.loadBuffer(src, options);
    }

    unloadBuffer(handle: AudioBufferHandle): void {
        this.leads_.delete(handle.id);
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
        const lead = this.leads_.get(buffer.id) ?? 0;
        ctx.startTime = lead + (config.startOffset ?? 0);
        ctx.obeyMuteSwitch = false;

        const handleId = ++this.nextId_;
        this.contexts_.set(handleId, ctx);

        const handle = new MiniGameAudioHandle(handleId, ctx, this.contexts_, this.device_);
        // Sent back past the lead each time round as well, where the host's own loop would play it again.
        if (config.loop && ((config.loopStart && config.loopStart > 0) || lead > 0)) handle.loopFrom(lead + (config.loopStart ?? 0));
        ctx.onEnded(() => handle.onNaturalEnd());
        ctx.onError((res) => {
            log.error('audio', `Playback error for "${url}"`, res.errMsg);
        });

        ctx.src = url;
        handle.resume();

        return handle;
    }

    suspend(): void {
        if (this.device_.suspended) return;
        this.device_.suspended = true;
        for (const [id, ctx] of this.contexts_) {
            if (ctx.paused) continue;
            this.device_.pending.set(id, ctx);
            ctx.pause();
        }
    }

    resume(): void {
        if (!this.device_.suspended) return;
        this.device_.suspended = false;
        for (const [id, ctx] of this.device_.pending) {
            this.device_.pending.delete(id);
            if (this.contexts_.get(id) === ctx && ctx.paused) {
                ctx.play();
            }
            if (this.device_.suspended) break;
        }
    }

    dispose(): void {
        this.device_.suspended = false;
        this.device_.pending.clear();
        for (const ctx of this.contexts_.values()) {
            ctx.destroy();
        }
        this.contexts_.clear();
        this.urlCache_.clear();
    }
}
