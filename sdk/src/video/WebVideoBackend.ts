// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Browser / Electron video backend. An HTMLVideoElement streams and decodes;
// on WebGL2 each frame is texImage2D'd straight onto the engine context
// (zero-copy), else a canvas readback feeds updateTextureSubregion (WebGPU).
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { createTextureFromPixels, updateTextureSubregion } from '../runtime/runtimeAssets';
import { requireResourceManager } from '../wasm/resourceManager';
import { findWebGL2Context } from '../asset/loaders/TextureLoader';
import { linearColorSpace } from '../env';
import { log } from '../logger';

let nextId_ = 1;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

class WebVideoStreamHandle implements VideoStreamHandle {
    readonly id = nextId_++;
    onReady?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;

    private readonly video_: HTMLVideoElement;
    // Zero-copy GL path (WebGL2).
    private gl_: WebGL2RenderingContext | null = null;
    private glTexture_: WebGLTexture | null = null;
    private glTexId_ = 0;
    private glPool_: Record<number, WebGLTexture> | null = null;
    private pathChosen_ = false;
    // CPU fallback path (WebGPU / no GL context).
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

    pump(module: ESEngineModule | null): void {
        // This backend IS the browser's <video> element, so it only ever runs on a
        // realm that has the wasm module (it samples through its GL context).
        if (!module) return;
        if (this.disposed_ || this.width_ <= 0 || this.height_ <= 0) return;
        if (this.video_.readyState < 2) return; // HAVE_CURRENT_DATA — a frame to sample

        // Upload on a new-frame signal OR a moved playhead — the latter also
        // covers hosts where rVFC is starved (hidden/offscreen window).
        const advanced = this.video_.currentTime !== this.lastUploadTime_;
        if (this.ready_ && !this.newFrame_ && !advanced) return;

        // First ready frame picks the path: WebGL2 → zero-copy, else CPU readback.
        if (!this.pathChosen_) {
            this.gl_ = findWebGL2Context(module.GL);
            this.pathChosen_ = true;
        }

        try {
            if (this.gl_) this.uploadGL_(module, this.gl_);
            else this.uploadCPU_(module);
        } catch (err) {
            // Tainted source (cross-origin without CORS) or a lost context.
            this.onError?.(err);
            this.disposed_ = true;
            return;
        }

        this.newFrame_ = false;
        this.lastUploadTime_ = this.video_.currentTime;
        if (!this.ready_) {
            this.ready_ = true;
            this.onReady?.();
        }
    }

    // Zero-copy: texImage2D the frame straight onto the engine's GL context, then
    // register it as an external texture. UNPACK_FLIP_Y gives the bottom-first
    // orientation a Sprite samples upright (matching image uploads).
    private uploadGL_(module: ESEngineModule, gl: WebGL2RenderingContext): void {
        if (this.glTexture_) {
            gl.bindTexture(gl.TEXTURE_2D, this.glTexture_);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.video_);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            return;
        }
        const tex = gl.createTexture();
        if (!tex) throw new Error('gl.createTexture failed');
        this.glTexture_ = tex;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        const internal = linearColorSpace() ? gl.SRGB8_ALPHA8 : gl.RGBA;
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, this.video_);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const pool = module.GL.textures;
        const id = module.GL.getNewId(pool);
        pool[id] = tex;
        this.glTexId_ = id;
        this.glPool_ = pool;
        this.texture_ = requireResourceManager().registerExternalTexture(id, this.width_, this.height_);
    }

    private uploadCPU_(module: ESEngineModule): void {
        this.ensureCanvas_();
        const ctx = this.ctx_;
        if (!ctx) return;
        // Flip so getImageData yields bottom-first rows (updateTextureSubregion is flipY-off).
        ctx.save();
        ctx.translate(0, this.height_);
        ctx.scale(1, -1);
        ctx.drawImage(this.video_ as CanvasImageSource, 0, 0, this.width_, this.height_);
        ctx.restore();
        const frame = ctx.getImageData(0, 0, this.width_, this.height_);
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
        // The engine's external texture is non-owning (owns_=false), so delete the
        // JS-side GL texture ourselves after dropping the engine ref.
        if (this.gl_ && this.glTexture_) {
            this.gl_.deleteTexture(this.glTexture_);
            if (this.glPool_ && this.glTexId_) delete this.glPool_[this.glTexId_];
            this.glTexture_ = null;
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
