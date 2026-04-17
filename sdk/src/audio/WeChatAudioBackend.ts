import type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions } from './PlatformAudioBackend';
import type { AudioMixer } from './AudioMixer';
import { log } from '../logger';

interface WxInnerAudioContext {
    src: string;
    startTime: number;
    autoplay: boolean;
    loop: boolean;
    obeyMuteSwitch: boolean;
    volume: number;
    playbackRate: number;
    duration: number;
    currentTime: number;
    paused: boolean;
    play(): void;
    pause(): void;
    stop(): void;
    seek(position: number): void;
    destroy(): void;
    onEnded(callback: () => void): void;
    offEnded(callback: () => void): void;
    onError(callback: (res: { errMsg: string }) => void): void;
}

class WeChatAudioHandle implements AudioHandle {
    readonly id: number;
    onEnd?: () => void;

    private ctx_: WxInnerAudioContext;
    private contexts_: Map<number, WxInnerAudioContext>;

    constructor(id: number, ctx: WxInnerAudioContext, contexts: Map<number, WxInnerAudioContext>) {
        this.id = id;
        this.ctx_ = ctx;
        this.contexts_ = contexts;
    }

    stop(): void {
        this.ctx_.stop();
        this.ctx_.destroy();
        this.contexts_.delete(this.id);
    }

    pause(): void {
        this.ctx_.pause();
    }

    resume(): void {
        this.ctx_.play();
    }

    setVolume(volume: number): void {
        this.ctx_.volume = volume;
    }

    private panWarned_ = false;

    setPan(_pan: number): void {
        if (!this.panWarned_) {
            log.warn('audio', 'WeChat InnerAudioContext does not support stereo panning');
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

export class WeChatAudioBackend implements PlatformAudioBackend {
    readonly name = 'WeChat';

    private contexts_ = new Map<number, WxInnerAudioContext>();
    private urlCache_ = new Map<number, string>();
    private nextId_ = 0;

    get mixer(): AudioMixer | null {
        return null;
    }

    get isReady(): boolean {
        return true;
    }

    async initialize(_options?: AudioBackendInitOptions): Promise<void> {
        // wx.createInnerAudioContext does not require global initialization
    }

    async ensureResumed(): Promise<void> {
        // WeChat does not require user interaction to resume
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

        const ctx: WxInnerAudioContext = (wx as any).createInnerAudioContext();
        ctx.loop = config.loop ?? false;
        ctx.volume = config.volume ?? 1.0;
        ctx.playbackRate = config.playbackRate ?? 1.0;
        ctx.startTime = config.startOffset ?? 0;
        ctx.obeyMuteSwitch = false;

        const handleId = ++this.nextId_;
        this.contexts_.set(handleId, ctx);

        const handle = new WeChatAudioHandle(handleId, ctx, this.contexts_);
        ctx.onEnded(() => {
            handle.onEnd?.();
            if (!ctx.loop) {
                ctx.destroy();
                this.contexts_.delete(handleId);
            }
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
