// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle, PlayConfig, AudioDelivery, AudioLoadOptions, AudioLoadType } from './PlatformAudioBackend';
import type { AudioMixer, BusDuckRule } from './AudioMixer';
import type { BusEffectDef } from './BusEffects';
import { defineResource } from '../ecs/resource';
import { RuntimeConfig } from '../defaults';
import { log } from '../util/logger';
import { disposeAll } from '../util/disposeAll';

/** `./a//b.mp3` and `a/b.mp3` are one clip. */
function normalizeClipPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

const hostSuspensions = new WeakMap<AudioAPI, { owners: Set<object>; sync(): void }>();

/** Internal host suspension, preserving explicit Audio.suspend/resume intent. */
export function setAudioHostSuspended(audio: AudioAPI, owner: object, suspended: boolean): void {
    const state = hostSuspensions.get(audio);
    if (!state) return;
    if (suspended) state.owners.add(owner); else state.owners.delete(owner);
    state.sync();
}

/**
 * One authored reference's residency record. Mirrors the texture pool's
 * three-state lifecycle: held (refCount > 0, pinned by Assets) →
 * evictable (refCount 0, warm cache bounded by the byte budget) →
 * evicted (backend buffer freed; a future load re-fetches).
 */
interface BufferEntry {
    handle: AudioBufferHandle;
    source: SharedAudioBuffer;
    /** Assets-held references. Direct play/preload entries stay at 0. */
    refCount: number;
}

interface SharedAudioBuffer {
    url: string;
    loading: Promise<AudioBufferHandle>;
    handle?: AudioBufferHandle;
    aliases: Set<string>;
    requests: Set<string>;
    charged: boolean;
}

interface PendingAudioBuffer {
    promise: Promise<void>;
    source: SharedAudioBuffer;
}

/** Buffer residency counters. See {@link AudioAPI.getBufferStats}. */
export interface AudioBufferStats {
    /** Authored cache entries; aliases can share one decoded allocation. */
    bufferCount: number;
    /** Unique decoded bytes resident (held + evictable entries). */
    bufferBytes: number;
    /** The effective byte budget (0 = warm cache off). */
    bufferBudget: number;
    /** Warm-cache entries (refCount 0) awaiting revive or eviction. */
    evictableCount: number;
    /** Clips played from their compressed file instead of being decoded (unique, not per alias). */
    streamedCount: number;
    /** The PCM those clips did not take, estimated from their length: what `bufferBytes` would be if they were decoded. */
    streamedSavedBytes: number;
}

/**
 * Per-app audio API. Each `App` owns an `AudioAPI` instance (created by
 * `AudioPlugin.build()`), exposed via the `Audio` resource.
 *
 * Consumed as a resource: declare `Res(Audio)` as a system param or
 * grab it with `app.getResource(Audio)` outside ECS code.
 */
/** A playing voice this API owns the volume of: base × bus gain × fade. */
/**
 * How many voices sound at once before `priority` decides. Beyond a couple of
 * dozen a listener hears loudness, not sounds, and a phone pays for every one.
 */
const DEFAULT_MAX_VOICES = 32;

/** The answer to "play this" when the pool is full and this voice lost: a handle
 *  that behaves like one whose sound already ended, so no caller special-cases it. */
function silentHandle(): AudioHandle {
    return {
        id: 0,
        stop() {}, pause() {}, resume() {},
        setVolume() {}, setPan() {}, setLoop() {}, setPlaybackRate() {},
        get isPlaying() { return false; },
        get currentTime() { return 0; },
        get duration() { return 0; },
    };
}

