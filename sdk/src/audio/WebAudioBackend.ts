// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions, AudioLoadOptions } from './PlatformAudioBackend';
import { clipSpan } from './PlatformAudioBackend';
import { decodedPcmBytes, estimateAudioSeconds, shouldStream } from './audioStreaming';
import { AudioMixer } from './AudioMixer';
import { AudioPool, type PooledAudioNode } from './AudioPool';
import { getPlatform } from '../platform/base';
import { log } from '../util/logger';

class WebAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    /** Runtime references exist until Stop or natural completion; Pause retains them. */
    private buffer_: AudioBuffer | null;
    private source_: AudioBufferSourceNode | null;
    private poolNode_: PooledAudioNode | null;
    private pool_: AudioPool | null;
    private context_: AudioContext | null;
    private playing_ = true;
    private stopped_ = false;
    private pausedAt_ = 0;
    private startedAt_: number;
    private startOffset_: number;
    private playbackRate_: number;
    private loop_: boolean;
    /** Where a loop comes back to, as a place in the buffer; the clip's own start where no loop start was given. */
    private readonly loopStart_: number;
    /** Where the clip begins and ends in the buffer. Times given out are counted from its beginning. */
    private readonly lead_: number;
    private readonly end_: number;
    private readonly duration_: number;

    constructor(
        id: number,
        source: AudioBufferSourceNode,
        buffer: AudioBuffer,
        poolNode: PooledAudioNode,
        pool: AudioPool,
        context: AudioContext,
        startOffset: number,
        loopStart = 0,
        lead = 0,
        end = buffer.duration,
        startedAt = context.currentTime,
    ) {
        this.id = id;
        this.source_ = source;
        this.buffer_ = buffer;
        this.lead_ = lead;
        this.end_ = end;
        this.duration_ = end - lead;
        this.poolNode_ = poolNode;
        this.pool_ = pool;
        this.context_ = context;
        this.startOffset_ = startOffset;
        this.startedAt_ = startedAt;
        this.playbackRate_ = source.playbackRate.value;
        this.loop_ = source.loop;
        this.loopStart_ = loopStart;

        this.bindOnEnded_(source);
    }

    private bindOnEnded_(source: AudioBufferSourceNode): void {
        source.onended = () => {
            if (!this.stopped_ && this.playing_ && source === this.source_ && !this.loop_) {
                this.release_();
                this.onEnd?.();
            }
        };
    }

    stop(): void {
        if (this.stopped_) return;
        this.release_();
    }

    private release_(): void {
        this.stopped_ = true;
        this.playing_ = false;
        if (this.source_) this.source_.onended = null;
        this.pool_!.release(this.poolNode_!);
        this.buffer_ = null;
        this.source_ = null;
        this.poolNode_ = null;
        this.pool_ = null;
        this.context_ = null;
    }

    pause(): void {
        if (!this.playing_ || this.stopped_) return;
        this.playing_ = false;
        const elapsed = (this.context_!.currentTime - this.startedAt_) * this.playbackRate_;
        this.pausedAt_ = this.startOffset_ + elapsed;
        if (this.loop_ && this.buffer_!.duration > 0) this.pausedAt_ = this.wrapped_(this.pausedAt_);
        this.source_!.onended = null;
        try { this.source_!.stop(); } catch (_) { /* already stopped */ }
        this.source_!.disconnect();
    }

    /** A place in the clip for a time since it began: past the end, it has been round from the loop's start. */
    private wrapped_(position: number): number {
        const end = this.end_;
        if (position < end) return position;
        const round = end - this.loopStart_;
        return round > 0 ? this.loopStart_ + ((position - this.loopStart_) % round) : position % end;
    }

    resume(): void {
        if (this.playing_ || this.stopped_) return;

        const source = this.context_!.createBufferSource();
        let startedAt: number;
        try {
            source.buffer = this.buffer_;
            source.loop = this.loop_;
            if (this.loop_ && (this.loopStart_ > 0 || this.end_ < this.buffer_!.duration)) { source.loopStart = this.loopStart_; source.loopEnd = this.end_; }
            source.playbackRate.value = this.playbackRate_;
            source.connect(this.poolNode_!.gain);
            this.bindOnEnded_(source);
            startedAt = this.context_!.currentTime;
            source.start(0, this.pausedAt_);
        } catch (error) {
            source.onended = null;
            try { source.stop(); } catch (_) { /* not started */ }
            source.disconnect();
            throw error;
        }

        this.source_ = source;
        this.poolNode_!.source = source;
        this.startOffset_ = this.pausedAt_;
        this.startedAt_ = startedAt;

        this.playing_ = true;
    }

    setVolume(volume: number): void {
        if (this.stopped_) return;
        this.poolNode_!.gain.gain.value = volume;
    }

    setPan(pan: number): void {
        if (this.stopped_) return;
        this.poolNode_!.panner.pan.value = pan;
    }

    setLoop(loop: boolean): void {
        if (this.stopped_) return;
        this.loop_ = loop;
        this.source_!.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        if (this.stopped_) return;
        if (this.playing_) {
            const now = this.context_!.currentTime;
            const position = this.startOffset_ + (now - this.startedAt_) * this.playbackRate_;
            this.source_!.playbackRate.value = rate;
            this.startOffset_ = position;
            this.startedAt_ = now;
        }
        this.playbackRate_ = rate;
    }

    get isPlaying(): boolean {
        return this.playing_;
    }

    get currentTime(): number {
        if (this.stopped_) return 0;
        if (!this.playing_) return this.pausedAt_ - this.lead_;
        const elapsed = (this.context_!.currentTime - this.startedAt_) * this.playbackRate_;
        return this.startOffset_ + elapsed - this.lead_;
    }

    get duration(): number {
        return this.duration_;
    }
}

