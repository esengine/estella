// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from './PlatformAudioBackend';
import type { AudioMixer, BusDuckRule } from './AudioMixer';
import type { BusEffectDef } from './BusEffects';
import { defineResource } from '../resource';
import { RuntimeConfig } from '../defaults';
import { log } from '../logger';

/**
 * One decoded buffer's residency record. Mirrors the texture pool's
 * three-state lifecycle: held (refCount > 0, pinned by Assets) →
 * evictable (refCount 0, warm cache bounded by the byte budget) →
 * evicted (backend buffer freed; a future load re-fetches).
 */
interface BufferEntry {
    handle: AudioBufferHandle;
    /** Decoded bytes; 0 = untracked (streaming backends), never budgeted. */
    bytes: number;
    /** Assets-held references. Direct play/preload entries stay at 0. */
    refCount: number;
}

/** Buffer residency counters. See {@link AudioAPI.getBufferStats}. */
export interface AudioBufferStats {
    bufferCount: number;
    /** Decoded bytes resident (held + evictable entries). */
    bufferBytes: number;
    /** The effective byte budget (0 = warm cache off). */
    bufferBudget: number;
    /** Warm-cache entries (refCount 0) awaiting revive or eviction. */
    evictableCount: number;
}

/**
 * Per-app audio API. Each `App` owns an `AudioAPI` instance (created by
 * `AudioPlugin.build()`), exposed via the `Audio` resource.
 *
 * Consumed as a resource: declare `Res(Audio)` as a system param or
 * grab it with `app.getResource(Audio)` outside ECS code.
 */
export class AudioAPI {
    private readonly backend_: PlatformAudioBackend;
    private readonly mixer_: AudioMixer | null;
    private readonly bufferCache_ = new Map<string, BufferEntry>();
    /** refCount==0 urls in eviction order (oldest first); access re-appends. */
    private readonly evictOrder_ = new Set<string>();
    private residentBytes_ = 0;
    private bufferBudgetOverride_: number | null = null;
    private bgmHandle_: AudioHandle | null = null;
    private bgmVolume_ = 1.0;
    private readonly fadeAnimIds_ = new Set<number>();
    private disposed_ = false;
    private assetResolver_: ((url: string) => ArrayBuffer | null) | null = null;
    private refResolver_: ((ref: string) => string) | null = null;
    baseUrl = '';

    constructor(backend: PlatformAudioBackend, mixer: AudioMixer | null = null) {
        this.backend_ = backend;
        this.mixer_ = mixer;
    }

    // =========================================================================
    // Buffer residency (held → evictable → evicted)
    // =========================================================================

    /** The effective warm-cache byte budget: an explicit override, else the
     *  live `RuntimeConfig.audioCacheBudget` (so build-config changes apply
     *  without plumbing). 0 disables the warm cache — a buffer is freed the
     *  moment its refCount reaches 0. */
    get bufferBudget(): number {
        return this.bufferBudgetOverride_ ?? RuntimeConfig.audioCacheBudget;
    }

    /** Override the warm-cache byte budget; `null` returns to RuntimeConfig. */
    setBufferBudget(bytes: number | null): void {
        this.bufferBudgetOverride_ = bytes === null ? null : Math.max(0, Math.floor(bytes));
        this.enforceBudget_();
    }

    /**
     * Pin a cached buffer: refCount + 1 (reviving an evictable entry back to
     * held). Returns false on a miss — the caller must load and re-acquire.
     * Every retain needs a matching {@link releaseBuffer}.
     */
    retainBuffer(url: string): boolean {
        const entry = this.bufferCache_.get(url);
        if (!entry) return false;
        entry.refCount++;
        this.evictOrder_.delete(url);
        return true;
    }

    /**
     * Unpin a buffer. At refCount 0 it becomes an evictable warm-cache entry
     * (bounded by {@link bufferBudget}) — still instantly playable and
     * revivable by {@link retainBuffer} — or is freed outright when the
     * budget is 0.
     */
    releaseBuffer(url: string): void {
        const entry = this.bufferCache_.get(url);
        if (!entry || entry.refCount === 0) return;
        if (--entry.refCount === 0) {
            if (this.bufferBudget === 0) {
                this.freeBuffer_(url, entry);
            } else {
                this.evictOrder_.add(url);
                this.enforceBudget_();
            }
        }
    }