interface SoftVoice {
    handle: AudioHandle;
    publicHandle?: AudioHandle;
    paused: boolean;
    retired?: boolean;
    bus: string;
    base: number;
    fade: number;
    /** What this voice is worth when the pool is full — higher survives. */
    priority: number;
    /** Play order. A counter, not a clock: "older" has to be answered the same
     *  way twice for a test to pin the rule down, and two voices started in one
     *  frame share a timestamp. */
    seq: number;
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
    private readonly voiceStates_ = new WeakMap<AudioHandle, SoftVoice>();
    private readonly playbackStops_ = new Set<(generation: number) => void>();
    private readonly backend_: PlatformAudioBackend;
    private readonly mixer_: AudioMixer | null;
    private readonly bufferCache_ = new Map<string, BufferEntry>();
    private readonly loadingBuffers_ = new Map<string, PendingAudioBuffer>();
    private readonly bufferSources_ = new Map<string, SharedAudioBuffer>();
    /** refCount==0 urls in eviction order (oldest first); access re-appends. */
    private readonly evictOrder_ = new Set<string>();
    /** Urls a play is waiting on, by how many: not evictable until that play has started. */
    private readonly awaitingPlay_ = new Map<string, number>();
    /** Clips already reported as larger than the whole budget. */
    private readonly oversizeReported_ = new Set<string>();
    private residentBytes_ = 0;
    private bufferBudgetOverride_: number | null = null;
    /** Importer choices by authored path; a clip with none is `auto`. */
    private loadTypes_ = new Map<string, AudioLoadType>();
    private bgmHandle_: AudioHandle | null = null;
    private bgmRequest_ = 0;
    private playbackEpoch_ = 0;
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
    /**
     * How many voices may sound at once. There has to be a ceiling for
     * `priority` to mean anything: without one nothing is ever dropped, and the
     * field only describes an ordering that never happens.
     */
    private maxVoices_ = DEFAULT_MAX_VOICES;
    private voiceSeq_ = 0;
    // Handles mid fade-out. A cancelled fade RAF never reaches its handle.stop(),
    // so a rapid crossfade would orphan the outgoing track (playing forever) —
    // {@link cancelFades_} stops these when it tears the animations down.
    private readonly fadingOut_ = new Set<AudioHandle>();
    private disposed_ = false;
    private suspended_ = false;
    private deviceSuspended_ = false;
    private assetResolver_: ((url: string) => ArrayBuffer | null) | null = null;
    private refResolver_: ((ref: string) => string) | null = null;
    baseUrl = '';

    constructor(backend: PlatformAudioBackend, mixer: AudioMixer | null = null) {
        this.backend_ = backend;
        this.mixer_ = mixer;
        hostSuspensions.set(this, { owners: new Set(), sync: () => this.syncHostSuspension_() });
    }

