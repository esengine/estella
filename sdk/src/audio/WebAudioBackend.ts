import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend } from './PlatformAudioBackend';
import { AudioMixer, type AudioMixerConfig } from './AudioMixer';
import { AudioPool, type PooledAudioNode } from './AudioPool';

class WebAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private source_: AudioBufferSourceNode;
    private poolNode_: PooledAudioNode;
    private pool_: AudioPool;
    private context_: AudioContext;
    private playing_ = true;

    constructor(
        id: number,
        source: AudioBufferSourceNode,
        poolNode: PooledAudioNode,
        pool: AudioPool,
        context: AudioContext,
    ) {
        this.id = id;
        this.source_ = source;
        this.poolNode_ = poolNode;
        this.pool_ = pool;
        this.context_ = context;
    }

    stop(): void {
        this.playing_ = false;
        this.pool_.release(this.poolNode_);
    }

    pause(): void {
        if (this.playing_) {
            this.playing_ = false;
            this.source_.playbackRate.value = 0;
        }
    }

    resume(): void {
        if (!this.playing_) {
            this.playing_ = true;
            this.source_.playbackRate.value = 1;
        }
    }

    setVolume(volume: number): void {
        this.poolNode_.gain.gain.value = volume;
    }

    setPan(pan: number): void {
        this.poolNode_.panner.pan.value = pan;
    }

    setLoop(loop: boolean): void {
        this.source_.loop = loop;
    }

    setPlaybackRate(rate: number): void {
        this.source_.playbackRate.value = rate;
    }

    get isPlaying(): boolean {
        return this.playing_;
    }

    get currentTime(): number {
        if (!this.playing_) return 0;
        return this.context_.currentTime - this.poolNode_.startTime;
    }

    get duration(): number {
        return this.source_.buffer?.duration ?? 0;
    }

    markEnded(): void {
        this.playing_ = false;
    }
}

export interface WebAudioBackendOptions {
    initialPoolSize?: number;
    mixerConfig?: AudioMixerConfig;
}

export class WebAudioBackend implements PlatformAudioBackend {
    readonly name = 'WebAudio';

    private context_: AudioContext | null = null;
    private mixer_: AudioMixer | null = null;
    private pool_: AudioPool | null = null;
    private buffers_ = new Map<number, AudioBuffer>();
    private nextBufferId_ = 0;
    private nextHandleId_ = 0;

    get mixer(): AudioMixer | null {
        return this.mixer_;
    }

    async initialize(options: WebAudioBackendOptions = {}): Promise<void> {
        this.context_ = new AudioContext();
        this.mixer_ = new AudioMixer(this.context_, options.mixerConfig);
        this.pool_ = new AudioPool(this.context_, options.initialPoolSize);

        if (this.context_.state === 'suspended') {
            const resume = () => {
                this.context_!.resume();
                document.removeEventListener('touchstart', resume);
                document.removeEventListener('mousedown', resume);
                document.removeEventListener('keydown', resume);
            };
            document.addEventListener('touchstart', resume, { once: true });
            document.addEventListener('mousedown', resume, { once: true });
            document.addEventListener('keydown', resume, { once: true });
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
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.context_.decodeAudioData(arrayBuffer);

        const id = ++this.nextBufferId_;
        this.buffers_.set(id, audioBuffer);

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

        const poolNode = this.pool_.acquire(config.priority ?? 0);
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

        source.start(0, config.startOffset ?? 0);

        const handleId = ++this.nextHandleId_;
        const handle = new WebAudioHandle(
            handleId, source, poolNode, this.pool_, this.context_
        );

        source.onended = () => {
            if (!source.loop) {
                handle.markEnded();
                this.pool_!.release(poolNode);
                handle.onEnd?.();
            }
        };

        return handle;
    }

    suspend(): void {
        this.context_?.suspend();
    }

    resume(): void {
        this.context_?.resume();
    }

    dispose(): void {
        this.pool_ = null;
        this.mixer_ = null;
        this.buffers_.clear();
        this.context_?.close();
        this.context_ = null;
    }

}
