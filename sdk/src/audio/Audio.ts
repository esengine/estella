// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle, PlayConfig } from './PlatformAudioBackend';
import type { AudioMixer, BusDuckRule } from './AudioMixer';
import type { BusEffectDef } from './BusEffects';
import { defineResource } from '../ecs/resource';
import { RuntimeConfig } from '../defaults';
import { log } from '../util/logger';

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
/** A playing voice this API owns the volume of: base × bus gain × fade. */
interface SoftVoice {
    handle: AudioHandle;
    bus: string;
    base: number;
    fade: number;
}

/** One volume ramp in flight: a linear interpolation the frame loop advances. */
interface Fade {
    voice: SoftVoice;
    /** Fade FACTORS (0..1), multiplied onto the voice's base volume. */
    from: number;
    to: number;
    duration: number;
    elapsed: number;
    /** A fade-out stops its track when it reaches silence. */
    stopAtEnd: boolean;
}

export class AudioAPI {
    private readonly backend_: PlatformAudioBackend;
    private readonly mixer_: AudioMixer | null;
    private readonly bufferCache_ = new Map<string, BufferEntry>();
    private readonly loadingBuffers_ = new Map<string, Promise<void>>();
    /** refCount==0 urls in eviction order (oldest first); access re-appends. */
    private readonly evictOrder_ = new Set<string>();
    private residentBytes_ = 0;
    private bufferBudgetOverride_: number | null = null;
    private bgmHandle_: AudioHandle | null = null;
    private bgmVolume_ = 1.0;
    /** Volume ramps in flight, advanced by {@link updateFades} from the frame
     *  loop — NOT by requestAnimationFrame, which is a browser global a device
     *  does not have (and which would keep ramping while the game is paused). */
    private readonly fades_: Fade[] = [];

    /**
     * Bus volume / mute for a backend with no mixer GRAPH (a device, WeChat):
     * the mixer's gain nodes are one way to apply a bus, not the meaning of one,
     * so where there are no nodes the gain is folded into each voice instead —
     * at play, and again on every voice already playing when a bus changes. The
     * mixer stays authoritative wherever it exists.
     */
    private readonly softBuses_ = new Map<string, { volume: number; muted: boolean }>();
    /** Voices whose volume this API computes: base × bus gain × fade. */
    private softVoices_: SoftVoice[] = [];
    // Handles mid fade-out. A cancelled fade RAF never reaches its handle.stop(),
    // so a rapid crossfade would orphan the outgoing track (playing forever) —
    // {@link cancelFades_} stops these when it tears the animations down.
    private readonly fadingOut_ = new Set<AudioHandle>();
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