/**
 * A clip played from its compressed file through a media element, routed into the same pooled gain / pan
 * and bus as a decoded one, so volume, buses, effects and fades treat it alike.
 * Gives up a sample-accurate loop point and a second simultaneous voice: playing the clip again ends the first.
 */
class WebStreamHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private element_: HTMLAudioElement | null;
    private node_: MediaElementAudioSourceNode | null;
    private poolNode_: PooledAudioNode | null;
    private pool_: AudioPool | null;
    private playing_ = false;
    private stopped_ = false;
    private readonly duration_: number;
    private readonly onRelease_: (handle: WebStreamHandle) => void;
    private readonly ensureResumed_: () => Promise<void>;
    /** A loop that comes back to somewhere other than the start: the element cannot, so it is sent back when it ends. */
    private loopFrom_ = 0;
    private looping_ = false;

    constructor(
        id: number, element: HTMLAudioElement, node: MediaElementAudioSourceNode, poolNode: PooledAudioNode,
        pool: AudioPool, duration: number, onRelease: (handle: WebStreamHandle) => void, ensureResumed: () => Promise<void>,
        loopStart = 0,
    ) {
        this.id = id;
        this.element_ = element;
        this.node_ = node;
        this.poolNode_ = poolNode;
        this.pool_ = pool;
        this.duration_ = duration;
        this.onRelease_ = onRelease;
        this.ensureResumed_ = ensureResumed;
        poolNode.source = node;
        if (loopStart > 0 && element.loop) {
            this.loopFrom_ = loopStart;
            this.looping_ = true;
            element.loop = false;
        }
        element.onended = () => {
            if (this.stopped_ || element.loop) return;
            if (this.looping_ && this.playing_) { this.begin(this.loopFrom_); return; }
            this.release_();
            this.onEnd?.();
        };
    }

    /** Start (or restart) the element. A browser that blocks it until a gesture is retried once the context resumes. */
    begin(startOffset: number): void {
        const element = this.element_;
        if (!element) return;
        if (startOffset > 0) element.currentTime = startOffset;
        this.playing_ = true;
        const started = element.play();
        if (started) {
            started.catch(async () => {
                if (this.stopped_ || !this.playing_) return;
                await this.ensureResumed_().catch(() => undefined);
                if (!this.stopped_ && this.playing_) await element.play().catch(() => { this.playing_ = false; });
            });
        }
    }

    stop(): void {
        if (this.stopped_) return;
        this.release_();
    }

    private release_(): void {
        this.stopped_ = true;
        this.playing_ = false;
        const element = this.element_;
        if (element) {
            element.onended = null;
            element.pause();
            element.removeAttribute('src');
            element.load();
        }
        this.node_?.disconnect();
        if (this.poolNode_ && this.pool_) this.pool_.release(this.poolNode_);
        this.element_ = null;
        this.node_ = null;
        this.poolNode_ = null;
        this.pool_ = null;
        this.onRelease_(this);
    }

    pause(): void {
        if (!this.playing_ || this.stopped_) return;
        this.playing_ = false;
        this.element_?.pause();
    }

    resume(): void {
        if (this.playing_ || this.stopped_) return;
        this.begin(0);
    }

    /** The host suspended the device: hold the element where it is. It still counts as playing, as a decoded voice does. */
    holdForSuspend(): boolean {
        if (!this.playing_ || this.stopped_) return false;
        this.element_?.pause();
        return true;
    }

    /** The device is running again: carry on from where the hold left the element. */
    continueAfterSuspend(): void {
        if (this.playing_ && !this.stopped_) this.begin(0);
    }

    setVolume(volume: number): void {
        if (this.stopped_) return;
        this.poolNode_!.gain.gain.value = volume;
    }

    setPan(pan: number): void {
        if (this.stopped_) return;
        this.poolNode_!.panner.pan.value = pan;
    }

    setLoop(loop: boolean): void {
        if (this.stopped_ || !this.element_) return;
        if (this.loopFrom_ > 0) this.looping_ = loop;
        else this.element_.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        if (this.stopped_ || !this.element_) return;
        this.element_.playbackRate = rate;
    }

    get isPlaying(): boolean {
        return this.playing_;
    }

    get currentTime(): number {
        return this.element_ ? this.element_.currentTime : 0;
    }

    get duration(): number {
        return this.duration_;
    }
}

