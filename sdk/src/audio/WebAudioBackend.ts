import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions } from './PlatformAudioBackend';
import { AudioMixer } from './AudioMixer';
import { AudioPool, type PooledAudioNode } from './AudioPool';

class WebAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private buffer_: AudioBuffer;
    private source_: AudioBufferSourceNode;
    private poolNode_: PooledAudioNode;
    private pool_: AudioPool;
    private context_: AudioContext;
    private playing_ = true;
    private stopped_ = false;
    private pausedAt_ = 0;
    private startedAt_: number;
    private startOffset_: number;
    private playbackRate_: number;
    private loop_: boolean;

    constructor(
        id: number,
        source: AudioBufferSourceNode,
        buffer: AudioBuffer,
        poolNode: PooledAudioNode,
        pool: AudioPool,
        context: AudioContext,
        startOffset: number,
    ) {
        this.id = id;
        this.source_ = source;
        this.buffer_ = buffer;
        this.poolNode_ = poolNode;
        this.pool_ = pool;
        this.context_ = context;
        this.startOffset_ = startOffset;
        this.startedAt_ = context.currentTime;
        this.playbackRate_ = source.playbackRate.value;
        this.loop_ = source.loop;

        this.bindOnEnded_(source);
    }

    private bindOnEnded_(source: AudioBufferSourceNode): void {
        source.onended = () => {
            if (!this.stopped_ && !this.loop_) {
                this.playing_ = false;
                this.stopped_ = true;
                this.pool_.release(this.poolNode_);
                this.onEnd?.();
            }
        };
    }

    stop(): void {
        if (this.stopped_) return;
        this.stopped_ = true;
        this.playing_ = false;
        this.source_.onended = null;
        this.pool_.release(this.poolNode_);
    }

    pause(): void {
        if (!this.playing_ || this.stopped_) return;
        this.playing_ = false;
        const elapsed = (this.context_.currentTime - this.startedAt_) * this.playbackRate_;
        this.pausedAt_ = this.startOffset_ + elapsed;
        if (this.loop_ && this.buffer_.duration > 0) {
            this.pausedAt_ = this.pausedAt_ % this.buffer_.duration;
        }
        this.source_.onended = null;
        try { this.source_.stop(); } catch (_) { /* already stopped */ }
        this.source_.disconnect();
    }

    resume(): void {
        if (this.playing_ || this.stopped_) return;
        this.playing_ = true;

        const source = this.context_.createBufferSource();
        source.buffer = this.buffer_;
        source.loop = this.loop_;
        source.playbackRate.value = this.playbackRate_;
        source.connect(this.poolNode_.gain);

        this.source_ = source;
        this.poolNode_.source = source;
        this.startOffset_ = this.pausedAt_;
        this.startedAt_ = this.context_.currentTime;

        this.bindOnEnded_(source);
        source.start(0, this.pausedAt_);
    }

    setVolume(volume: number): void {
        this.poolNode_.gain.gain.value = volume;
    }

    setPan(pan: number): void {
        this.poolNode_.panner.pan.value = pan;
    }

    setLoop(loop: boolean): void {
        this.loop_ = loop;
        this.source_.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        this.playbackRate_ = rate;
        if (this.playing_) {
            this.source_.playbackRate.value = rate;
        }
    }

    get isPlaying(): boolean {
        return this.playing_;
    }

    get currentTime(): number {
        if (this.stopped_) return 0;
        if (!this.playing_) return this.pausedAt_;
        const elapsed = (this.context_.currentTime - this.startedAt_) * this.playbackRate_;
        return this.startOffset_ + elapsed;
    }

    get duration(): number {
        return this.buffer_.duration;
    }
}

export class WebAudioBackend implements PlatformAudioBackend {
    readonly name = 'WebAudio';

