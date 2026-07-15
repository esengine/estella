// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The engine-owned software video backend: the `videodec` side module (pl_mpeg)
// decodes MPEG-1 (.esv/.mpg) to RGBA, uploaded through the same pathless texture
// pump as every other backend. Runs wherever the engine's wasm runs — the
// guaranteed path on platforms without a reliable native decoder (WeChat, headless)
// — and owns the clock, so seek/currentTime/duration/rate all work uniformly.
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoBackendContext, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import type { SideModule } from '../sideModules/host';
import { createTextureFromPixels, updateTextureSubregion } from '../runtimeAssets';
import { requireResourceManager } from '../resourceManager';
import { getPlatform } from '../platform/base';
import { log } from '../logger';

let nextId_ = 1;

/** The subset of the emscripten `videodec` module instance we call into.
 *  Mirrors VideoModuleEntry.cpp. */
export interface VideoWasmModule {
    _es_video_open(ptr: number, len: number): number;
    _es_video_close(handle: number): void;
    _es_video_width(handle: number): number;
    _es_video_height(handle: number): number;
    _es_video_duration(handle: number): number;
    _es_video_framerate(handle: number): number;
    _es_video_time(handle: number): number;
    _es_video_set_loop(handle: number, loop: number): void;
    _es_video_has_ended(handle: number): number;
    _es_video_advance(handle: number, dt: number): number;
    _es_video_frame_rgba(handle: number, outPtr: number, outSize: number): number;
    _es_video_seek(handle: number, time: number): number;
    _malloc(size: number): number;
    _free(ptr: number): void;
    /** Live heap view — re-read on every access (ALLOW_MEMORY_GROWTH may detach it). */
    readonly HEAPU8: Uint8Array;
}

// Longest catch-up decoded in one pump. MPEG-1 has no frame-skip (P/B frames
// need every predecessor), so a huge dt after a hidden window would stall the
// frame decoding it all; clamping instead slows playback to real decode speed.
const MAX_PUMP_DT = 0.25;

class WasmVideoStreamHandle implements VideoStreamHandle {
    readonly id = nextId_++;
    onReady?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;

    private mod_: VideoWasmModule | null = null;
    private decoder_ = 0;
    private framePtr_ = 0;
    private frameBytes_ = 0;
    private texture_ = 0;
    private width_ = 0;
    private height_ = 0;
    private duration_ = 0;
    private ready_ = false;
    private disposed_ = false;
    private ended_ = false;
    private playing_: boolean;
    private loop_: boolean;
    private rate_: number;
    private lastNow_ = -1;
    private frameDirty_ = false;
    private pendingSeek_ = -1;

    constructor(url: string, options: VideoStreamOptions, acquire: () => Promise<SideModule | null>) {
        this.playing_ = options.autoplay ?? true;
        this.loop_ = options.loop ?? false;
        this.rate_ = options.playbackRate ?? 1;
        void this.start_(url, acquire);
    }

    private async start_(url: string, acquire: () => Promise<SideModule | null>): Promise<void> {
        try {
            const [bytes, mod] = await Promise.all([this.loadBytes_(url), acquire()]);
            if (this.disposed_) return;
            if (!mod) throw new Error('the "videodec" side module is unavailable');
            const video = mod as unknown as VideoWasmModule;

            const data = new Uint8Array(bytes);
            const ptr = video._malloc(data.length);
            if (!ptr) throw new Error('videodec out of memory');
            video.HEAPU8.set(data, ptr);
            // _es_video_open owns `ptr` from here (freed on close or on failure).
            const decoder = video._es_video_open(ptr, data.length);
            if (!decoder) throw new Error(`not a decodable MPEG-1 stream: ${url}`);

            this.mod_ = video;
            this.decoder_ = decoder;
            this.width_ = video._es_video_width(decoder);
            this.height_ = video._es_video_height(decoder);
            this.duration_ = video._es_video_duration(decoder);
            this.frameBytes_ = this.width_ * this.height_ * 4;
            this.framePtr_ = video._malloc(this.frameBytes_);
            if (!this.framePtr_) throw new Error('videodec out of memory');
            video._es_video_set_loop(decoder, this.loop_ ? 1 : 0);
            if (this.pendingSeek_ >= 0) {
                video._es_video_seek(decoder, this.pendingSeek_);
                this.pendingSeek_ = -1;
                this.frameDirty_ = true;
            }
        } catch (err) {
            if (this.disposed_) return;
            log.error('video', `wasm decode failed for "${url}"`, err);
            this.onError?.(err);
        }
    }