/** How long to wait for an element's metadata before trusting the header estimate. */
const METADATA_WAIT_MS = 3000;

/** Decoded PCM size of a WebAudio buffer: frames × channels × 4 (Float32). */
function decodedBytes(buf: AudioBuffer): number {
    return buf.length * buf.numberOfChannels * 4;
}

interface BufferRecord {
    buffer: AudioBuffer | null;
    url: string;
    /** Where the clip really lies in the decoded buffer, for one the exporter re-encoded: from `lead` to `end`, in seconds. */
    span?: { lead: number; end: number };
    /** A streamed clip: the object URL its media element plays, and its length. */
    stream?: { objectUrl: string; duration: number; lead?: number };
}

interface SourceRecord {
    pending: number;
    bufferId?: number;
}

const MIME: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm',
};

function mimeOf(url: string): string {
    const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
    return (ext && MIME[ext]) || '';
}

/** The length a media element reports for `objectUrl`, or `estimate` (or 0) when it will not say in time. */
function probeDuration(objectUrl: string, estimate: number | null): Promise<number> {
    return new Promise((resolve) => {
        const element = new Audio();
        let done = false;
        const finish = (seconds: number | null): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            element.removeAttribute('src');
            element.load();
            resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : (estimate ?? 0));
        };
        const timer = setTimeout(() => finish(null), METADATA_WAIT_MS);
        element.preload = 'metadata';
        element.onloadedmetadata = () => finish(element.duration);
        element.onerror = () => finish(null);
        element.src = objectUrl;
    });
}

export class WebAudioBackend implements PlatformAudioBackend {
    readonly name = 'WebAudio';
    readonly delivery = 'bytes' as const;