    /**
     * Drop a buffer whose source bytes changed (hot reload) so no future play
     * or load serves stale audio. Safe while sounds are playing — live
     * sources keep their own reference to the decoded data; only the cache
     * entry goes, and the next play/load re-fetches fresh bytes. Returns
     * true if the url was cached.
     */
    invalidateBuffer(url: string): boolean {
        const entry = this.bufferCache_.get(url);
        if (!entry) return false;
        this.freeBuffer_(url, entry);
        return true;
    }

    /**
     * Free every evictable warm-cache buffer now (memory pressure). Held
     * buffers and the budget are untouched; the cache refills as buffers are
     * released afterwards. Returns the number of buffers freed.
     */
    trimBufferCache(): number {
        let freed = 0;
        for (const url of [...this.evictOrder_]) {
            const entry = this.bufferCache_.get(url);
            if (entry) {
                this.freeBuffer_(url, entry);
                freed++;
            }
        }
        return freed;
    }

    /** Buffer residency counters — the observability side of the budget. */
    getBufferStats(): AudioBufferStats {
        return {
            bufferCount: this.bufferCache_.size,
            bufferBytes: this.residentBytes_,
            bufferBudget: this.bufferBudget,
            evictableCount: this.evictOrder_.size,
        };
    }

    /** Register a decoded buffer as an evictable warm-cache entry. The budget
     *  is enforced against the OLD warm entries before the new one joins the
     *  eviction pool — mirroring the C++ pool's add(), where a just-created
     *  resource can't be the one evicted to make room for itself (a caller
     *  about to pin or play it would find it already gone). */
    private insertEntry_(url: string, handle: AudioBufferHandle): void {
        const entry: BufferEntry = { handle, bytes: handle.bytes ?? 0, refCount: 0 };
        this.bufferCache_.set(url, entry);
        this.residentBytes_ += entry.bytes;
        this.enforceBudget_();
        this.evictOrder_.add(url);
    }

    /** Cache lookup for playback: refreshes the LRU position of an evictable
     *  entry so frequently-played warm sounds aren't the first to go. */
    private lookupBuffer_(url: string): AudioBufferHandle | undefined {
        const entry = this.bufferCache_.get(url);
        if (!entry) return undefined;
        if (entry.refCount === 0 && this.evictOrder_.delete(url)) {
            this.evictOrder_.add(url);
        }
        return entry.handle;
    }

    private freeBuffer_(url: string, entry: BufferEntry): void {
        this.backend_.unloadBuffer(entry.handle);
        this.bufferCache_.delete(url);
        this.evictOrder_.delete(url);
        this.residentBytes_ -= entry.bytes;
    }

    /** Evict oldest warm-cache entries until resident bytes fit the budget.
     *  Held (refCount > 0) entries are never evicted. */
    private enforceBudget_(): void {
        const budget = this.bufferBudget;
        if (budget === 0) return;
        for (const url of this.evictOrder_) {
            if (this.residentBytes_ <= budget) break;
            const entry = this.bufferCache_.get(url);
            if (entry) this.freeBuffer_(url, entry);
        }
    }

    setAssetResolver(resolver: (url: string) => ArrayBuffer | null): void {
        this.assetResolver_ = resolver;
    }

    /**
     * Route play refs through the realm's single asset resolver — the same
     * channel every other asset type resolves through (uuid manifest, cooked
     * logical→staged maps, project base). Takes precedence over the legacy
     * `baseUrl` prefix, so `playSFX('assets/…')` works in cooked builds whose
     * content-addressed staging renamed the physical files.
     */
    setRefResolver(resolver: ((ref: string) => string) | null): void {
        this.refResolver_ = resolver;
    }

    private resolveUrl_(url: string): string {
        if (this.refResolver_) return this.refResolver_(url);
        if (!this.baseUrl || url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `${this.baseUrl}/${url}`;
    }

    async preload(url: string): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        if (this.assetResolver_) {
            const data = this.assetResolver_(url);
            if (data) {
                return this.preloadFromData(url, data);
            }
        }
        const buffer = await this.backend_.loadBuffer(this.resolveUrl_(url));
        if (!this.bufferCache_.has(url)) this.insertEntry_(url, buffer);
    }