    /** Load `url`'s buffer into the residency cache unless already there. The
     *  double `has()` check absorbs a concurrent load racing to insert first. */
    private async ensureBuffer_(url: string, load: () => Promise<AudioBufferHandle>): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        // De-dupe concurrent loads of the same url — without this, two preloads
        // (esp. the loadBufferFromData path, which has no backend-side dedup)
        // both decode and orphan one AudioBuffer.
        const inFlight = this.loadingBuffers_.get(url);
        if (inFlight) return inFlight;
        const promise = (async () => {
            const buffer = await load();
            if (!this.bufferCache_.has(url)) this.insertEntry_(url, buffer);
        })();
        this.loadingBuffers_.set(url, promise);
        try {
            await promise;
        } finally {
            this.loadingBuffers_.delete(url);
        }
    }

    async preload(url: string): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        if (this.assetResolver_) {
            const data = this.assetResolver_(url);
            if (data) {
                return this.preloadFromData(url, data);
            }
        }
        await this.ensureBuffer_(url, () => this.backend_.loadBuffer(this.resolveUrl_(url)));
    }

    async preloadAll(urls: string[]): Promise<void> {
        await Promise.all(urls.map(url => this.preload(url)));
    }

    async preloadFromData(url: string, data: ArrayBuffer): Promise<void> {
        await this.ensureBuffer_(url, () => this.backend_.loadBufferFromData(url, data));
    }

    /**
     * Play a fully-RESOLVED clip URL on an explicit bus (created on demand
     * under master). Unlike playSFX/playBGM this applies no ref resolution —
     * the caller already holds the final URL (the video system's audio track
     * derives it from the resolved video source). Null when the clip can't
     * load; loaded buffers share the residency cache.
     */
    async playTrack(url: string, config: PlayConfig = {}): Promise<AudioHandle | null> {
        if (this.disposed_) return null;
        try {
            await this.ensureBuffer_(url, () => this.backend_.loadBuffer(url));
        } catch {
            return null;
        }
        if (this.disposed_) return null;
        const buffer = this.lookupBuffer_(url);
        if (!buffer) return null;
        if (config.bus) this.ensureBus(config.bus);
        return this.playVoice_(buffer, config);
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
                    pending.resolve(this.playVoice_(buf, playConfig));
                }
            }).catch(err => {
                log.warn('audio', `Failed to preload audio: ${url}`, err);
            });
            return pending;
        }
        return this.playVoice_(buffer, playConfig);
    }

    playBGM(url: string, config?: {
        volume?: number;
        fadeIn?: number;
        crossFade?: number;
    }): void {
        const play = (buffer: AudioBufferHandle) => {
            this.cancelFades_();

            const targetVolume = config?.volume ?? 1.0;
            const oldVolume = this.bgmVolume_;
            this.bgmVolume_ = targetVolume;

            if (this.bgmHandle_ && config?.crossFade) {
                this.fadeOut_(this.bgmHandle_, config.crossFade, oldVolume);
            } else if (this.bgmHandle_) {
                this.bgmHandle_.stop();
            }
            const fadeInDuration = config?.fadeIn ?? config?.crossFade;

            this.bgmHandle_ = this.playVoice_(buffer, {
                bus: 'music',
                volume: targetVolume,
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
        this.cancelFades_();
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    stopBGM(fadeOut?: number): void {
        if (!this.bgmHandle_) return;
        this.cancelFades_();
        if (fadeOut && fadeOut > 0) {
            const handle = this.bgmHandle_;
            this.bgmHandle_ = null;
            this.fadeOut_(handle, fadeOut, this.bgmVolume_);
        } else {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    /**
     * Suspend the whole audio device (every voice, every bus) without touching
     * any volume the user set — the device-level pause a fullscreen takeover
     * (a rewarded ad, an OS interruption) wants, where per-bus volumes would
     * fight the mixer's own state. Balanced by {@link resume}.
     */
    suspend(): void {
        this.backend_.suspend();
    }

    /** Resume the audio device after {@link suspend}. */
    resume(): void {
        this.backend_.resume();
    }

    setMasterVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.master.volume = volume;
            return;
        }
        this.setSoftBus_('master', { volume });
    }

    setMusicVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.music.volume = volume;
            return;
        }
        this.setSoftBus_('music', { volume });
    }

    setSFXVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.sfx.volume = volume;
            return;
        }
        this.setSoftBus_('sfx', { volume });
    }

    setUIVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.ui.volume = volume;
            return;
        }
        this.setSoftBus_('ui', { volume });
    }

    /** Mixerless backends (WeChat/Null) report unity volume and unmuted —
     *  the read-side mirror of the volume setters' silent no-op there. */
    getMasterVolume(): number {
        return this.mixer_?.master.volume ?? 1;
    }

    getMusicVolume(): number {
        return this.mixer_?.music.volume ?? 1;
    }

    getSFXVolume(): number {
        return this.mixer_?.sfx.volume ?? 1;
    }

    getUIVolume(): number {
        return this.mixer_?.ui.volume ?? 1;
    }

    /** Unity (1) for an unknown bus. */
    getBusVolume(busName: string): number {
        if (this.mixer_) return this.mixer_.getBus(busName)?.volume ?? 1;
        return this.softBuses_.get(busName)?.volume ?? 1;
    }

    isBusMuted(busName: string): boolean {
        if (this.mixer_) return this.mixer_.getBus(busName)?.muted ?? false;
        return this.softBuses_.get(busName)?.muted ?? false;
    }

    /** Record a bus change for a mixerless backend and push it to live voices —
     *  what a gain node would have done to the tracks already playing. */
    private setSoftBus_(busName: string, change: { volume?: number; muted?: boolean }): void {
        const bus = this.softBuses_.get(busName) ?? { volume: 1, muted: false };
        if (change.volume !== undefined) bus.volume = change.volume;
        if (change.muted !== undefined) bus.muted = change.muted;
        this.softBuses_.set(busName, bus);
        this.applyBus_(busName);
    }

    /** The gain a mixerless backend folds into a voice: its bus, times master. */
    private softGain_(busName: string): number {
        if (this.mixer_) return 1;   // the graph already applies it
        const gainOf = (name: string): number => {
            const bus = this.softBuses_.get(name);
            if (!bus) return 1;
            return bus.muted ? 0 : bus.volume;
        };
        return busName === 'master' ? gainOf('master') : gainOf(busName) * gainOf('master');
    }

    /** Push a voice's computed volume to the backend. */
    private applyVoice_(voice: SoftVoice): void {
        voice.handle.setVolume(voice.base * this.softGain_(voice.bus) * voice.fade);
    }

    /** Re-apply after a bus (or master) changed, and forget voices that ended. */
    private applyBus_(busName: string): void {
        this.softVoices_ = this.softVoices_.filter((v) => v.handle.isPlaying || this.fadeOf_(v) !== null);
        for (const voice of this.softVoices_) {
            if (busName === 'master' || voice.bus === busName) this.applyVoice_(voice);
        }
    }

    private fadeOf_(voice: SoftVoice): Fade | null {
        return this.fades_.find((f) => f.voice === voice) ?? null;
    }

    /** Play through the backend as a tracked voice, so bus gain and fades have
     *  one place to act — on every platform, mixer graph or not. */
    private playVoice_(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        const bus = config.bus ?? 'sfx';
        const base = config.volume ?? 1;
        const handle = this.backend_.play(buffer, { ...config, volume: base * this.softGain_(bus) });
        this.softVoices_.push({ handle, bus, base, fade: 1 });
        if (this.softVoices_.length > 64) {
            this.softVoices_ = this.softVoices_.filter((v) => v.handle.isPlaying);
        }
        return handle;
    }

    muteBus(busName: string, muted: boolean): void {
        if (!this.mixer_) {
            this.setSoftBus_(busName, { muted });
            return;
        }
        const bus = this.mixer_.getBus(busName);
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
        if (!this.mixer_) {
            this.setSoftBus_(busName, { volume });
            return;
        }
        const bus = this.mixer_.getBus(busName);
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
        this.cancelFades_();
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

    /**
     * Advance every fade by `dt` seconds — called once a frame by the audio
     * system, which is what makes a fade the game's clock rather than the
     * browser's: it pauses when the game does, and it exists on a device.
     */
    updateFades(dt: number): void {
        if (this.fades_.length === 0 || !(dt > 0)) return;
        for (let i = this.fades_.length - 1; i >= 0; i--) {
            const fade = this.fades_[i];
            fade.elapsed += dt;
            const t = fade.duration > 0 ? Math.min(fade.elapsed / fade.duration, 1) : 1;
            fade.voice.fade = fade.from + (fade.to - fade.from) * t;
            this.applyVoice_(fade.voice);
            // A track that ended (or was stopped) mid-ramp takes its fade with it.
            if (t >= 1 || !fade.voice.handle.isPlaying) {
                if (fade.stopAtEnd) {
                    fade.voice.handle.stop();
                    this.fadingOut_.delete(fade.voice.handle);
                }
                this.fades_.splice(i, 1);
            }
        }
    }

    private fadeIn_(handle: AudioHandle, duration: number, targetVolume: number): void {
        const voice = this.voiceOf_(handle, targetVolume, 'music');
        voice.base = targetVolume;
        voice.fade = 0;
        this.applyVoice_(voice);
        this.fades_.push({ voice, from: 0, to: 1, duration, elapsed: 0, stopAtEnd: false });
    }

    /** The tracked voice for a handle, registering one if it came from outside
     *  the play path (a deferred handle resolved later). */
    private voiceOf_(handle: AudioHandle, base: number, bus: string): SoftVoice {
        const found = this.softVoices_.find((v) => v.handle === handle);
        if (found) return found;
        const voice: SoftVoice = { handle, bus, base, fade: 1 };
        this.softVoices_.push(voice);
        return voice;
    }

    /** Cancel every in-flight fade AND stop the tracks that were fading out — a
     *  cancelled fade would otherwise never reach their `stop()`. */
    private cancelFades_(): void {
        this.fades_.length = 0;
        for (const h of this.fadingOut_) h.stop();
        this.fadingOut_.clear();
    }

    private fadeOut_(handle: AudioHandle, duration: number, startVolume: number): void {
        this.fadingOut_.add(handle);
        const voice = this.voiceOf_(handle, startVolume, 'music');
        this.fades_.push({ voice, from: voice.fade, to: 0, duration, elapsed: 0, stopAtEnd: true });
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
/**
 * Playback, buses and mixing, as `Res(Audio)` hands it over.
 *
 * Deliberately NOT `@beta`, which would claim the shape is supported: no example
 * in the repository uses audio at all, so nothing would notice a break in it. It
 * stays experimental until something certifies it — see the `audio` entry in
 * KNOWN_GAPS.
 */
export const Audio = defineResource<AudioAPI>(null!, 'Audio');