    private context_: AudioContext | null = null;
    private mixer_: AudioMixer | null = null;
    private pool_: AudioPool | null = null;
    private buffers_ = new Map<number, BufferRecord>();
    private loadingUrls_ = new Map<string, Promise<AudioBufferHandle>>();
    /** Only current cached or pending sources; identity separates invalidated loads. */
    private sources_ = new Map<string, SourceRecord>();
    private nextBufferId_ = 0;
    private nextHandleId_ = 0;
    private resumeHandler_: (() => void) | null = null;
    private explicitlySuspended_ = false;
    private deviceIntentRevision_ = 0;
    private contextGeneration_ = 0;
    private analyser_: AnalyserNode | null = null;
    /** The streamed voice sounding for each streamed clip (one at a time, see WebStreamHandle). */
    private readonly streams_ = new Map<number, WebStreamHandle>();
    /** Streams a suspended device paused, to start again when it resumes. */
    private heldStreams_: WebStreamHandle[] = [];
    /** Streamed clips unloaded while still sounding: their object URL is revoked when the voice ends. */
    private readonly retiredStreams_ = new Map<WebStreamHandle, string>();

    get mixer(): AudioMixer | null {
        return this.mixer_;
    }

    get isReady(): boolean {
        return this.context_?.state === 'running';
    }

    async initialize(options: AudioBackendInitOptions = {}): Promise<void> {
        this.contextGeneration_++;
        this.deviceIntentRevision_++;
        this.explicitlySuspended_ = false;
        this.context_ = new AudioContext();
        this.mixer_ = new AudioMixer(this.context_, options.mixerConfig);
        this.pool_ = new AudioPool(this.context_, options.initialPoolSize);

        // Tap the master bus for spectrum analysis (a side branch — the analyser
        // is a sink, so it never alters the audio reaching the destination).
        this.analyser_ = this.context_.createAnalyser();
        this.analyser_.fftSize = 128;
        this.analyser_.smoothingTimeConstant = 0.7;
        this.mixer_.master.node.connect(this.analyser_);

        if (this.context_.state === 'suspended') {
            const resume = () => {
                if (this.explicitlySuspended_) return;
                this.resume();
                document.removeEventListener('touchstart', resume);
                document.removeEventListener('mousedown', resume);
                document.removeEventListener('keydown', resume);
                this.resumeHandler_ = null;
            };
            document.addEventListener('touchstart', resume);
            document.addEventListener('mousedown', resume);
            document.addEventListener('keydown', resume);
            this.resumeHandler_ = resume;
        }
    }

    async ensureResumed(): Promise<void> {
        if (!this.explicitlySuspended_ && this.context_?.state === 'suspended') {
            await this.requestDeviceIntent_(false);
        }
    }

    private requestDeviceIntent_(suspended: boolean): Promise<void> {
        if (this.explicitlySuspended_ !== suspended) {
            this.explicitlySuspended_ = suspended;
            this.deviceIntentRevision_++;
        }
        const revision = this.deviceIntentRevision_;
        const context = this.context_;
        if (!context || context.state === 'closed') return Promise.resolve();
        return this.applyDeviceIntent_(context, suspended, revision, this.contextGeneration_);
    }

    private async applyDeviceIntent_(context: AudioContext, suspended: boolean, revision: number, generation: number): Promise<void> {
        // Invoke synchronously to preserve the original user-gesture stack.
        await (suspended ? context.suspend() : context.resume());
        if (context !== this.context_ || generation !== this.contextGeneration_ || context.state === 'closed') return;
        // Browser transitions can settle out of order. Reapply the latest intent
        // only when a newer request superseded this operation; blocked autoplay
        // or an OS interruption must not produce an unbounded retry loop.
        if (revision !== this.deviceIntentRevision_
            && context.state !== (this.explicitlySuspended_ ? 'suspended' : 'running')) {
            await this.applyDeviceIntent_(context, this.explicitlySuspended_, this.deviceIntentRevision_, generation);
        }
    }

    private fireDeviceIntent_(suspended: boolean): void {
        const context = this.context_;
        const generation = this.contextGeneration_;
        void this.requestDeviceIntent_(suspended).catch(error => {
            if (context === this.context_ && generation === this.contextGeneration_) {
                log.warn('audio', 'Audio device transition failed', error);
            }
        });
    }