    private loadBytes_(url: string): Promise<ArrayBuffer> {
        const platform = getPlatform();
        if (/^https?:\/\//.test(url)) {
            return platform.fetch(url, { responseType: 'arraybuffer' }).then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status} fetching video ${url}`);
                return res.arrayBuffer();
            });
        }
        return platform.readFile(url);
    }

    // === texture pump =======================================================

    pump(module: ESEngineModule): void {
        const video = this.mod_;
        if (this.disposed_ || !video) return;

        if (this.playing_ && !this.ended_) {
            const now = getPlatform().now();
            const dt = this.lastNow_ < 0 ? 0 : Math.min((now - this.lastNow_) / 1000, MAX_PUMP_DT);
            this.lastNow_ = now;
            if (dt > 0 && video._es_video_advance(this.decoder_, dt * this.rate_)) {
                this.frameDirty_ = true;
            }
            if (!this.loop_ && video._es_video_has_ended(this.decoder_)) {
                this.ended_ = true;
                this.playing_ = false;
                this.onEnded?.();
            }
        }

        if (!this.frameDirty_) return;
        if (!video._es_video_frame_rgba(this.decoder_, this.framePtr_, this.frameBytes_)) return;
        this.frameDirty_ = false;
        // A view into the decoder module's heap; createTextureFromPixels /
        // updateTextureSubregion copy it into the ENGINE module's heap.
        const pixels = video.HEAPU8.subarray(this.framePtr_, this.framePtr_ + this.frameBytes_);
        if (!this.texture_) {
            this.texture_ = createTextureFromPixels(
                module,
                { width: this.width_, height: this.height_, pixels },
                /* flipY */ false,
                { filterMode: 'linear', wrapMode: 'clamp' },
            );
            this.ready_ = true;
            this.onReady?.();
        } else {
            updateTextureSubregion(module, this.texture_, 0, 0, this.width_, this.height_, pixels);
        }
    }

    // === transport ==========================================================

    get textureHandle(): number { return this.texture_; }
    get width(): number { return this.width_; }
    get height(): number { return this.height_; }
    get bytes(): number { return this.frameBytes_; }
    get isReady(): boolean { return this.ready_; }
    get isPlaying(): boolean { return this.playing_ && !this.ended_; }
    get currentTime(): number { return this.mod_ ? this.mod_._es_video_time(this.decoder_) : 0; }
    get duration(): number { return this.duration_; }

    play(): void {
        this.playing_ = true;
        this.lastNow_ = -1; // don't count paused wall time as elapsed playback
        if (this.ended_) {
            this.ended_ = false;
            this.seek(0);
        }
    }

    pause(): void { this.playing_ = false; }

    seek(timeSeconds: number): void {
        const t = timeSeconds > 0 ? timeSeconds : 0;
        if (!this.mod_) {
            this.pendingSeek_ = t;
            return;
        }
        this.ended_ = false;
        if (this.mod_._es_video_seek(this.decoder_, t)) this.frameDirty_ = true;
    }

    // The wasm path decodes video only — the cook demuxes the audio track for
    // the audio pipeline, so per-stream volume/mute live there, not here.
    setVolume(_volume: number): void {}
    setMuted(_muted: boolean): void {}

    setLoop(loop: boolean): void {
        this.loop_ = loop;
        this.mod_?._es_video_set_loop(this.decoder_, loop ? 1 : 0);
    }

    setPlaybackRate(rate: number): void { this.rate_ = rate > 0 ? rate : 0; }

    stop(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        if (this.mod_) {
            this.mod_._es_video_close(this.decoder_);
            if (this.framePtr_) this.mod_._free(this.framePtr_);
            this.mod_ = null;
            this.decoder_ = 0;
            this.framePtr_ = 0;
        }
        if (this.texture_) {
            requireResourceManager().releaseTexture(this.texture_);
            this.texture_ = 0;
        }
    }
}

export class WasmVideoBackend implements PlatformVideoBackend {
    readonly name = 'wasm';

    constructor(private readonly ctx_: VideoBackendContext) {}

    createStream(url: string, options: VideoStreamOptions): VideoStreamHandle {
        return new WasmVideoStreamHandle(url, options, () => {
            const host = this.ctx_.sideModules();
            if (!host) return Promise.resolve(null);
            return host.acquire('videodec');
        });
    }

    dispose(): void { /* handles own their decoder instances; released on stop() */ }
}
