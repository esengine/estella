// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    video/PlatformVideoBackend.ts
 * @brief   Platform-neutral video contract — the visual-side mirror of
 *          {@link ../audio/PlatformAudioBackend}. A backend turns a source
 *          reference into a {@link VideoStreamHandle}: a live decode that
 *          exposes an engine texture handle, updated in place each frame from
 *          the current decoded frame. Web decodes with an HTMLVideoElement,
 *          WeChat with wx.createVideoDecoder, headless with a no-op — the
 *          rest of the engine only ever sees this interface.
 */
import type { ESEngineModule } from '../wasm';

/**
 * A live video decode. Unlike audio (where a decoded buffer and a playing
 * voice are separate handles), a video stream IS both the resource and the
 * transport, because a frame is only meaningful while decoding.
 *
 * `textureHandle` is the engine texture the current frame lands in — a
 * pathless, non-evictable texture the handle owns for its lifetime (created
 * once dimensions are known). It reads `0` until the first frame is ready;
 * callers sample it through the normal Sprite/Mesh2D texture slot.
 */
export interface VideoStreamHandle {
    readonly id: number;
    /** Engine texture handle for the current frame; `0` until `isReady`. */
    readonly textureHandle: number;
    /** Native frame size in pixels; `0` until `isReady`. */
    readonly width: number;
    readonly height: number;
    /**
     * VRAM bytes of the frame texture, for a future residency budget. Backends
     * that own no sampleable texture (native overlay, headless) omit it —
     * 0/undefined means untracked, mirroring `AudioBufferHandle.bytes`.
     */
    readonly bytes?: number;
    readonly isReady: boolean;
    readonly isPlaying: boolean;
    /** Playback position / total length in seconds (0 when unknown). */
    readonly currentTime: number;
    readonly duration: number;

    play(): void;
    pause(): void;
    /** Stop and release the decode + frame texture. Idempotent. */
    stop(): void;
    seek(timeSeconds: number): void;
    setVolume(volume: number): void;
    setMuted(muted: boolean): void;
    setLoop(loop: boolean): void;
    setPlaybackRate(rate: number): void;

    /**
     * Upload the current decoded frame into `textureHandle` when a new one is
     * available (creating the texture on the first ready frame). Called once
     * per frame by the video system with the live wasm module. Cheap to call
     * when no new frame has arrived.
     */
    pump(module: ESEngineModule): void;

    /** Fires once the first frame + dimensions are ready (texture now valid). */
    onReady?: () => void;
    /** Fires when a non-looping stream reaches the end. */
    onEnded?: () => void;
    onError?: (error: unknown) => void;
}

export interface VideoStreamOptions {
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
    /** 0..1, applied to the stream's own audio track. */
    volume?: number;
    playbackRate?: number;
}

/**
 * The platform video factory. One `createStream` per playing video; the
 * returned handle owns its decode and frame texture. Selected through the
 * platform adapter (`getPlatform().createVideoBackend?.()`), never imported
 * directly — that keeps DOM/wx code out of the wrong bundles.
 */
export interface PlatformVideoBackend {
    readonly name: string;
    createStream(url: string, options: VideoStreamOptions): VideoStreamHandle;
    dispose(): void;
}
