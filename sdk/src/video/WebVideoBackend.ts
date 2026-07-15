// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Browser / Electron video backend: an HTMLVideoElement streams and decodes,
// each frame is drawn to a canvas and uploaded into a pathless engine texture.
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { createTextureFromPixels, updateTextureSubregion } from '../runtimeAssets';
import { requireResourceManager } from '../resourceManager';
import { log } from '../logger';

let nextId_ = 1;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

class WebVideoStreamHandle implements VideoStreamHandle {
    readonly id = nextId_++;
    onReady?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;

    private readonly video_: HTMLVideoElement;
    private canvas_: HTMLCanvasElement | null = null;
    private ctx_: CanvasRenderingContext2D | null = null;
    private texture_ = 0;
    private width_ = 0;
    private height_ = 0;
    private ready_ = false;
    private disposed_ = false;
    private newFrame_ = true;
    private lastUploadTime_ = -1;
    private rvfcId_ = 0;
    private readonly rvfcSupported_: boolean;
    private wantsPlay_: boolean;

    constructor(url: string, options: VideoStreamOptions) {
        const video = document.createElement('video');
        this.rvfcSupported_ = typeof video.requestVideoFrameCallback === 'function';
        video.crossOrigin = 'anonymous'; // else the canvas readback taints
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.loop = options.loop ?? false;
        video.muted = options.muted ?? false;
        video.volume = clamp01(options.volume ?? 1);
        video.playbackRate = options.playbackRate ?? 1;
        video.preload = 'auto';
        this.wantsPlay_ = options.autoplay ?? true;

        video.addEventListener('loadedmetadata', this.onLoadedMetadata_);
        video.addEventListener('ended', this.onEndedEvent_);
        video.addEventListener('error', this.onErrorEvent_);
        video.src = url;
        video.load();
        this.video_ = video;

        if (this.wantsPlay_) this.tryPlay_();
    }

    // === lifecycle ==========================================================

    private onLoadedMetadata_ = (): void => {
        this.width_ = this.video_.videoWidth | 0;
        this.height_ = this.video_.videoHeight | 0;
        this.scheduleFrame_();
    };

    private onEndedEvent_ = (): void => {
        if (!this.video_.loop) this.onEnded?.();
    };

    private onErrorEvent_ = (): void => {
        const err = this.video_.error;
        log.warn('video', `decode error (code ${err?.code ?? '?'}): ${err?.message ?? 'unknown'}`);
        this.onError?.(err ?? new Error('video decode error'));
    };

    private tryPlay_(): void {
        const p = this.video_.play() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') {
            p.catch((err) => log.warn('video', 'autoplay blocked (mute the video or start on input)', err));
        }
    }

    private scheduleFrame_(): void {
        if (this.disposed_ || !this.rvfcSupported_) return;
        this.rvfcId_ = this.video_.requestVideoFrameCallback(() => {
            this.newFrame_ = true;
            this.scheduleFrame_();
        });
    }

    private ensureCanvas_(): void {
        if (this.canvas_ || this.width_ <= 0 || this.height_ <= 0) return;
        const canvas = document.createElement('canvas');
        canvas.width = this.width_;
        canvas.height = this.height_;
        this.canvas_ = canvas;
        this.ctx_ = canvas.getContext('2d', { willReadFrequently: true });
    }

    // === texture pump =======================================================

    pump(module: ESEngineModule): void {
        if (this.disposed_ || this.width_ <= 0 || this.height_ <= 0) return;
        if (this.video_.readyState < 2) return; // HAVE_CURRENT_DATA — a frame to sample

        // Upload on a new-frame signal OR a moved playhead — the latter also
        // covers hosts where rVFC is starved (hidden/offscreen window).
        const advanced = this.video_.currentTime !== this.lastUploadTime_;
        if (this.ready_ && !this.newFrame_ && !advanced) return;

        this.ensureCanvas_();
        const ctx = this.ctx_;
        if (!ctx) return;

        // Draw flipped so getImageData yields bottom-first rows — the orientation
        // updateTextureSubregion (flipY-off) needs for a Sprite to sample upright.
        ctx.save();
        ctx.translate(0, this.height_);
        ctx.scale(1, -1);
        ctx.drawImage(this.video_ as CanvasImageSource, 0, 0, this.width_, this.height_);
        ctx.restore();

        let frame: ImageData;
        try {
            frame = ctx.getImageData(0, 0, this.width_, this.height_);
        } catch (err) {
            // Tainted canvas (cross-origin without CORS) — give up on readback.
            this.onError?.(err);
            this.disposed_ = true;
            return;
        }
        const pixels = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

        if (!this.texture_) {
            this.texture_ = createTextureFromPixels(
                module,
                { width: this.width_, height: this.height_, pixels },
                /* flipY */ false,
                { filterMode: 'linear', wrapMode: 'clamp' },
            );
        } else {
            updateTextureSubregion(module, this.texture_, 0, 0, this.width_, this.height_, pixels);
        }

        this.newFrame_ = false;
        this.lastUploadTime_ = this.video_.currentTime;
        if (!this.ready_) {
            this.ready_ = true;
            this.onReady?.();
        }
    }

    // === transport ==========================================================

    get textureHandle(): number { return this.texture_; }
    get width(): number { return this.width_; }
    get height(): number { return this.height_; }
    get bytes(): number { return this.width_ * this.height_ * 4; }
    get isReady(): boolean { return this.ready_; }
    get isPlaying(): boolean { return !this.video_.paused && !this.video_.ended; }
    get currentTime(): number { return this.video_.currentTime; }
    get duration(): number { return Number.isFinite(this.video_.duration) ? this.video_.duration : 0; }

    play(): void { this.wantsPlay_ = true; this.tryPlay_(); }
    pause(): void { this.wantsPlay_ = false; this.video_.pause(); }
    seek(timeSeconds: number): void {
        try { this.video_.currentTime = timeSeconds; this.newFrame_ = true; } catch { /* not seekable yet */ }
    }
    setVolume(volume: number): void { this.video_.volume = clamp01(volume); }
    setMuted(muted: boolean): void { this.video_.muted = muted; }
    setLoop(loop: boolean): void { this.video_.loop = loop; }
    setPlaybackRate(rate: number): void { this.video_.playbackRate = rate > 0 ? rate : 0; }

    stop(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        if (this.rvfcId_ && this.rvfcSupported_) {
            this.video_.cancelVideoFrameCallback(this.rvfcId_);
        }
        this.video_.removeEventListener('loadedmetadata', this.onLoadedMetadata_);
        this.video_.removeEventListener('ended', this.onEndedEvent_);
        this.video_.removeEventListener('error', this.onErrorEvent_);
        try { this.video_.pause(); } catch { /* ignore */ }
        this.video_.removeAttribute('src');
        try { this.video_.load(); } catch { /* ignore */ }
        if (this.texture_) {
            requireResourceManager().releaseTexture(this.texture_);
            this.texture_ = 0;
        }
        this.canvas_ = null;
        this.ctx_ = null;
    }
}

export class WebVideoBackend implements PlatformVideoBackend {
    readonly name = 'web';

    createStream(url: string, options: VideoStreamOptions): VideoStreamHandle {
        return new WebVideoStreamHandle(url, options);
    }

    dispose(): void { /* handles own their own resources; released on stop() */ }
}