    async preloadAll(urls: string[]): Promise<void> {
        await Promise.all(urls.map(url => this.preload(url)));
    }

    async preloadFromData(url: string, data: ArrayBuffer): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        const buffer = await this.backend_.loadBufferFromData(url, data);
        if (!this.bufferCache_.has(url)) this.insertEntry_(url, buffer);
    }

    playSFX(url: string, config?: {
        volume?: number;
        pitch?: number;
        pan?: number;
        priority?: number;
    }): AudioHandle {
        const playConfig = {
            bus: 'sfx',
            volume: config?.volume,
            playbackRate: config?.pitch,
            pan: config?.pan,
            priority: config?.priority ?? 0,
        };
        const buffer = this.lookupBuffer_(url);
        if (!buffer) {
            const pending = this.createDeferredHandle_();
            this.preload(url).then(() => {
                if (this.disposed_) return;
                const buf = this.lookupBuffer_(url);
                if (buf) {
                    pending.resolve(this.backend_.play(buf, playConfig));
                }
            }).catch(err => {
                log.warn('audio', `Failed to preload audio: ${url}`, err);
            });
            return pending;
        }
        return this.backend_.play(buffer, playConfig);
    }

    playBGM(url: string, config?: {
        volume?: number;
        fadeIn?: number;
        crossFade?: number;
    }): void {
        const play = (buffer: AudioBufferHandle) => {
            for (const id of this.fadeAnimIds_) {
                cancelAnimationFrame(id);
            }
            this.fadeAnimIds_.clear();

            const targetVolume = config?.volume ?? 1.0;
            const oldVolume = this.bgmVolume_;
            this.bgmVolume_ = targetVolume;

            if (this.bgmHandle_ && config?.crossFade) {
                this.fadeOut_(this.bgmHandle_, config.crossFade, oldVolume);
            } else if (this.bgmHandle_) {
                this.bgmHandle_.stop();
            }
            const fadeInDuration = config?.fadeIn ?? config?.crossFade;

            this.bgmHandle_ = this.backend_.play(buffer, {
                bus: 'music',
                volume: fadeInDuration ? 0 : targetVolume,
                loop: true,
            });

            if (fadeInDuration) {
                this.fadeIn_(this.bgmHandle_, fadeInDuration, targetVolume);
            }
        };

        const buffer = this.lookupBuffer_(url);
        if (buffer) {
            play(buffer);
        } else {
            this.preload(url).then(() => {
                if (this.disposed_) return;
                const buf = this.lookupBuffer_(url);
                if (buf) {
                    play(buf);
                }
            }).catch(err => {
                log.warn('audio', `Failed to preload BGM: ${url}`, err);
            });
        }
    }

    stopAll(): void {
        for (const id of this.fadeAnimIds_) {
            cancelAnimationFrame(id);
        }
        this.fadeAnimIds_.clear();
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    stopBGM(fadeOut?: number): void {
        if (!this.bgmHandle_) return;
        for (const id of this.fadeAnimIds_) {
            cancelAnimationFrame(id);
        }
        this.fadeAnimIds_.clear();
        if (fadeOut && fadeOut > 0) {
            const handle = this.bgmHandle_;
            this.bgmHandle_ = null;
            this.fadeOut_(handle, fadeOut, this.bgmVolume_);
        } else {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    setMasterVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.master.volume = volume;
        }
    }

    setMusicVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.music.volume = volume;
        }
    }

    setSFXVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.sfx.volume = volume;
        }
    }

    setUIVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.ui.volume = volume;
        }
    }

    muteBus(busName: string, muted: boolean): void {
        const bus = this.mixer_?.getBus(busName);
        if (bus) {
            bus.muted = muted;
        }
    }

    /** Ensure a named bus exists (creating it under `parent` ?? master).
     *  False on backends without a mixer graph. */
    ensureBus(name: string, parent?: string): boolean {
        if (!this.mixer_) return false;
        if (!this.mixer_.getBus(name)) {
            this.mixer_.createBus({ name, ...(parent ? { parent } : {}) });
        }
        return true;
    }

    setBusVolume(busName: string, volume: number): void {
        const bus = this.mixer_?.getBus(busName);
        if (bus) {
            bus.volume = volume;
        }
    }

    /** Replace a bus's DSP insert chain. No-op (false) on backends without a
     *  WebAudio graph (WeChat/Null) — same degradation as the volume APIs. */
    setBusEffects(busName: string, effects: BusEffectDef[]): boolean {
        const bus = this.mixer_?.getBus(busName);
        if (!bus) return false;
        bus.setEffects(effects);
        return true;
    }

    getBusEffects(busName: string): BusEffectDef[] {
        return this.mixer_?.getBus(busName)?.effects ?? [];
    }

    /** Install (or clear with null) sidechain ducking on `target` — e.g. duck
     *  'music' to 30% while 'voice' carries signal. */
    setBusDucking(target: string, rule: BusDuckRule | null): boolean {
        return this.mixer_?.setDucking(target, rule) ?? false;
    }

    getBusDucking(target: string): BusDuckRule | null {
        return this.mixer_?.getDucking(target) ?? null;
    }

    /** Advance duck envelopes (driven per-frame by AudioUpdateSystem). */
    updateDucking(): void {
        this.mixer_?.updateDucking();
    }

    getBufferHandle(url: string): AudioBufferHandle | undefined {
        return this.lookupBuffer_(url);
    }

    /** Fill `out` with the master output's frequency spectrum (0-255 per bin,
     *  low→high) for visualizers. Returns false on backends without analysis
     *  (e.g. WeChat) — callers should treat that as silence. */
    getSpectrum(out: Uint8Array): boolean {
        return this.backend_.getFrequencyData?.(out) ?? false;
    }

    dispose(): void {
        this.disposed_ = true;
        for (const id of this.fadeAnimIds_) {
            cancelAnimationFrame(id);
        }
        this.fadeAnimIds_.clear();
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
        for (const entry of this.bufferCache_.values()) {
            this.backend_?.unloadBuffer(entry.handle);
        }
        this.bufferCache_.clear();
        this.evictOrder_.clear();
        this.residentBytes_ = 0;
        this.backend_?.dispose();
    }

    private fadeIn_(handle: AudioHandle, duration: number, targetVolume: number): void {
        handle.setVolume(0);
        const startTime = performance.now();
        let animId = 0;
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(t * targetVolume);
            if (t < 1 && handle.isPlaying) {
                animId = requestAnimationFrame(tick);
                this.fadeAnimIds_.add(animId);
            } else {
                this.fadeAnimIds_.delete(animId);
            }
        };
        animId = requestAnimationFrame(tick);
        this.fadeAnimIds_.add(animId);
    }

    private fadeOut_(handle: AudioHandle, duration: number, startVolume: number): void {
        const startTime = performance.now();
        let animId = 0;
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(startVolume * (1 - t));
            if (t < 1 && handle.isPlaying) {
                animId = requestAnimationFrame(tick);
                this.fadeAnimIds_.add(animId);
            } else {
                handle.stop();
                this.fadeAnimIds_.delete(animId);
            }
        };
        animId = requestAnimationFrame(tick);
        this.fadeAnimIds_.add(animId);
    }

    private createDeferredHandle_(): AudioHandle & { resolve(real: AudioHandle): void } {
        let real: AudioHandle | null = null;
        const handle: AudioHandle & { resolve(r: AudioHandle): void } = {
            id: -1,
            stop() { real?.stop(); },
            pause() { real?.pause(); },
            resume() { real?.resume(); },
            setVolume(v: number) { real?.setVolume(v); },
            setPan(p: number) { real?.setPan(p); },
            setLoop(l: boolean) { real?.setLoop(l); },
            setPlaybackRate(r: number) { real?.setPlaybackRate(r); },
            get isPlaying() { return real?.isPlaying ?? false; },
            get currentTime() { return real?.currentTime ?? 0; },
            get duration() { return real?.duration ?? 0; },
            resolve(r: AudioHandle) { real = r; },
        };
        return handle;
    }
}

/** Resource handle for the per-app audio API. */
export const Audio = defineResource<AudioAPI>(null!, 'Audio');
