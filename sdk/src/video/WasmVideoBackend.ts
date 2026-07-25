// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WasmVideoBackend.ts
 * @brief   The engine-owned software video backend (videodec side module).
 *
 * @details pl_mpeg decodes MPEG-1 (.esv/.mpg) to RGBA, uploaded through the same
 *          pathless texture pump as every other backend. Runs wherever the
 *          engine's wasm runs — the guaranteed path on platforms without a
 *          reliable native decoder (WeChat, headless) — and owns the clock, so
 *          seek/currentTime/duration/rate all work uniformly.
 *
 *          Audio: the cook demuxes the source's audio track into an `.m4a`
 *          sibling played through the audio pipeline (bus-routed, so
 *          mixer/ducking apply). When a track exists and the stream is audible,
 *          IT is the clock — the video decodes toward the track's playhead —
 *          since audio glitches are far more audible than a video frame
 *          arriving late. Muted streams, silent videos, and a track that ends
 *          before the last frame all drive on the engine wall clock instead.
 */
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoBackendContext, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import type { SideModule } from '../sideModules/host';
import type { AudioAPI } from '../audio/Audio';
import type { AudioHandle } from '../audio/PlatformAudioBackend';
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

/** What the wasm stream needs from its backend (module + optional audio). */
interface WasmStreamDeps {
    acquire(): Promise<SideModule | null>;
    audio(): AudioAPI | null;
}

// Longest catch-up decoded in one pump. MPEG-1 has no frame-skip (P/B frames
// need every predecessor), so a huge dt after a hidden window would stall the
// frame decoding it all; clamping instead slows playback to real decode speed.
const MAX_PUMP_DT = 0.25;
// An audio clock this far BEHIND the video is a loop wrap or backward seek —
// exact-seek the video instead of waiting for the clock to catch up.
const CLOCK_BACK_JUMP = 0.25;
// Bus the audio track routes through (created on demand under master).
const VIDEO_AUDIO_BUS = 'video';

/**
 * Fallback derivation of the cooked `.m4a` audio-track sibling from a resolved
 * video URL, used only when the source didn't resolve one through the manifest
 * (VideoAPI passes `audioTrackUrl` when it did). One function owns the whole
 * convention: strip the WeChat `.esv → .esv.bin` restaging suffix, then a
 * wasm-decodable extension gains `.m4a`. Null = no sibling to probe.
 */
