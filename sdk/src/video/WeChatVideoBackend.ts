// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// WeChat video backend: wx.createVideoDecoder → getFrameData RGBA → the same
// pathless texture as web, with wx.createMediaAudioPlayer for audio.
/// <reference types="minigame-api-typings" />
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { createTextureFromPixels, updateTextureSubregion } from '../runtimeAssets';
import { requireResourceManager } from '../resourceManager';
import { log } from '../logger';

let nextId_ = 1;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

class WeChatVideoStreamHandle implements VideoStreamHandle {
    readonly id = nextId_++;
    onReady?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;

    private readonly decoder_: WechatMinigame.VideoDecoder;
    private audioPlayer_: WechatMinigame.MediaAudioPlayer | null = null;
    private texture_ = 0;
    private width_ = 0;
    private height_ = 0;
    private ready_ = false;
    private disposed_ = false;
    private playing_: boolean;
    private loop_: boolean;
    private lastPts_ = -1;
    private flip_: Uint8Array | null = null;
    private rateWarned_ = false;

    constructor(url: string, options: VideoStreamOptions) {
        this.playing_ = options.autoplay ?? true;
        this.loop_ = options.loop ?? false;
        const decoder = wx.createVideoDecoder();
        this.decoder_ = decoder;
        decoder.start({ source: url, mode: 0 }).catch((err) => this.onError?.(err)); // mode 0 = decode by PTS
        decoder.on('ended', () => {
            if (this.loop_) {
                this.lastPts_ = -1;
                decoder.seek(0).catch(() => { /* not seekable */ });
            } else {
                this.onEnded?.();
            }
        });
        if (!(options.muted ?? false)) this.attachAudio_(options.volume ?? 1);
    }

    private attachAudio_(volume: number): void {
        // Needs base lib ≥2.14.0; degrade to silent on older runtimes.
        if (typeof wx.createMediaAudioPlayer !== 'function') return;
        try {
            const player = wx.createMediaAudioPlayer();
            this.audioPlayer_ = player;
            player.volume = clamp01(volume);
            player.addAudioSource(this.decoder_)
                .then(() => player.start())
                .catch((err) => log.warn('video', 'WeChat media audio source failed', err));
        } catch (err) {
            log.warn('video', 'WeChat media audio unavailable', err);
        }
    }

    // === texture pump =======================================================

    pump(module: ESEngineModule): void {
        if (this.disposed_ || !this.playing_) return;
        // getFrameData is typed non-null but returns null on-device until a frame
        // has decoded — guard for it rather than trusting the vendor type.
        const frame: WechatMinigame.FrameDataOptions | null = this.decoder_.getFrameData();
        if (!frame || !frame.data || frame.data.byteLength === 0 || frame.width <= 0) return;
        if (frame.pkPts === this.lastPts_) return; // no new frame
        this.lastPts_ = frame.pkPts;

        const w = frame.width | 0, h = frame.height | 0;
        const pixels = this.flipRows_(new Uint8Array(frame.data), w, h);

        if (!this.texture_) {
            this.width_ = w;
            this.height_ = h;
            this.texture_ = createTextureFromPixels(
                module,
                { width: w, height: h, pixels },
                /* flipY */ false,
                { filterMode: 'linear', wrapMode: 'clamp' },
            );
            this.ready_ = true;
            this.onReady?.();
        } else if (w === this.width_ && h === this.height_) {
            updateTextureSubregion(module, this.texture_, 0, 0, w, h, pixels);
        }
    }

    // Flip rows to bottom-first (reused buffer): updateTextureSubregion is
    // flipY-off and a Sprite samples like an image upload. [device-verify: drop
    // if WeChat frames are already bottom-first.]
    private flipRows_(src: Uint8Array, w: number, h: number): Uint8Array {
        const stride = w * 4;
        const need = stride * h;
        if (!this.flip_ || this.flip_.length !== need) this.flip_ = new Uint8Array(need);
        const dst = this.flip_;
        for (let y = 0; y < h; y++) {
            dst.set(src.subarray(y * stride, y * stride + stride), (h - 1 - y) * stride);
        }
        return dst;
    }

    // === transport ==========================================================

    get textureHandle(): number { return this.texture_; }
    get width(): number { return this.width_; }
    get height(): number { return this.height_; }
    get bytes(): number { return this.width_ * this.height_ * 4; }
    get isReady(): boolean { return this.ready_; }
    get isPlaying(): boolean { return this.playing_; }
    get currentTime(): number { return 0; } // wx decoder exposes no playhead
    get duration(): number { return 0; }

    play(): void { this.playing_ = true; }
    pause(): void { this.playing_ = false; }
    seek(timeSeconds: number): void {
        this.lastPts_ = -1;
        this.decoder_.seek(timeSeconds).catch(() => { /* not seekable */ });
    }
    setVolume(volume: number): void { if (this.audioPlayer_) this.audioPlayer_.volume = clamp01(volume); }
    setMuted(muted: boolean): void { if (this.audioPlayer_) this.audioPlayer_.volume = muted ? 0 : 1; }
    setLoop(loop: boolean): void { this.loop_ = loop; }
    setPlaybackRate(_rate: number): void {
        if (!this.rateWarned_) {
            log.warn('video', 'WeChat video decoder has no playback-rate control');
            this.rateWarned_ = true;
        }
    }

    stop(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.audioPlayer_?.stop().catch(() => { /* ignore */ });
        this.audioPlayer_?.destroy().catch(() => { /* ignore */ });
        this.decoder_.stop().catch(() => { /* ignore */ });
        this.decoder_.remove().catch(() => { /* ignore */ });
        if (this.texture_) {
            requireResourceManager().releaseTexture(this.texture_);
            this.texture_ = 0;
        }
        this.flip_ = null;
    }
}

export class WeChatVideoBackend implements PlatformVideoBackend {
    readonly name = 'WeChat';

    createStream(url: string, options: VideoStreamOptions): VideoStreamHandle {
        return new WeChatVideoStreamHandle(url, options);
    }

    dispose(): void { /* handles own their decoders; released on stop() */ }
}
