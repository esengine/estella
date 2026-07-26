// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bridge.ts
 * @brief   The contract a native host (embedded Dawn + JS engine on iOS/Android)
 *          injects so the existing TS SDK + wasm core runs unchanged — NOT a
 *          WebView. Every capability the engine needs from the OS is a method
 *          here; the {@link NativePlatformAdapter} adapts them to PlatformAdapter.
 *
 *          Deliberately NOT on the bridge:
 *          - WASM instantiation — the host JS engine (JavaScriptCore / V8 / Hermes)
 *            provides the `WebAssembly` global; the adapter uses it directly, the
 *            same as the Node host.
 *          - The GPU render surface — it reaches the C++ renderer via a device
 *            handle (WebAppOptions), not through this adapter. Out of scope here.
 *
 * @beta   Pre-1.0: the native host is unshipped; this contract will change as the
 *         shell (boot spike → full host) lands. Public via the `esengine/native` entry.
 */

import type { ImageLoadResult, PlatformGlyph, PlatformGlyphRequest, PlatformRequestOptions } from '../types';

/**
 * A single fetch result from the native http stack. The adapter wraps it into a
 * {@link PlatformResponse}: provide `text` OR `arrayBuffer` (matching the request's
 * responseType); the adapter derives the other on demand.
 */
export interface NativeFetchResult {
    ok: boolean;
    status: number;
    statusText?: string;
    headers?: Record<string, string>;
    arrayBuffer?: ArrayBuffer;
    text?: string;
}

/**
 * The engine's input sink. The shell PUSHES events (native has no DOM event
 * loop): touch coordinates are logical px, origin top-left. Keyboard is optional
 * (most devices are touch-only). The adapter synthesizes the primary pointer from
 * the first active touch, matching the web/mini-game adapters.
 */
export interface NativeInputListener {
    onTouchStart(id: number, x: number, y: number): void;
    onTouchMove(id: number, x: number, y: number): void;
    onTouchEnd(id: number): void;
    onTouchCancel(id: number): void;
    onKeyDown?(code: string): void;
    onKeyUp?(code: string): void;
}

/** What the OS editing surface reports back. `state` carries the surface's whole
 *  value + selection (it is the owner while focused); `composing` is absent on a
 *  host that cannot tell whether an IME preedit is in flight. */
export type NativeTextEditorPush =
    | {
        kind: 'state';
        value: string;
        selectionStart: number;
        selectionEnd: number;
        composing?: boolean;
    }
    | { kind: 'submit' }
    | { kind: 'cancel' };

/**
 * The host's text-editing surface: the OS soft keyboard and its IME. Present only
 * when the host bound it — a host without one omits `NativeBridge.textEditor`
 * and editable fields render but do not type, the way a host without a sound
 * device stays silent.
 *
 * `focus` opens the keyboard on the field's current value; `write` pushes an edit
 * the app made (a programmatic setValue, a tap that moved the caret); everything
 * the user does comes back through `subscribe`.
 */
export interface NativeTextEditorBridge {
    focus(
        value: string, selectionStart: number, selectionEnd: number,
        multiline: boolean, maxLength: number, password: boolean,
    ): void;
    blur(): void;
    write(value: string, selectionStart: number, selectionEnd: number): void;
    /** Returns an unsubscribe. */
    subscribe(handler: (push: NativeTextEditorPush) => void): () => void;
}

/**
 * The host's native audio engine, wrapped as a small object so {@link
 * NativeAudioBackend} stays a thin adapter over it (mirroring the WeChat backend
 * over InnerAudioContext). The engine owns decode + mixing + output natively —
 * nothing per-sample runs in JS, which the no-JIT budget forbids. Present only
 * when the host bound the audio primitives; a host without a sound device omits
 * `NativeBridge.audio` and the audio system stays silent (the Null backend).
 *
 * A `bufferId` names a decoded clip; a `voiceId` names one playing instance of
 * it. Both are non-negative host handles; a failed load or play returns null / -1.
 */