    async loadBuffer(url: string, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        if (!this.context_) {
            throw new Error('AudioContext not initialized');
        }

        const cached = this.cachedBuffer_(url);
        if (cached) return cached;

        const inFlight = this.loadingUrls_.get(url);
        if (inFlight) return inFlight;

        const promise = this.loadSource_(url, () => getPlatform().readFile(url), options);
        this.loadingUrls_.set(url, promise);
        try {
            return await promise;
        } finally {
            if (this.loadingUrls_.get(url) === promise) this.loadingUrls_.delete(url);
        }
    }

    async loadBufferFromData(url: string, data: ArrayBuffer, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        return this.loadSource_(url, async () => data, options);
    }

    private cachedBuffer_(url: string): AudioBufferHandle | null {
        const id = this.sources_.get(url)?.bufferId;
        if (id === undefined) return null;
        const record = this.buffers_.get(id);
        return record ? this.handleOf_(id, record) : null;
    }

    private handleOf_(id: number, record: BufferRecord): AudioBufferHandle {
        if (record.stream) {
            const duration = record.stream.duration;
            return { id, duration, bytes: 0, streamed: true, savedBytes: decodedPcmBytes(duration) };
        }
        // As long as the clip is, not as long as the decoder made it.
        return { id, duration: record.span ? record.span.end - record.span.lead : record.buffer!.duration, bytes: decodedBytes(record.buffer!) };
    }

    private async loadSource_(url: string, read: () => Promise<ArrayBuffer>, options?: AudioLoadOptions): Promise<AudioBufferHandle> {
        const context = this.context_;
        if (!context) {
            throw new Error('AudioContext not initialized');
        }
        const generation = this.contextGeneration_;
        const cached = this.cachedBuffer_(url);
        if (cached) return cached;
        let source = this.sources_.get(url);
        if (!source) {
            source = { pending: 0 };
            this.sources_.set(url, source);
        }
        source.pending++;
        try {
            const data = await read();
            this.assertLoadContext_(context, generation);
            return await this.decodeBuffer_(url, data, source, context, generation, options);
        } finally {
            source.pending--;
            if (this.sources_.get(url) === source && source.pending === 0 && source.bufferId === undefined) {
                this.sources_.delete(url);
            }
        }
    }

    private assertLoadContext_(context: AudioContext, generation: number): void {
        if (this.context_ !== context || this.contextGeneration_ !== generation) {
            throw new Error('AudioContext changed while loading audio');
        }
    }

    private async decodeBuffer_(
        url: string, data: ArrayBuffer, source: SourceRecord,
        context: AudioContext, generation: number, options?: AudioLoadOptions,
    ): Promise<AudioBufferHandle> {
        if (this.sources_.get(url) === source) {
            const cached = this.cachedBuffer_(url);
            if (cached) return cached;
        }
        if (shouldStream(options?.loadType, data)) {
            return this.streamBuffer_(url, data, source, context, generation, options);
        }

        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await context.decodeAudioData(data);
        } catch (err) {
            this.assertLoadContext_(context, generation);
            throw new Error(`Failed to decode audio ${url}: ${(err as Error).message}`);
        }
        this.assertLoadContext_(context, generation);

        const id = ++this.nextBufferId_;
        const span = clipSpan(options?.trim, audioBuffer.duration);
        this.buffers_.set(id, { buffer: audioBuffer, url, ...(span ? { span } : {}) });
        if (this.sources_.get(url) === source) source.bufferId = id;