    /** What this platform's backend needs in order to play a clip — asked by the
     *  asset loader, so a `url` backend is not made to wait on a fetch whose
     *  bytes it then drops. See {@link AudioDelivery}. */
    get delivery(): AudioDelivery {
        return this.backend_.delivery;
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

    /** End cached and pending loads for changed source bytes. Playing sources
     *  keep their decoded data; later loads fetch fresh. Returns whether a load ended. */
    invalidateBuffer(url: string): boolean {
        const entry = this.bufferCache_.get(url);
        let source = entry?.source ?? this.loadingBuffers_.get(url)?.source;
        if (!source) {
            try { source = this.bufferSources_.get(this.resolveUrl_(url)); } catch { return false; }
        }
        if (!source) return false;
        this.backend_.invalidateSource?.(source.url);
        if (this.bufferSources_.get(source.url) === source) this.bufferSources_.delete(source.url);
        for (const alias of source.requests) {
            if (this.loadingBuffers_.get(alias)?.source === source) this.loadingBuffers_.delete(alias);
        }
        for (const alias of [...source.aliases]) {
            const cached = this.bufferCache_.get(alias);
            if (cached?.source === source) this.freeBuffer_(alias, cached);
        }
        this.releaseSource_(source);
        return true;
    }

    /**
     * Free every evictable warm-cache buffer now (memory pressure). Held
     * buffers and the budget are untouched; the cache refills as buffers are
     * released afterwards. Returns the number of unique decoded buffers freed.
     */
    trimBufferCache(): number {
        let freed = 0;
        for (const url of [...this.evictOrder_]) {
            const entry = this.bufferCache_.get(url);
            if (entry && this.freeBuffer_(url, entry)) freed++;
        }
        return freed;
    }

    /**
     * How each clip the importer was told about is held. Keyed by the clip's project-relative path, the way
     * the asset loader and `play` address it; anything absent is `auto`. A clip already loaded keeps how it
     * was loaded until it is reloaded.
     */
    setLoadTypes(types: Readonly<Record<string, AudioLoadType>> | null): void {
        this.loadTypes_ = new Map(Object.entries(types ?? {}).map(([path, type]) => [normalizeClipPath(path), type]));
    }

    private loadOptions_(url: string): AudioLoadOptions | undefined {
        const loadType = this.loadTypes_.get(normalizeClipPath(url));
        return loadType ? { loadType } : undefined;
    }

    /** Buffer residency counters — the observability side of the budget. */
    getBufferStats(): AudioBufferStats {
        const seen = new Set<SharedAudioBuffer>();
        let streamedCount = 0;
        let streamedSavedBytes = 0;
        for (const entry of this.bufferCache_.values()) {
            if (!entry.handle.streamed || seen.has(entry.source)) continue;
            seen.add(entry.source);
            streamedCount++;
            streamedSavedBytes += entry.handle.savedBytes ?? 0;
        }
        return {
            streamedCount, streamedSavedBytes,
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
    private insertEntry_(url: string, handle: AudioBufferHandle, source: SharedAudioBuffer): void {
        const entry: BufferEntry = { handle, source, refCount: 0 };
        this.bufferCache_.set(url, entry);
        source.aliases.add(url);
        if (!source.charged) {
            source.charged = true;
            this.residentBytes_ += handle.bytes ?? 0;
            this.reportOversize_(url, handle);
            this.enforceBudget_();
        }
        this.evictOrder_.add(url);
    }

    /**
     * A clip that is larger than the whole budget cannot be kept warm: making room for it empties the cache,
     * and the next clip to load evicts it in turn, so it is decoded again every time it is played. Nothing
     * about that is visible from the game — the sound just starts late, or not at all — so it is said once.
     */
    private reportOversize_(url: string, handle: AudioBufferHandle): void {
        const bytes = handle.bytes ?? 0;
        const budget = this.bufferBudget;
        if (budget === 0 || bytes <= budget || this.oversizeReported_.has(url)) return;
        this.oversizeReported_.add(url);
        const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
        log.warn('audio', `${url} takes ${mb(bytes)} MB decoded, more than the whole ${mb(budget)} MB audio cache `
            + '(audioCacheBudget): it is dropped as soon as another clip loads and decoded again on its next play. '
            + "Set its import to 'streaming', or raise the budget");
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

    private freeBuffer_(url: string, entry: BufferEntry): boolean {
        if (this.bufferCache_.get(url) !== entry) return false;
        this.bufferCache_.delete(url);
        this.evictOrder_.delete(url);
        const source = entry.source;
        source.aliases.delete(url);
        if (source.aliases.size === 0 && source.charged) {
            source.charged = false;
            this.residentBytes_ -= entry.handle.bytes ?? 0;
        }
        return this.releaseSource_(source);
    }

    private releaseSource_(source: SharedAudioBuffer): boolean {
        if (source.aliases.size || source.requests.size) return false;
        if (this.bufferSources_.get(source.url) === source) this.bufferSources_.delete(source.url);
        const handle = source.handle;
        source.handle = undefined;
        if (handle) this.backend_.unloadBuffer(handle);
        return !!handle;
    }

    /** Evict oldest warm-cache entries until resident bytes fit the budget.
     *  Held (refCount > 0) entries are never evicted. */
    private enforceBudget_(): void {
        const budget = this.bufferBudget;
        if (budget === 0) return;
        for (const url of this.evictOrder_) {
            if (this.residentBytes_ <= budget) break;
            // A play is about to start on it: evicting it now is a sound that never happens.
            if (this.awaitingPlay_.has(url)) continue;
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

    /** Coalesce authored requests through their captured physical source. */
    private async ensureBuffer_(
        url: string, load: (source: string) => Promise<AudioBufferHandle>, sourceUrl?: string,
    ): Promise<void> {
        if (this.disposed_) return;
        if (this.bufferCache_.has(url)) return;
        // De-dupe concurrent loads of the same url — without this, two preloads
        // (esp. the loadBufferFromData path, which has no backend-side dedup)
        // both decode and orphan one AudioBuffer.
        const inFlight = this.loadingBuffers_.get(url);
        if (inFlight) return inFlight.promise;
        const resolved = sourceUrl ?? this.resolveUrl_(url);
        let source = this.bufferSources_.get(resolved);
        let start: (() => void) | undefined;
        if (!source) {
            let accept!: (buffer: AudioBufferHandle) => void, reject!: (error: unknown) => void;
            source = {
                url: resolved, aliases: new Set(), requests: new Set(), charged: false,
                loading: new Promise<AudioBufferHandle>((resolve, fail) => { accept = resolve; reject = fail; }),
            };
            const owned = source;
            this.bufferSources_.set(resolved, owned);
            start = () => {
                try {
                    void Promise.resolve(load(resolved)).then(buffer => { owned.handle = buffer; accept(buffer); }, reject);
                } catch (error) { reject(error); }
            };
        }
        const shared = source;
        shared.requests.add(url);
        let receipt!: PendingAudioBuffer;
        const promise = (async () => {
            try {
                const buffer = await shared.loading;
                if (this.disposed_ || this.loadingBuffers_.get(url) !== receipt) return;
                if (!this.bufferCache_.has(url)) this.insertEntry_(url, buffer, shared);
            } finally {
                if (this.loadingBuffers_.get(url) === receipt) this.loadingBuffers_.delete(url);
                shared.requests.delete(url);
                this.releaseSource_(shared);
            }
        })();
        receipt = { promise, source: shared };
        this.loadingBuffers_.set(url, receipt);
        // Install both ownership records before a backend can reenter the API.
        start?.();
        await promise;
    }

    async preload(url: string): Promise<void> {
        if (this.disposed_ || this.bufferCache_.has(url)) return;
        if (this.assetResolver_) {
            const data = this.assetResolver_(url);
            if (data) {
                return this.preloadFromData(url, data);
            }
        }
        const options = this.loadOptions_(url);
        await this.ensureBuffer_(url, source => (options ? this.backend_.loadBuffer(source, options) : this.backend_.loadBuffer(source)));
    }

    /**
     * Load `url` for a play that is waiting on it and start that play, as one step: the clip cannot be
     * evicted between arriving and being played, which is what a load finishing beside it used to do to a
     * clip larger than the budget. Says so when the clip is not there to play after all, instead of the
     * silence that left a game with no music and nothing in its log.
     */
    private async loadThenPlay_(url: string, what: string, play: (buffer: AudioBufferHandle) => void): Promise<void> {
        this.awaitingPlay_.set(url, (this.awaitingPlay_.get(url) ?? 0) + 1);
        try {
            await this.preload(url);
            if (this.disposed_) return;
            const buffer = this.lookupBuffer_(url);
            if (buffer) play(buffer);
            else log.warn('audio', `${what} did not play: ${url} loaded, but was gone from the audio cache before it could start`);
        } catch (err) {
            log.warn('audio', `Failed to preload ${what}: ${url}`, err);
        } finally {
            const left = (this.awaitingPlay_.get(url) ?? 1) - 1;
            if (left > 0) this.awaitingPlay_.set(url, left);
            else this.awaitingPlay_.delete(url);
        }
    }

    async preloadAll(urls: string[]): Promise<void> {
        await Promise.all(urls.map(url => this.preload(url)));
    }

    /**
     * Cache `url`'s clip from bytes the caller already holds. `url` is the
     * AUTHORED path this API is addressed by (the key `retainBuffer` and
     * `getBufferHandle` take); the backend is handed the RESOLVED source, which
     * for a `url`-delivery backend is the only thing it plays.
     */
    async preloadFromData(url: string, data: ArrayBuffer): Promise<void> {
        const options = this.loadOptions_(url);
        await this.ensureBuffer_(url, source => (options
            ? this.backend_.loadBufferFromData(source, data, options) : this.backend_.loadBufferFromData(source, data)));
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
        const epoch = this.playbackEpoch_;
        try {
            await this.ensureBuffer_(url, source => this.backend_.loadBuffer(source), url);
        } catch {
            return null;
        }
        if (this.disposed_ || epoch !== this.playbackEpoch_) return null;
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
        const epoch = this.playbackEpoch_;
        const playConfig = {
            bus: 'sfx',
            volume: config?.volume,
            playbackRate: config?.pitch,
            pan: config?.pan,
            priority: config?.priority ?? 0,
        };
        const buffer = this.lookupBuffer_(url);
        if (!buffer) {
            const pending = this.createDeferredHandle_(playConfig.volume ?? 1);
            void this.loadThenPlay_(url, 'audio', buf => {
                if (epoch !== this.playbackEpoch_ || pending.cancelled) return;
                pending.resolve(overrides => this.playVoice_(buf, { ...playConfig, ...overrides }));
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
        const request = ++this.bgmRequest_;
        const play = (buffer: AudioBufferHandle) => {
            if (this.disposed_ || request !== this.bgmRequest_) return;
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
            void this.loadThenPlay_(url, 'BGM', play);
        }
    }

    stopAll(): void {
        this.bgmRequest_++;
        const generation = ++this.playbackEpoch_;
        const voices = this.softVoices_;
        this.softVoices_ = [];
        this.bgmHandle_ = null;
        this.fades_.length = 0;
        this.fadingOut_.clear();
        const stopped = new Set<AudioHandle>();
        const actions: Array<() => void> = [];
        for (const voice of voices) {
            voice.paused = false; voice.retired = true;
            if (!stopped.has(voice.handle)) {
                stopped.add(voice.handle);
                actions.push(() => voice.handle.stop());
            }
        }
        for (const callback of this.playbackStops_) actions.push(() => callback(generation));
        disposeAll(actions, action => action());
    }

    /** @internal Generation boundary for pending playback intents. */
    get playbackGeneration(): number { return this.playbackEpoch_; }

    /** @internal Terminal and paused ownership comes from the global voice pool. */
    getVoiceState(handle: AudioHandle): 'playing' | 'paused' | 'ended' | 'stopped' | 'untracked' {
        const voice = this.voiceStates_.get(handle);
        if (!voice) return 'untracked';
        if (voice.retired) return 'stopped';
        return voice.paused ? 'paused' : voice.handle.isPlaying ? 'playing' : 'ended';
    }

    /** @internal Stop pending consumers after every old backend voice was stopped. */
    onPlaybackStop(callback: (generation: number) => void): () => void {
        this.playbackStops_.add(callback);
        return () => { this.playbackStops_.delete(callback); };
    }

    stopBGM(fadeOut?: number): void {
        this.bgmRequest_++;
        if (!this.bgmHandle_) {
            if (!(fadeOut && fadeOut > 0)) this.cancelFades_();
            return;
        }
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
        this.suspended_ = true;
        this.deviceSuspended_ = true;
    }

    /** Resume the audio device after {@link suspend}. */
    resume(): void {
        this.suspended_ = false;
        if (!hostSuspensions.get(this)?.owners.size) {
            this.backend_.resume(); this.deviceSuspended_ = false;
        }
    }

    private syncHostSuspension_(): void {
        const suspended = this.suspended_ || !!hostSuspensions.get(this)?.owners.size;
        if (this.disposed_ || suspended === this.deviceSuspended_) return;
        this.deviceSuspended_ = suspended;
        if (suspended) this.backend_.suspend(); else this.backend_.resume();
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
        this.softVoices_ = this.softVoices_.filter((v) => v.paused || v.handle.isPlaying || this.fadeOf_(v) !== null);
        for (const voice of this.softVoices_) {
            if (busName === 'master' || voice.bus === busName) this.applyVoice_(voice);
        }
    }

    private fadeOf_(voice: SoftVoice): Fade | null {
        return this.fades_.find((f) => f.voice === voice) ?? null;
    }

    /** Play through the backend as a tracked voice, so bus gain and fades have
     *  one place to act — on every platform, mixer graph or not. */
    /**
     * Play an already-resolved buffer. The one door every voice comes through —
     * a scripted `playSFX`, a `playBGM`, an `AudioSource` in the scene — so the
     * bus gain a backend without a mixer graph cannot apply, and the voice cap
     * `priority` is measured against, are decided once for all of them.
     */
    playBuffer(buffer: AudioBufferHandle, config?: PlayConfig): AudioHandle {
        if (config?.bus) this.ensureBus(config.bus);
        return this.playVoice_(buffer, config ?? {});
    }

    /** The voice ceiling; 0 or less means no cap. @see playBuffer */
    setMaxVoices(max: number): void {
        this.maxVoices_ = Number.isFinite(max) ? Math.floor(max) : DEFAULT_MAX_VOICES;
    }

    get maxVoices(): number { return this.maxVoices_; }

    private playVoice_(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        if (this.disposed_) return silentHandle();
        const bus = config.bus ?? 'sfx';
        const base = config.volume ?? 1;
        const priority = config.priority ?? 0;
        if (!this.makeRoomForVoice_(priority)) return silentHandle();
        const handle = this.backend_.play(buffer, { ...config, volume: base * this.softGain_(bus) });
        const voice: SoftVoice = { handle, bus, base, fade: 1, paused: false, priority, seq: this.voiceSeq_++ };
        const api = this;
        const managed: AudioHandle = {
            get id() { return handle.id; },
            stop() { if (!voice.retired) { voice.retired = true; voice.paused = false; handle.stop(); } },
            pause() {
                if (!handle.isPlaying) return;
                handle.pause();
                voice.paused = !handle.isPlaying;
            },
            resume() {
                if (!voice.paused || api.disposed_ || !api.softVoices_.includes(voice)) return;
                handle.resume();
                if (handle.isPlaying) voice.paused = false;
            },
            setVolume(volume) {
                voice.base = volume;
                if (!api.disposed_ && (voice.paused || handle.isPlaying)) api.applyVoice_(voice);
            },
            setPan(pan) { if (!api.disposed_ && (voice.paused || handle.isPlaying)) handle.setPan(pan); },
            setLoop(loop) { handle.setLoop(loop); },
            setPlaybackRate(rate) { handle.setPlaybackRate(rate); },
            get isPlaying() { return handle.isPlaying; },
            get currentTime() { return handle.currentTime; },
            get duration() { return handle.duration; },
            get onEnd() { return handle.onEnd; },
            set onEnd(callback) { handle.onEnd = callback; },
        };
        voice.publicHandle = managed;
        this.voiceStates_.set(managed, voice);
        this.softVoices_.push(voice);
        return managed;
    }

    /**
     * Drop the least valuable voice if the pool is full, so a new one of
     * @p priority can sound. False when the new voice is the least valuable
     * itself. Ties go to the OLDER voice, which is what keeps a repeated sound
     * audible: every shot of a machine gun is worth the same.
     */
    private makeRoomForVoice_(priority: number): boolean {
        this.softVoices_ = this.softVoices_.filter(
            (v) => v.paused || v.handle.isPlaying || this.fadeOf_(v) !== null,
        );
        if (this.maxVoices_ <= 0 || this.softVoices_.length < this.maxVoices_) return true;

        let weakest: SoftVoice | null = null;
        for (const v of this.softVoices_) {
            if (!weakest || v.priority < weakest.priority
                || (v.priority === weakest.priority && v.seq < weakest.seq)) {
                weakest = v;
            }
        }
        if (!weakest || weakest.priority > priority) return false;
        weakest.paused = false;
        weakest.retired = true;
        weakest.handle.stop();
        this.softVoices_ = this.softVoices_.filter((v) => v !== weakest);
        return true;
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

    /**
     * Whether this backend has a mixer graph at all. @experimental
     *
     * The fact behind every `false` the bus calls below return, reported once so a
     * reader does not have to infer a capability from a failed write. Without one,
     * {@link applyAudioProjectConfig} applies `maxVoices` and stops before the bus
     * list — so an authored mixer is not partly applied, it is not applied.
     */
    hasMixerGraph(): boolean {
        return this.mixer_ !== null;
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
        // Scripted effects and AudioSource voices also belong to this device.
        // Closing a Web Audio context alone leaves their handles marked playing,
        // and a different backend may require explicit stops before disposal.
        disposeAll([() => this.stopAll(), () => this.playbackStops_.clear(), () => {
            this.loadingBuffers_.clear();
            try { disposeAll([...this.bufferCache_], ([url, entry]) => { this.freeBuffer_(url, entry); }); }
            finally { this.bufferCache_.clear(); this.bufferSources_.clear(); this.evictOrder_.clear(); this.residentBytes_ = 0; }
        }, () => this.backend_?.dispose()], action => action());
    }

    /**
     * Advance every fade by `dt` seconds — called once a frame by the audio
     * system, which is what makes a fade the game's clock rather than the
     * browser's: it pauses when the game does, and it exists on a device.
     */
    updateFades(dt: number): void {
        if (this.suspended_ || this.fades_.length === 0 || !(dt > 0)) return;
        for (let i = this.fades_.length - 1; i >= 0; i--) {
            const fade = this.fades_[i];
            if (fade.voice.paused) continue;
            if (!fade.voice.handle.isPlaying) {
                this.fadingOut_.delete(fade.voice.publicHandle ?? fade.voice.handle);
                this.fades_.splice(i, 1);
                continue;
            }
            fade.elapsed += dt;
            const t = fade.duration > 0 ? Math.min(fade.elapsed / fade.duration, 1) : 1;
            fade.voice.fade = fade.from + (fade.to - fade.from) * t;
            this.applyVoice_(fade.voice);
            // A track that ended (or was stopped) mid-ramp takes its fade with it.
            if (t >= 1) {
                if (fade.stopAtEnd) {
                    fade.voice.handle.stop();
                    this.fadingOut_.delete(fade.voice.publicHandle ?? fade.voice.handle);
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
        const found = this.softVoices_.find((v) => v.handle === handle || v.publicHandle === handle);
        if (found) return found;
        const voice: SoftVoice = { handle, bus, base, fade: 1, paused: false, priority: 0, seq: this.voiceSeq_++ };
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

    private createDeferredHandle_(baseVolume: number): AudioHandle & {
        readonly cancelled: boolean;
        resolve(start: (overrides: PlayConfig) => AudioHandle): void;
    } {
        let real: AudioHandle | null = null;
        let stopped = false, paused = false, endAssigned = false;
        let ended: (() => void) | undefined;
        const overrides: PlayConfig = {};
        return {
            get id() { return real?.id ?? -1; },
            get cancelled() { return stopped; },
            stop() { if (!stopped) { stopped = true; real?.stop(); } },
            pause() { if (!stopped) { paused = true; real?.pause(); } },
            resume() { if (!stopped) { paused = false; real?.resume(); } },
            setVolume(v) { if (!stopped) { overrides.volume = v; real?.setVolume(v); } },
            setPan(p) { if (!stopped) { overrides.pan = p; real?.setPan(p); } },
            setLoop(l) { if (!stopped) { overrides.loop = l; real?.setLoop(l); } },
            setPlaybackRate(r) { if (!stopped) { overrides.playbackRate = r; real?.setPlaybackRate(r); } },
            get isPlaying() { return real?.isPlaying ?? false; },
            get currentTime() { return real?.currentTime ?? 0; },
            get duration() { return real?.duration ?? 0; },
            get onEnd() { return real ? real.onEnd : ended; },
            set onEnd(callback) {
                ended = callback;
                endAssigned = true;
                if (real) real.onEnd = callback;
            },
            resolve(start) {
                if (stopped || real) return;
                const next = start(paused ? { ...overrides, volume: 0 } : overrides);
                if (stopped) { next.stop(); return; }
                real = next;
                if (endAssigned) real.onEnd = ended;
                if (paused) {
                    real.pause();
                    real.setVolume(overrides.volume ?? baseVolume);
                }
            },
        };
    }
}

/** Resource handle for the per-app audio API. */
/**
 * Playback, buses and mixing, as `Res(Audio)` hands it over.
 *
 * `@beta`: a certified run now drives a loop and reads the master bus's analyser,
 * so a break here is noticed — but the corpus reaches a handful of twenty-three
 * audio symbols, which is thin evidence for freezing the shape.
 *
 * @beta
 */
export const Audio = defineResource<AudioAPI>(null!, 'Audio');