export interface NativeAudioBridge {
    /** `bins` byte magnitudes of what is playing (0..Nyquist), or null when the
     *  host has no analyser / nothing has played. The device's AnalyserNode. */
    spectrum?(bins: number): ArrayBuffer | null;
    /** Decode + register a clip from its (compressed) file bytes. Returns the
     *  buffer handle, its length in seconds and its decoded size in bytes (for the
     *  residency budget), or null on decode failure. */
    load(bytes: ArrayBuffer): { id: number; duration: number; bytes: number } | null;
    unload(bufferId: number): void;
    /** Start a voice on a loaded buffer. Returns its voice id, or -1 if the buffer
     *  is unknown. */
    play(bufferId: number, volume: number, pan: number, loop: boolean, rate: number): number;
    stop(voiceId: number): void;
    pause(voiceId: number): void;
    resume(voiceId: number): void;
    setVolume(voiceId: number, volume: number): void;
    setPan(voiceId: number, pan: number): void;
    setLoop(voiceId: number, loop: boolean): void;
    setRate(voiceId: number, rate: number): void;
    /** `{ playing, currentTime }` for a live voice, or null once it has ended (or
     *  was never known) — the SDK derives isPlaying / currentTime from it. */
    voiceState(voiceId: number): { playing: boolean; currentTime: number } | null;
    /** Pause / resume the whole device — the app going to background and back. */
    suspendAll(): void;
    resumeAll(): void;
    /** Register the sink the host notifies when a voice ends on its own (pushed,
     *  like touch); returns an unsubscribe. */
    onEnded(callback: (voiceId: number) => void): () => void;
}

/**
 * The host functions the native shell injects. Async where the call crosses to
 * the OS (files, network, image decode); sync where the native API is sync
 * (key-value storage). Textures take the pixel-decode path: the host decodes an
 * image to RGBA via {@link NativeBridge.loadImagePixels} (there is no offscreen
 * DOM canvas on native).
 */
export interface NativeBridge {
    /** Read a project-relative (packaged) file, or an absolute http(s) URL. */
    readFile(path: string): Promise<ArrayBuffer>;
    fileExists(path: string): Promise<boolean>;
    fetch(url: string, options?: PlatformRequestOptions): Promise<NativeFetchResult>;

    /** Decode an image to top-first RGBA (the Path-2 / createTextureFromPixels
     *  route the play realm and WeChat also use). */
    loadImagePixels(path: string): Promise<ImageLoadResult>;

    /** Rasterize one glyph — the device's answer to the 2D canvas the browser
     *  path draws text on. Synchronous, because the dynamic glyph atlas fills
     *  cells during the frame that needs them. Optional: a host that has not
     *  bound its font stack omits it and `Text` draws nothing (the atlas treats
     *  a null the same as a canvas miss). See {@link PlatformAdapter.rasterizeGlyph}. */
    rasterizeGlyph?(request: PlatformGlyphRequest): PlatformGlyph | null;

    /** Persistent key-value store (NSUserDefaults / SharedPreferences). Sync,
     *  like localStorage / wx.*StorageSync. `storageKeys()` lets the adapter
     *  implement `clearStorage(prefix)` itself. */
    getStorageItem(key: string): string | null;
    setStorageItem(key: string, value: string): void;
    removeStorageItem(key: string): void;
    storageKeys(): string[];

    /** Persistent content-addressed byte cache (hot-update offline store): the shell
     *  writes verified downloaded assets to disk and reads them back. Optional — a
     *  shell without on-disk caching omits both, and hot-updated assets simply refetch
     *  from the CDN. See {@link PlatformAdapter.readCacheFile}. */
    readCacheFile?(key: string): Promise<ArrayBuffer | null>;
    writeCacheFile?(key: string, bytes: ArrayBuffer): Promise<void>;

    /** Register the engine's input sink; returns an unsubscribe. */
    registerInput(listener: NativeInputListener): () => void;

    devicePixelRatio(): number;
    /** High-resolution clock. Optional — falls back to `Date.now()`. */
    now?(): number;
    /** Host UI language ('zh-CN', 'en-US', …). Optional — falls back to 'en'. */
    language?(): string;

    /** The native audio engine, when the host has a sound device. Absent → silent
     *  Null backend. See {@link NativeAudioBridge}. */
    audio?: NativeAudioBridge;

    /** The OS text-editing surface (soft keyboard + IME), when the host has wired
     *  one. Absent → fields render but cannot be typed into, exactly as a host
     *  with no audio device stays silent. See {@link NativeTextEditorBridge}. */
    textEditor?: NativeTextEditorBridge;

    /** App foreground/background signals (no DOM visibility on native): the shell
     *  pushes them, the adapter surfaces them as `onAppShow`/`onAppHide`, and the
     *  Lifecycle plugin auto-pauses on hide. Each returns an unsubscribe. Optional —
     *  a shell that never backgrounds (or has not wired it) omits them and the app
     *  stays always-visible. */
    onShow?(callback: () => void): () => void;
    onHide?(callback: () => void): () => void;

    /** OS memory-pressure warning (iOS didReceiveMemoryWarning / Android
     *  onLowMemory), pushed by the shell. Residency caches (the audio buffer cache)
     *  subscribe via the adapter's `onMemoryWarning` to drop evictable entries.
     *  Returns an unsubscribe. Optional. */
    onMemoryWarning?(callback: () => void): () => void;
}