function deriveAudioSiblingUrl(url: string): string | null {
    const base = url.replace(/\.bin$/i, '');
    return /\.(esv|mpg|mpeg)$/i.test(base) ? `${base}.m4a` : null;
}

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
    private disposed_ = false;
    private ended_ = false;
    private playing_: boolean;
    private loop_: boolean;
    private rate_: number;
    private volume_: number;
    private muted_: boolean;
    private lastNow_ = -1;
    private frameDirty_ = false;
    private pendingSeek_ = -1;
    private audioApi_: AudioAPI | null = null;
    private audioUrl_: string | null = null;
    private audio_: AudioHandle | null = null;
    private audioDuration_ = 0;
    private audioGen_ = 0;
    // While an audio-track start is in flight the engine clock must hold, or
    // the video runs ahead and gets yanked back when the track attaches at 0.
    private audioPendingGen_ = 0;

    constructor(url: string, options: VideoStreamOptions, deps: WasmStreamDeps) {
        this.playing_ = options.autoplay ?? true;
        this.loop_ = options.loop ?? false;
        this.rate_ = options.playbackRate ?? 1;
        this.volume_ = options.volume ?? 1;
        this.muted_ = options.muted ?? false;
        void this.start_(url, options, deps);
    }

    private async start_(url: string, options: VideoStreamOptions, deps: WasmStreamDeps): Promise<void> {
        try {
            const [bytes, mod] = await Promise.all([this.loadBytes_(url), deps.acquire()]);
            if (this.disposed_) return;
            if (!mod) throw new Error('the "videodec" side module is unavailable');
            const video = mod as unknown as VideoWasmModule;

            const data = new Uint8Array(bytes);
            const ptr = video._malloc(data.length);
            if (!ptr) throw new Error('videodec out of memory');
            video.HEAPU8.set(data, ptr);
            // The decoder copies the bytes into its own memory, so this buffer is
            // ours to release either way — ownership does not cross the boundary
            // (the two sides share an allocator on the web and not on a device).
            let decoder = 0;
            try {
                decoder = video._es_video_open(ptr, data.length);
            } finally {
                video._free(ptr);
            }
            if (!decoder) {
                throw new Error(
                    `not a decodable MPEG-1 stream (or no free decoder slot): ${url} — ` +
                    'the wasm path plays the cook\'s .esv; raw mp4 / un-transcoded remote URLs cannot decode here',
                );
            }
            let framePtr = 0;
            try {
                framePtr = video._malloc(video._es_video_width(decoder) * video._es_video_height(decoder) * 4);
                if (!framePtr) throw new Error('videodec out of memory');
            } catch (err) {
                video._es_video_close(decoder);
                throw err;
            }
            // stop() may have run while we awaited — it saw null fields, so
            // release what it couldn't.
            if (this.disposed_) {
                video._es_video_close(decoder);
                video._free(framePtr);
                return;
            }

            this.mod_ = video;
            this.decoder_ = decoder;
            this.width_ = video._es_video_width(decoder);
            this.height_ = video._es_video_height(decoder);
            this.duration_ = video._es_video_duration(decoder);
            this.frameBytes_ = this.width_ * this.height_ * 4;
            this.framePtr_ = framePtr;
            video._es_video_set_loop(decoder, this.loop_ ? 1 : 0);
            let startAt = 0;
            if (this.pendingSeek_ >= 0) {
                if (video._es_video_seek(decoder, this.pendingSeek_)) this.frameDirty_ = true;
                startAt = this.pendingSeek_;
                this.pendingSeek_ = -1;
            }

            this.audioApi_ = deps.audio();
            // Manifest-resolved track URL wins (content-addressed staging renames
            // files, so URL surgery can't find it); URL derivation is the fallback
            // for direct/hand-placed sources.
            if (this.audioApi_) this.audioUrl_ = options.audioTrackUrl ?? deriveAudioSiblingUrl(url);
            // Muted streams don't spin up an audio channel just to be a clock —
            // the track attaches on the first unmute instead.
            if (this.playing_ && !this.muted_) void this.startAudio_(startAt);
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

    // === audio track ========================================================

    /** (Re)start the audio-track sibling at `offset` seconds. A missing track
     *  resolves to null once and disables further probes (engine clock drives). */
    private async startAudio_(offset: number): Promise<void> {
        const api = this.audioApi_;
        const url = this.audioUrl_;
        if (!api || !url) return;
        // Restarting a finished non-looping track from its tail would replay
        // audio the design wants silent (the video outlives the track).
        if (this.audioDuration_ > 0 && !this.loop_ && offset >= this.audioDuration_ - 0.05) return;
        const gen = ++this.audioGen_;
        this.audioPendingGen_ = gen;
        try {
            // A silent video has no cooked sibling — check local paths first so
            // the expected miss stays silent (the audio backend logs a load
            // failure as an error). Remote URLs can't be probed cheaply;
            // playTrack's null return covers them.
            if (!/^https?:\/\//.test(url) && !(await getPlatform().fileExists(url))) {
                if (gen === this.audioGen_) this.audioUrl_ = null;
                return;
            }
            if (this.disposed_ || gen !== this.audioGen_) return;
            const handle = await api.playTrack(url, {
                bus: VIDEO_AUDIO_BUS,
                volume: this.muted_ ? 0 : this.volume_,
                loop: this.loop_,
                playbackRate: this.rate_,
                startOffset: offset,
            });
            if (!handle) {
                if (gen === this.audioGen_) this.audioUrl_ = null; // no track — engine clock
                return;
            }
            if (this.disposed_ || gen !== this.audioGen_) {
                handle.stop();
                return;
            }
            this.audioDuration_ = handle.duration || 0;
            // The audio track is the clock now; the video must not free-wrap on
            // its own (the wrap is driven by the track's playhead jumping back).
            this.mod_?._es_video_set_loop(this.decoder_, 0);
            // A non-looping track that ends BEFORE the last video frame hands the
            // clock back to the engine so the tail still plays out.
            handle.onEnd = () => {
                if (this.audio_ === handle && !this.loop_) {
                    this.audioDuration_ = this.audioDuration_ || handle.currentTime;
                    this.audio_ = null;
                    this.lastNow_ = -1;
                }
            };
            if (!this.playing_) handle.pause();
            this.audio_ = handle;
        } finally {
            if (this.audioPendingGen_ === gen) this.audioPendingGen_ = 0;
        }
    }

    private stopAudio_(): void {
        this.audioGen_++;
        this.audioPendingGen_ = 0;
        if (this.audio_) {
            this.audio_.stop();
            this.audio_ = null;
        }
    }

    // === texture pump =======================================================

    pump(module: ESEngineModule | null): void {
        const video = this.mod_;
        if (this.disposed_ || !video) return;

        if (this.playing_ && !this.ended_ && this.audioPendingGen_) {
            // An audio-track start is in flight — hold the clock so the track
            // doesn't attach behind an already-advanced picture.
            this.lastNow_ = -1;
        } else if (this.playing_ && !this.ended_) {
            if (this.audio_) {
                // Audio-track clock: decode toward the track's playhead.
                const target = this.audio_.currentTime;
                const cur = video._es_video_time(this.decoder_);
                const dt = target - cur;
                if (dt > 0.001) {
                    if (video._es_video_advance(this.decoder_, Math.min(dt, MAX_PUMP_DT))) {
                        this.frameDirty_ = true;
                    }
                } else if (dt < -CLOCK_BACK_JUMP) {
                    // The track wrapped (loop) or jumped backwards — follow it.
                    if (video._es_video_seek(this.decoder_, Math.max(target, 0))) {
                        this.frameDirty_ = true;
                    }
                }
            } else {
                const now = getPlatform().now();
                const dt = this.lastNow_ < 0 ? 0 : Math.min((now - this.lastNow_) / 1000, MAX_PUMP_DT);
                this.lastNow_ = now;
                if (dt > 0 && video._es_video_advance(this.decoder_, dt * this.rate_)) {
                    this.frameDirty_ = true;
                }
            }
            if (!this.loop_ && video._es_video_has_ended(this.decoder_)) {
                this.ended_ = true;
                this.playing_ = false;
                this.stopAudio_();
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
    get isReady(): boolean { return this.texture_ !== 0; }
    get isPlaying(): boolean { return this.playing_ && !this.ended_; }
    get currentTime(): number { return this.mod_ ? this.mod_._es_video_time(this.decoder_) : 0; }
    get duration(): number { return this.duration_; }

    play(): void {
        this.playing_ = true;
        this.lastNow_ = -1; // don't count paused wall time as elapsed playback
        if (this.ended_) {
            this.ended_ = false;
            this.seek(0);
            return;
        }
        if (this.audio_) this.audio_.resume();
        else if (this.mod_ && !this.muted_) void this.startAudio_(this.currentTime);
    }

    pause(): void {
        this.playing_ = false;
        this.audio_?.pause();
    }

    seek(timeSeconds: number): void {
        const t = timeSeconds > 0 ? timeSeconds : 0;
        if (!this.mod_) {
            this.pendingSeek_ = t;
            return;
        }
        this.ended_ = false;
        if (this.mod_._es_video_seek(this.decoder_, t)) this.frameDirty_ = true;
        // AudioHandles have no in-place seek — restart the track at the offset.
        this.stopAudio_();
        if (this.playing_ && !this.muted_) void this.startAudio_(t);
    }

    setVolume(volume: number): void {
        this.volume_ = volume;
        this.audio_?.setVolume(this.muted_ ? 0 : volume);
    }

    setMuted(muted: boolean): void {
        this.muted_ = muted;
        if (this.audio_) {
            // Already attached (unmuted at some point): mute = volume 0, keeping
            // the clock authority stable instead of tearing the track down.
            this.audio_.setVolume(muted ? 0 : this.volume_);
        } else if (!muted && this.playing_ && this.mod_) {
            // Muted-from-birth streams attach their track on the first unmute.
            void this.startAudio_(this.currentTime);
        }
    }

    setLoop(loop: boolean): void {
        this.loop_ = loop;
        this.audio_?.setLoop(loop);
        // Without an audio clock the decoder wraps itself.
        if (!this.audio_) this.mod_?._es_video_set_loop(this.decoder_, loop ? 1 : 0);
    }

    setPlaybackRate(rate: number): void {
        this.rate_ = rate > 0 ? rate : 0;
        this.audio_?.setPlaybackRate(this.rate_);
    }

    stop(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.stopAudio_();
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
        return new WasmVideoStreamHandle(url, options, {
            acquire: () => {
                const host = this.ctx_.sideModules();
                if (!host) return Promise.resolve(null);
                return host.acquire('videodec');
            },
            audio: () => this.ctx_.audio?.() ?? null,
        });
    }

    dispose(): void { /* handles own their decoder instances; released on stop() */ }
}