    private context_: AudioContext | null = null;
    private mixer_: AudioMixer | null = null;
    private pool_: AudioPool | null = null;
    private buffers_ = new Map<number, AudioBuffer>();
    private urlToId_ = new Map<string, number>();
    private loadingUrls_ = new Map<string, Promise<AudioBufferHandle>>();
    private nextBufferId_ = 0;
    private nextHandleId_ = 0;
    private resumeHandler_: (() => void) | null = null;

    get mixer(): AudioMixer | null {
        return this.mixer_;
    }

    async initialize(options: AudioBackendInitOptions = {}): Promise<void> {
        this.context_ = new AudioContext();
        this.mixer_ = new AudioMixer(this.context_, options.mixerConfig);
        this.pool_ = new AudioPool(this.context_, options.initialPoolSize);

        if (this.context_.state === 'suspended') {
            const resume = () => {
                this.context_!.resume();
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
        if (this.context_ && this.context_.state === 'suspended') {
            await this.context_.resume();
        }
    }

    async loadBuffer(url: string): Promise<AudioBufferHandle> {
        if (!this.context_) {
            throw new Error('AudioContext not initialized');
        }

        const existingId = this.urlToId_.get(url);
        if (existingId !== undefined && this.buffers_.has(existingId)) {
            const buf = this.buffers_.get(existingId)!;
            return { id: existingId, duration: buf.duration };
        }

        const inFlight = this.loadingUrls_.get(url);
        if (inFlight) return inFlight;

        const promise = this.doLoadBuffer_(url);
        this.loadingUrls_.set(url, promise);
        try {
            return await promise;
        } finally {
            this.loadingUrls_.delete(url);
        }
    }

    private async doLoadBuffer_(url: string): Promise<AudioBufferHandle> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load audio: ${url} (${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await this.context_!.decodeAudioData(arrayBuffer);
        } catch (err) {
            throw new Error(`Failed to decode audio ${url}: ${(err as Error).message}`);
        }

        const id = ++this.nextBufferId_;
        this.buffers_.set(id, audioBuffer);
        this.urlToId_.set(url, id);

        return { id, duration: audioBuffer.duration };
    }

    unloadBuffer(handle: AudioBufferHandle): void {
        this.buffers_.delete(handle.id);
    }

    play(buffer: AudioBufferHandle, config: PlayConfig): AudioHandle {
        if (!this.context_ || !this.pool_ || !this.mixer_) {
            throw new Error('Audio system not initialized');
        }

        const audioBuffer = this.buffers_.get(buffer.id);
        if (!audioBuffer) {
            throw new Error(`Buffer ${buffer.id} not found`);
        }

        const poolNode = this.pool_.acquire();
        const source = this.context_.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = config.loop ?? false;
        source.playbackRate.value = config.playbackRate ?? 1.0;
        source.connect(poolNode.gain);
        poolNode.source = source;

        poolNode.gain.gain.value = config.volume ?? 1.0;
        poolNode.panner.pan.value = config.pan ?? 0;

        const busName = config.bus ?? 'sfx';
        const bus = this.mixer_.getBus(busName) ?? this.mixer_.sfx;
        poolNode.panner.connect(bus.node);

        const startOffset = config.startOffset ?? 0;
        source.start(0, startOffset);

        const handleId = ++this.nextHandleId_;
        const handle = new WebAudioHandle(
            handleId, source, audioBuffer, poolNode, this.pool_, this.context_, startOffset
        );

        return handle;
    }

    suspend(): void {
        this.context_?.suspend();
    }

    resume(): void {
        this.context_?.resume();
    }

    dispose(): void {
        if (this.resumeHandler_) {
            document.removeEventListener('touchstart', this.resumeHandler_);
            document.removeEventListener('mousedown', this.resumeHandler_);
            document.removeEventListener('keydown', this.resumeHandler_);
            this.resumeHandler_ = null;
        }
        this.pool_ = null;
        this.mixer_ = null;
        this.buffers_.clear();
        this.context_?.close();
        this.context_ = null;
    }

}
