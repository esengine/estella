// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Platform-neutral video contract. A backend turns a source ref into a live
// decode exposing an engine texture handle, refreshed each frame.
import type { ESEngineModule } from '../wasm';

export interface VideoStreamHandle {
    readonly id: number;
    /** Frame texture handle; 0 until isReady. Pathless (never evicted). */
    readonly textureHandle: number;
    readonly width: number;
    readonly height: number;
    readonly bytes?: number;
    readonly isReady: boolean;
    readonly isPlaying: boolean;
    readonly currentTime: number;
    readonly duration: number;

    play(): void;
    pause(): void;
    stop(): void;
    seek(timeSeconds: number): void;
    setVolume(volume: number): void;
    setMuted(muted: boolean): void;
    setLoop(loop: boolean): void;
    setPlaybackRate(rate: number): void;

    /** Upload the current frame if a new one arrived; called once per frame. */
    pump(module: ESEngineModule): void;

    onReady?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;
}

export interface VideoStreamOptions {
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
    volume?: number;
    playbackRate?: number;
    /** Resolved URL of the cook-demuxed audio-track sibling, when the realm's
     *  manifest knows one (content-addressed staging renames files, so it can't
     *  be derived from the video URL). Backends without out-of-band audio
     *  (HTMLVideoElement) ignore it. */
    audioTrackUrl?: string;
}

export interface PlatformVideoBackend {
    readonly name: string;
    createStream(url: string, options: VideoStreamOptions): VideoStreamHandle;
    dispose(): void;
}

/**
 * What the app hands a platform's backend factory. Both accessors are lazy —
 * the side-module host and the audio service may attach to the app after
 * plugins build, so backends resolve them per stream, not at construction.
 */
export interface VideoBackendContext {
    sideModules(): import('../sideModules/host').SideModuleHost | null;
    /** The app's audio service, when the audio plugin is installed. The wasm
     *  backend plays the cook-demuxed `.m4a` audio track through it and slaves
     *  the video clock to the track's playhead. */
    audio?(): import('../audio/Audio').AudioAPI | null;
}