        return this.handleOf_(id, this.buffers_.get(id)!);
    }

    /**
     * Keep a clip as its compressed bytes behind an object URL, and learn its length from the element
     * (the header estimate when the browser will not say). Nothing is decoded: this is the memory the
     * clip does not take.
     */
    private async streamBuffer_(
        url: string, data: ArrayBuffer, source: SourceRecord, context: AudioContext, generation: number, options?: AudioLoadOptions,
    ): Promise<AudioBufferHandle> {
        const objectUrl = URL.createObjectURL(new Blob([data], { type: mimeOf(url) }));
        const duration = await probeDuration(objectUrl, estimateAudioSeconds(data));
        if (this.context_ !== context || this.contextGeneration_ !== generation) {
            URL.revokeObjectURL(objectUrl);
            throw new Error('AudioContext changed while loading audio');
        }
        const id = ++this.nextBufferId_;
        const span = clipSpan(options?.trim, duration);
        this.buffers_.set(id, { buffer: null, url, stream: { objectUrl, duration: span ? span.end - span.lead : duration, ...(span?.lead ? { lead: span.lead } : {}) } });
        if (this.sources_.get(url) === source) source.bufferId = id;
        return this.handleOf_(id, this.buffers_.get(id)!);
    }

    /** The moment each token's voices begin at, for as long as the token is held. */
    private readonly together_ = new WeakMap<object, number>();

    private releaseStream_(handle: WebStreamHandle): void {
        for (const [id, voice] of this.streams_) if (voice === handle) this.streams_.delete(id);
        this.heldStreams_ = this.heldStreams_.filter((h) => h !== handle);
        const retired = this.retiredStreams_.get(handle);
        if (retired !== undefined) {
            this.retiredStreams_.delete(handle);
            URL.revokeObjectURL(retired);
        }
    }

    private playStream_(bufferId: number, stream: { objectUrl: string; duration: number; lead?: number }, config: PlayConfig): AudioHandle {
        const context = this.context_!;
        const pool = this.pool_!;
        const mixer = this.mixer_!;
        // One voice per streamed clip: a second play ends the first.
        this.streams_.get(bufferId)?.stop();
        const element = new Audio();
        element.preload = 'auto';
        element.src = stream.objectUrl;
        element.loop = config.loop ?? false;
        element.playbackRate = config.playbackRate ?? 1;
        const poolNode = pool.acquire();
        let node: MediaElementAudioSourceNode;
        try {
            node = context.createMediaElementSource(element);
            node.connect(poolNode.gain);
            poolNode.gain.gain.value = config.volume ?? 1.0;
            poolNode.panner.pan.value = config.pan ?? 0;
            const bus = mixer.getBus(config.bus ?? 'sfx') ?? mixer.sfx;
            poolNode.panner.connect(bus.input);
        } catch (error) {
            pool.release(poolNode);
            throw error;
        }
        const handle = new WebStreamHandle(
            ++this.nextHandleId_, element, node, poolNode, pool, stream.duration,
            (h) => this.releaseStream_(h), () => this.ensureResumed(),
            // Past the silence encoding put before it, each time round as well as the first.
            config.loop && ((config.loopStart && config.loopStart < stream.duration) || stream.lead) ? (stream.lead ?? 0) + (config.loopStart ?? 0) : 0,
        );
        this.streams_.set(bufferId, handle);
        handle.begin((stream.lead ?? 0) + (config.startOffset ?? 0));
        return handle;
    }

    invalidateSource(url: string): void {
        this.sources_.delete(url);
        this.loadingUrls_.delete(url);
    }

    unloadBuffer(handle: AudioBufferHandle): void {
        const record = this.buffers_.get(handle.id);
        if (!record) return;
        this.buffers_.delete(handle.id);
        if (record.stream) {
            const sounding = this.streams_.get(handle.id);
            if (sounding) this.retiredStreams_.set(sounding, record.stream.objectUrl);
            else URL.revokeObjectURL(record.stream.objectUrl);
        }
        const source = this.sources_.get(record.url);
        if (source?.bufferId === handle.id) {
            delete source.bufferId;
            if (source.pending === 0) this.sources_.delete(record.url);
        }
    }

    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        if (!this.context_ || !this.pool_ || !this.mixer_) {
            throw new Error('Audio system not initialized');
        }

        const record = this.buffers_.get(buffer.id);
        if (record?.stream) return this.playStream_(buffer.id, record.stream, config);
        const audioBuffer = record?.buffer;
        if (!audioBuffer) {
            throw new Error(`Buffer ${buffer.id} not found`);
        }

        // Everything below is a place in the decoded buffer: the clip begins at `lead` and is over at `end`.
        const [lead, end] = [record!.span?.lead ?? 0, record!.span?.end ?? audioBuffer.duration];
        const startOffset = lead + (config.startOffset ?? 0);
        const loopStart = lead + (config.loop && config.loopStart && config.loopStart > 0 && lead + config.loopStart < end ? config.loopStart : 0);
        // Round a part of the buffer and not the whole of it: from a loop start, or within a clip that has silence round it.
        const region = !!config.loop && (loopStart > 0 || end < audioBuffer.duration);
        // Voices of one token are told the same moment a little way off, so each begins on the same sample however
        // long it takes to set the next one up; a voice on its own begins as soon as it can.
        let when = 0;
        if (config.together) {
            when = this.together_.get(config.together) ?? this.context_.currentTime + 0.03;
            this.together_.set(config.together, when);
        }
        const poolNode = this.pool_.acquire();
        let source: AudioBufferSourceNode;
        try {
            source = this.context_.createBufferSource();
            poolNode.source = source;
            source.buffer = audioBuffer;
            source.loop = config.loop ?? false;
            // Round from here, not from the top: the node does it between two samples.
            if (region) { source.loopStart = loopStart; source.loopEnd = end; }
            source.playbackRate.value = config.playbackRate ?? 1.0;
            source.connect(poolNode.gain);

            poolNode.gain.gain.value = config.volume ?? 1.0;
            poolNode.panner.pan.value = config.pan ?? 0;

            const busName = config.bus ?? 'sfx';
            const bus = this.mixer_.getBus(busName) ?? this.mixer_.sfx;
            poolNode.panner.connect(bus.input);
            // A clip with silence after it is stopped where it ends, so its end is told on time.
            if (record!.span && !config.loop) source.start(when, startOffset, Math.max(0, end - startOffset));
            else source.start(when, startOffset);
        } catch (error) {
            this.pool_.release(poolNode);
            throw error;
        }

        const handleId = ++this.nextHandleId_;
        const handle = new WebAudioHandle(
            handleId, source, audioBuffer, poolNode, this.pool_, this.context_, startOffset, loopStart, lead, end,
            when || this.context_.currentTime,
        );

        return handle;
    }

    getFrequencyData(out: Uint8Array): boolean {
        if (!this.analyser_) return false;
        // lib.dom narrowed getByteFrequencyData to Uint8Array<ArrayBuffer> in TS 5.7;
        // out is a plain Uint8Array (ArrayBufferLike) — safe to cast.
        this.analyser_.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
        return true;
    }

    suspend(): void {
        // A media element runs on its own clock, so a suspended context would leave it playing out of earshot and out of step.
        for (const voice of this.streams_.values()) if (voice.holdForSuspend()) this.heldStreams_.push(voice);
        this.fireDeviceIntent_(true);
    }

    resume(): void {
        this.fireDeviceIntent_(false);
        const held = this.heldStreams_;
        this.heldStreams_ = [];
        for (const voice of held) voice.continueAfterSuspend();
    }

    dispose(): void {
        this.contextGeneration_++;
        this.deviceIntentRevision_++;
        this.explicitlySuspended_ = false;
        if (this.resumeHandler_) {
            document.removeEventListener('touchstart', this.resumeHandler_);
            document.removeEventListener('mousedown', this.resumeHandler_);
            document.removeEventListener('keydown', this.resumeHandler_);
            this.resumeHandler_ = null;
        }
        for (const voice of [...this.streams_.values()]) voice.stop();
        for (const record of this.buffers_.values()) if (record.stream) URL.revokeObjectURL(record.stream.objectUrl);
        for (const objectUrl of this.retiredStreams_.values()) URL.revokeObjectURL(objectUrl);
        this.retiredStreams_.clear();
        this.streams_.clear();
        this.heldStreams_ = [];
        this.analyser_ = null;
        this.pool_ = null;
        this.mixer_ = null;
        this.buffers_.clear();
        this.sources_.clear();
        this.loadingUrls_.clear();
        this.context_?.close();
        this.context_ = null;
    }

}
