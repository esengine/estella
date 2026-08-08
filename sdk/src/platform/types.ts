// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    types.ts
 * @brief   Platform adapter interface definitions
 */

import type { AchievementProvider } from '../services/achievements';

// =============================================================================
// Response Types
// =============================================================================

export interface PlatformResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    json<T = unknown>(): Promise<T>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

// =============================================================================
// Request Types
// =============================================================================

export interface PlatformRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    responseType?: 'text' | 'arraybuffer' | 'json';
    timeout?: number;
}

// =============================================================================
// WASM Types
// =============================================================================

export interface WasmInstantiateResult {
    instance: WebAssembly.Instance;
    module: WebAssembly.Module;
}

// =============================================================================
// Input Event Types
// =============================================================================

export interface InputEventCallbacks {
    onKeyDown(code: string): void;
    onKeyUp(code: string): void;
    onPointerMove(x: number, y: number): void;
    onPointerDown(button: number, x: number, y: number): void;
    onPointerUp(button: number): void;
    onWheel(deltaX: number, deltaY: number): void;
    onTouchStart?(id: number, x: number, y: number): void;
    onTouchMove?(id: number, x: number, y: number): void;
    onTouchEnd?(id: number): void;
    onTouchCancel?(id: number): void;
}

/**
 * A per-frame snapshot of one gamepad. With `mapping === 'standard'` the button
 * and axis indices follow the W3C "standard gamepad" layout (see GamepadButton /
 * GamepadAxis in input.ts). `buttons[i]` is analog in [0,1] (1 = fully pressed);
 * `axes[i]` is signed in [-1,1]. Gamepads are POLLED (no DOM events), so the
 * platform produces these each frame rather than via InputEventCallbacks.
 */
export interface GamepadSnapshot {
    index: number;
    connected: boolean;
    buttons: number[];
    axes: number[];
    mapping: string;
}

// =============================================================================
// Image Types
// =============================================================================

export interface ImageLoadResult {
    width: number;
    height: number;
    pixels: Uint8Array;
}

// =============================================================================
// Sockets
// =============================================================================

export type PlatformSocketReadyState = 'connecting' | 'open' | 'closing' | 'closed';

export interface PlatformSocketOptions {
    url: string;
    protocols?: string | string[];
}

/** Event payloads for {@link PlatformSocket.on}. */
export interface PlatformSocketEvents {
    open: [];
    message: [data: string | ArrayBuffer];
    close: [code: number, reason: string];
    error: [error: unknown];
}

/**
 * The platform-neutral socket surface (GameSocket / WeChatSocket / a Node ws
 * wrapper all fit): multicast `on(event, fn)` → unsubscribe, queues sends
 * until open, moves string|ArrayBuffer frames.
 */
export interface PlatformSocket {
    readyState: PlatformSocketReadyState;
    on<K extends keyof PlatformSocketEvents>(
        event: K,
        handler: (...args: PlatformSocketEvents[K]) => void,
    ): () => void;
    connect(): void;
    send(data: string | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
}

// =============================================================================
// Neutral Surfaces (DOM-free)
// =============================================================================
//
// The offscreen 2D surface the engine uses for image decode and dynamic glyph
// rasterization. These are a bounded STRUCTURAL SUBSET of the DOM
// Canvas/OffscreenCanvas + HTMLImageElement so a real HTMLCanvasElement /
// OffscreenCanvas / HTMLImageElement is assignable to them (web/mini-game adapters
// need no casts), while a native host — which has no DOM — can implement the
// PlatformAdapter contract honestly (createCanvas/createImage simply throw there;
// native textures come from loadImagePixels, the C++ createTextureFromPixels path).
//
// The main RENDER surface does NOT flow through here — it enters the C++ renderer
// via a GL context handle / preinitialized WebGPU device (see WebAppOptions), not
// createCanvas. So the neutral canvas is 2D-only.

/** RGBA readback from getImageData. The DOM `ImageData` is assignable (its extra
 *  members are ignored structurally). */
export interface PlatformImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
}

/** The subset of `TextMetrics` the glyph rasterizer reads. `TextMetrics` is
 *  assignable. */
export interface PlatformTextMetrics {
    readonly width: number;
    readonly actualBoundingBoxLeft?: number;
    readonly actualBoundingBoxRight?: number;
    readonly actualBoundingBoxAscent?: number;
    readonly actualBoundingBoxDescent?: number;
}

// =============================================================================
// Text editing
// =============================================================================

/**
 * What an editing surface holds while a field has focus. Selection indices are
 * UTF-16 code units, as every platform's text field counts them.
 */
export interface TextEditorState {
    value: string;
    selectionStart: number;
    selectionEnd: number;
    /** The caret sits at `selectionStart` — a shift-left / shift-up selection. */
    backward: boolean;
}

/** What the surface needs to know about the field it is editing. */
export interface TextEditorOptions {
    /** Enter inserts a newline instead of submitting. */
    multiline: boolean;
    /** 0 = unlimited. The plugin enforces it too; a surface that can, should. */
    maxLength: number;
    /** The field renders its own bullets — this is for the keyboard's benefit
     *  (no autocorrect / suggestion strip over a password). */
    password: boolean;
}

export type TextEditorEvent =
    /** The surface's value or selection changed — typing, paste, caret motion. */
    | { kind: 'change' }
    /** An IME composition began or ended; the preedit sits in `read().value`. */
    | { kind: 'composition'; composing: boolean }
    /** Enter on a single-line field, or the keyboard's done/go key. */
    | { kind: 'submit' }
    /** Escape, or the keyboard was dismissed without committing. */
    | { kind: 'cancel' }
    /** The surface gave up focus on its own. */
    | { kind: 'blur' };

/**
 * The OS text-editing surface behind an editable field: a hidden textarea on the
 * web, the soft keyboard and its IME on a device. It OWNS the value and the
 * selection while focused — caret motion, native shift/Ctrl-A selection and the
 * live IME preedit all land there — so the field renders what {@link read}
 * answers and pushes its own edits back through {@link write}.
 *
 * One contract for every platform, so the text-input plugin is the same code
 * everywhere; a host with no surface simply has none, and its fields render but
 * do not type.
 */
export interface PlatformTextEditor {
    /** Take focus with this state. On a device this opens the soft keyboard. */
    focus(state: TextEditorState, options: TextEditorOptions): void;
    /** Give up focus (and close the keyboard). */
    blur(): void;
    /** The surface's live state. */
    read(): TextEditorState;
    /** Push a state the app decided: a programmatic setValue, click-to-caret, a
     *  maxLength truncation. */
    write(state: TextEditorState): void;
    /**
     * Put the caret at this point in CSS px (y down from the top-left of the
     * drawing surface), so an IME pops its candidate window there instead of in
     * a screen corner. Optional — a platform whose IME is a fixed system panel
     * has nowhere to put it.
     */
    setCaretAnchor?(left: number, top: number): void;
    /** Listen for what the surface did. Returns an unsubscribe. */
    subscribe(handler: (event: TextEditorEvent) => void): () => void;
    dispose(): void;
}

/** The `getContext('2d', …)` options actually used. */
export interface PlatformCanvasContextAttributes {
    willReadFrequently?: boolean;
    alpha?: boolean;
}

/**
 * A drawable source for `ctx.drawImage`. Typed `object` deliberately: it is the
 * only DOM-free SUPERTYPE of lib.dom's `CanvasImageSource` union (its
 * `SVGImageElement`/`VideoFrame` branches share no structural `{width;height}`),
 * so the real `CanvasRenderingContext2D.drawImage(CanvasImageSource)` stays
 * assignable to this neutral method while callers pass an `ImageBitmap` OR a
 * `PlatformImage` with no `as unknown` cast.
 */
export type PlatformImageSource = object;

/** Paint value for `fillStyle`. `string | object` is the DOM-free supertype of the
 *  real `string | CanvasGradient | CanvasPattern` (callers only ever assign a color
 *  string; the supertype is what keeps the real 2D context assignable). */
export type PlatformCanvasPaint = string | object;

/**
 * The offscreen 2D context the engine uses: image decode (`drawImage`/
 * `getImageData`/`clearRect`) and dynamic glyph rasterization (`font`/`measureText`/
 * `fillText`/…). Every member is present on BOTH `CanvasRenderingContext2D` and
 * `OffscreenCanvasRenderingContext2D` with covariance-compatible types, so both are
 * assignable here.
 */
export interface PlatformCanvas2DContext {
    // Image decode.
    drawImage(image: PlatformImageSource, dx: number, dy: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): PlatformImageData;
    clearRect(x: number, y: number, w: number, h: number): void;
    // Glyph rasterization (ui/text/glyph-rasterizer.ts).
    font: string;
    textBaseline: string;
    textAlign: string;
    fillStyle: PlatformCanvasPaint;
    measureText(text: string): PlatformTextMetrics;
    fillText(text: string, x: number, y: number): void;
}

/**
 * The offscreen 2D canvas surface. `HTMLCanvasElement` and `OffscreenCanvas` are
 * structurally assignable: their overloaded `getContext` matches this `'2d'`
 * overload, whose real return is assignable to {@link PlatformCanvas2DContext}.
 */
export interface PlatformCanvas {
    width: number;
    height: number;
    getContext(
        contextId: '2d',
        options?: PlatformCanvasContextAttributes,
    ): PlatformCanvas2DContext | null;
}

/**
 * A glyph to rasterize, for a platform whose text comes from the OS rather than a
 * 2D canvas. `style` carries the atlas' bold/italic bits (1 | 2), and `sdf` +
 * `padding` say which encoding the atlas wants — the same two the Canvas2D
 * rasterizer implements, so both backends fill the same atlas.
 */
export interface PlatformGlyphRequest {
    codepoint: number;
    fontFamily: string;
    style: number;
    /** Em size to rasterize at, in px. */
    pixelSize: number;
    /** Signed distance field (128 = edge, `padding` px per half byte-range) vs
     *  plain antialiased coverage. */
    sdf: boolean;
    /** Padding around the ink — the SDF spread — in px. */
    padding: number;
}

/**
 * A rasterized glyph: an upload-ready RGBA8 tile (RGB = 255, A = coverage or SDF)
 * plus its metrics in `pixelSize` units. Structurally the atlas' `RasterGlyph`;
 * declared here so the platform layer stays independent of ui/text.
 */
export interface PlatformGlyph {
    pixels: Uint8Array;
    width: number;
    height: number;
    advance: number;
    bearingX: number;
    bearingY: number;
}

/**
 * A load/error callback SINK: callers only ever ASSIGN one (`img.onload = …`); the
 * host image invokes it. The parameter is the bottom type `never` so, by
 * contravariance, EVERY real handler shape is assignable to it — the DOM
 * `(ev: Event) => any`, the mini-game `() => void`, and the SDK's own
 * `() => resolve()` — without this "neutral" type naming any DOM type (`Event`).
 */
export type PlatformImageEventHandler = ((ev: never) => void) | null;

/**
 * A decodable image (the offscreen `<img>` on DOM hosts). `HTMLImageElement` and a
 * mini-game image are both structurally assignable. Native never creates one
 * (createImage throws), so the DOM-shaped members impose nothing on native.
 * `crossOrigin` is optional so a mini-game image (which lacks it) fits too.
 */
export interface PlatformImage {
    width: number;
    height: number;
    src: string;
    crossOrigin?: string | null;
    onload: PlatformImageEventHandler;
    onerror: PlatformImageEventHandler;
}

// =============================================================================
// Platform Adapter Interface
// =============================================================================

/**
 * A platform's identity. The engine's own platforms are named here for
 * completion; the type stays OPEN so a game can ship an adapter for a host the
 * engine does not know about (a mini-game vendor of its own, an embedded
 * runtime) without editing this file. Capability checks read {@link
 * PlatformAdapter.family}, never the name, so an unknown name is never a
 * degraded platform — only an unfamiliar one.
 */
export type PlatformName = 'web' | 'wechat' | 'douyin' | 'node' | 'native' | (string & {});

/**
 * A capability family several platforms belong to. Engine code that means "no
 * DOM, packaged filesystem, subpackages" asks for the FAMILY (`isMiniGame()`),
 * not a vendor name — so a third-party mini-game host gets the same behavior as
 * WeChat by declaring itself here rather than by being enumerated in the SDK.
 */
export type PlatformFamily = 'minigame';

export interface PlatformAdapter {
    readonly name: PlatformName;

    /**
     * The capability family this platform belongs to, if any. Absent means the
     * platform stands alone (web, node, native). Set by the mini-game family
     * adapter — the single reason `isMiniGame()` needs no vendor list.
     */
    readonly family?: PlatformFamily;

    fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse>;

    readFile(path: string): Promise<ArrayBuffer>;

    readTextFile(path: string): Promise<string>;

    fileExists(path: string): Promise<boolean>;

    loadImagePixels(path: string): Promise<ImageLoadResult>;

    instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports
    ): Promise<WasmInstantiateResult>;

    createCanvas(width: number, height: number): PlatformCanvas;

    /**
     * Rasterize one glyph through the OS text stack, for a platform with no 2D
     * canvas to draw it on. Synchronous: the dynamic glyph atlas fills cells
     * during the frame it needs them.
     *
     * Optional — a platform that has {@link createCanvas} omits it and the atlas
     * uses the Canvas2D rasterizer (web, WeChat). Native implements it (the
     * embedded-Dawn host has no DOM), and `null` means the font or the glyph was
     * unavailable, which the atlas treats as "no cell" exactly as it does a
     * canvas miss.
     */
    rasterizeGlyph?(request: PlatformGlyphRequest): PlatformGlyph | null;

    /**
     * Make a font file the app SHIPS usable under `family`, so `Text` can name
     * it the same way it names a system font. Every platform resolves a family
     * through its own text stack — Canvas2D on the web, the OS matcher on native
     * — and none of them can see a file inside the project, so a shipped font
     * has to be handed to that stack explicitly. This is that hand-off; the font
     * asset loader calls it once per font.
     *
     * Optional: a host without it simply has no project fonts, and `Text` falls
     * back to `fontFamily` (documented behaviour, not a silent failure).
     * Resolves when the family is ready to rasterize with.
     */
    registerFont?(family: string, bytes: ArrayBuffer): Promise<void>;

    /**
     * The OS text-editing surface for editable fields (see
     * {@link PlatformTextEditor}). Optional — a host without one (a headless
     * realm, the editor's edit mode) renders fields but cannot type into them.
     */
    createTextEditor?(): PlatformTextEditor | null;

    now(): number;

    createImage(): PlatformImage;

    bindInputEvents(callbacks: InputEventCallbacks, target?: unknown): void;

    /** Tear down the listeners {@link bindInputEvents} registered. Optional — a
     *  headless host that never binds input (node) omits it. */
    unbindInputEvents?(): void;

    /** Poll connected gamepads for this frame. Optional — platforms without
     *  gamepad support (WeChat, headless) omit it and the input plugin skips
     *  gamepad polling entirely. */
    pollGamepads?(): GamepadSnapshot[];

    /**
     * Bring a store's achievement service up for @p appId, or null.
     *
     * A platform with no store omits it; a desktop build with no client running
     * answers null. The service then keeps its local provider, so a game's code
     * never branches on any of this.
     */
    steamAchievements?(appId: number): AchievementProvider | null;

    /** The signed-in store account, or null. `id` is a STRING — 64 bits of
     *  account id do not survive a double. */
    steamIdentity?(): { id: string; name: string } | null;

    /**
     * Tell me when the store's overlay covers the game, and when it stops.
     *
     * A takeover the game did not ask for: the player pressed Shift+Tab and can
     * no longer act, so it pauses exactly as a fullscreen ad does. Returns an
     * unsubscribe. Absent where no overlay exists, and nothing is missed there.
     */
    onStoreOverlay?(listener: (covered: boolean) => void): () => void;

    /** Create the platform audio backend (WebAudio on web, the mini-game audio API
     *  on WeChat). Optional — a host with no audio device (headless node, the
     *  unshipped native shell) omits it and the audio system falls back to the
     *  silent Null backend, exactly like {@link createVideoBackend}. */
    createAudioBackend?(): import('../audio/PlatformAudioBackend').PlatformAudioBackend;

    /** Create the platform video backend: HTMLVideoElement on web, the wasm
     *  software decoder (videodec side module) on WeChat. The choice is a static
     *  per-platform matrix — no runtime fallback chain. Optional — a platform
     *  without video (headless server) omits it and the video system uses the
     *  silent Null backend. */
    createVideoBackend?(
        ctx: import('../video/PlatformVideoBackend').VideoBackendContext
    ): import('../video/PlatformVideoBackend').PlatformVideoBackend;

    /** Download an on-demand asset subpackage by name and resolve when its files
     *  are available. WeChat → wx.loadSubpackage; platforms with no subpackage
     *  concept (web) omit it and lazy groups load directly from their URLs. */
    loadSubpackage?(name: string): Promise<void>;

    /**
     * Persistent content-addressed byte cache — the offline/disk primitive behind
     * hot-update. `key` is an immutable content-addressed url (the asset's `<hash>.<ext>`
     * CDN url), so an entry NEVER goes stale and needs no invalidation. Hot-update
     * writes each verified downloaded asset here; the http backend reads it first so
     * updated assets stay available offline and skip the CDN roundtrip.
     *
     * Optional — a platform with no local storage (web relies on the browser HTTP
     * cache) omits BOTH; then `platformReadCacheFile` returns null (a miss → normal
     * fetch) and `platformWriteCacheFile` is a no-op. Node (fs) and native (the shell's
     * on-disk store) implement them; WeChat may later back them with `wx` user storage.
     */
    readCacheFile?(key: string): Promise<ArrayBuffer | null>;
    writeCacheFile?(key: string, bytes: ArrayBuffer): Promise<void>;

    /** Open a socket connection. Web → WebSocket, WeChat → wx.connectSocket,
     *  Node → a ws wrapper. Optional — platforms without networking (playable
     *  ads) omit it and `createSocket()` fails loud. */
    createSocket?(options: PlatformSocketOptions): PlatformSocket;

    /** Subscribe to OS memory-pressure warnings; returns an unsubscribe.
     *  WeChat → wx.onMemoryWarning; platforms without a pressure signal (web)
     *  omit it. Residency caches subscribe to drop their evictable entries. */
    onMemoryWarning?(callback: () => void): () => void;

    /**
     * Subscribe to errors that reached the host with nobody catching them —
     * `window.onerror` + `unhandledrejection` on the web, `wx.onError` +
     * `wx.onUnhandledRejection` on a mini-game. Returns an unsubscribe.
     *
     * This is the only channel for the failures that happen OUTSIDE a system:
     * a throw in a `setTimeout`, a promise nobody awaited, a callback from the
     * host. The engine's own errors go through the logger and need no platform.
     * Optional — a platform without the signal simply never fires, and the
     * diagnostics plugin still collects everything else.
     */
    onUnhandledError?(callback: (error: unknown) => void): () => void;

    /**
     * Subscribe to the GPU taking the rendering context away — backgrounding,
     * a driver reset, too many live contexts on the page. Returns an
     * unsubscribe.
     *
     * Worth its own channel because it is invisible from everywhere else: no
     * error is thrown and no log is written, the frames simply stop containing
     * anything. A game whose players report "it went black" has no other way to
     * find out that this is what happened.
     *
     * Who can answer this, and who cannot:
     *
     *   web — yes. `webglcontextlost` does not bubble, but a non-bubbling event
     *   still travels the capture phase, so one window-level listener sees every
     *   canvas.
     *
     *   native — yes, IF the shell wired it (`NativeBridge.onContextLost`). The
     *   surface belongs to the host binary and is not visible from JS at all, so
     *   it has to be pushed in, like memory pressure and foreground/background.
     *
     *   mini-game — NO, and this is a platform limit rather than a gap here. A
     *   mini-game canvas is not a DOM element: `MiniGameCanvas` is width, height
     *   and getContext, with no listener registration and no vendor API for
     *   context loss. Nothing to duck-type for. Left unimplemented rather than
     *   approximated, because a hook that silently never fires reads as "this
     *   never happens" — which on a phone is the opposite of true.
     */
    onContextLost?(callback: () => void): () => void;

    /** App foreground/background signals, for platforms with no DOM visibility
     *  event. The native shell pushes them through its bridge; the Lifecycle
     *  plugin subscribes and auto-pauses on hide. Web/WeChat read visibility from
     *  their own globals (document/wx) and omit these. Each returns an unsubscribe. */
    onAppShow?(callback: () => void): () => void;
    onAppHide?(callback: () => void): () => void;

    /** The host's UI language tag ('zh-CN', 'en-US', …). WeChat reports
     *  'zh_CN'-style tags — `platformLanguage()` normalizes underscores.
     *  Optional; web falls through to navigator.language. */
    language?(): string;

    /** One rewarded ad unit. Mini-game hosts implement it over their
     *  RewardedVideoAd; platforms without an ad system (web, native until a
     *  mediation SDK is wired, playable — networks forbid nested ads) omit the
     *  method, and a family adapter whose PARTICULAR host lacks the capability
     *  returns null. Both answers mean the same thing to the services layer:
     *  substitute the mock provider or fail loud with the reason. */
    createRewardedAd?(adUnitId: string): PlatformRewardedAd | null;
    /** One interstitial ad unit — same availability story as rewarded. */
    createInterstitialAd?(adUnitId: string): PlatformInterstitialAd | null;
    /** Actively open the host's share sheet. Fire-and-forget: since 2021 no
     *  mini-game host reports whether the player actually shared. */
    share?(options: PlatformShareOptions): void;
    /** Provide the card for PASSIVE shares (the host's own share menu). The
     *  host asks at share time, so the provider can answer with live state. */
    onShareRequest?(provide: () => PlatformShareOptions): void;

    /** Send a message into the open data context — the second JS runtime that
     *  is the only place friend data can be read. ONE WAY by nature: no host
     *  offers a channel back, so this returns nothing and nothing awaits it. */
    openDataPostMessage?(message: Record<string, unknown>): void;
    /** The canvas the open data context draws on, for the main domain to sample
     *  as a texture. Null when the host has the capability but this game's
     *  package declares no context to draw with. */
    openDataCanvas?(): PlatformCanvas | null;
    /**
     * Begin a host sign-in. Resolves with the one-time CODE, never a session:
     * turning a code into an identity needs the app secret, which must not be
     * in anything a player can open, so the exchange is the game's own server's
     * to make. A platform with no sign-in omits this.
     */
    login?(): Promise<string>;
    /**
     * Whether {@link login} would reach a real sign-in.
     *
     * Method presence is not a capability probe for a FAMILY adapter — one
     * class serves every mini-game vendor, so it defines `login` whether or not
     * the host behind it has one. An adapter that is one platform can omit this
     * and presence stands; a family answers for the host it actually wraps.
     */
    canSignIn?(): boolean;

    /**
     * Whether in-game purchase is permitted HERE.
     *
     * A separate question from whether the host exposes the call, and the
     * reason this is a capability rather than a try-and-see: on WeChat, paying
     * inside a mini-game is an Android-only permission — the API is present on
     * an iPhone and refusing it is the platform's rule, not a fault. A game has
     * to be able to ask before it shows a shop.
     */
    canPay?(): boolean;
    /** Buy `quantity` units of the host's in-game currency. Resolves when the
     *  host reports the purchase done; rejects with the host's own reason. */
    requestPayment?(request: PlatformPaymentRequest): Promise<void>;
    /** Whether the host still regards the last sign-in as current, so a game
     *  can skip re-exchanging a code it does not need. */
    checkSession?(): Promise<boolean>;
    /** Write this player's own rows to the host's per-player cloud store — the
     *  writable half of a leaderboard. Reading is the open data context's
     *  alone, which is the whole reason that context exists. Returns whether
     *  there was a store to write to; the write itself is fire-and-forget. */
    setCloudKeyValues?(entries: Readonly<Record<string, string>>): boolean;

    devicePixelRatio(): number;

    getStorageItem(key: string): string | null;
    setStorageItem(key: string, value: string): void;
    removeStorageItem(key: string): void;
    clearStorage(prefix: string): void;
}

// =============================================================================
// Monetization / share services
// =============================================================================

/** How a rewarded ad ended: `completed` is whether the reward was earned. */
export interface PlatformRewardedAdResult {
    completed: boolean;
}

/**
 * One rewarded ad unit. `show()` resolves when the ad CLOSED (however that
 * went), never while it is covering the game — the services layer wraps the
 * whole span in pause/resume. Implementations own the host's load/show dance
 * (load on demand, one reload retry on a stale instance).
 */
export interface PlatformRewardedAd {
    preload(): Promise<void>;
    show(): Promise<PlatformRewardedAdResult>;
    destroy(): void;
}

/** One interstitial ad unit. Same contract as rewarded, minus the reward. */
export interface PlatformInterstitialAd {
    preload(): Promise<void>;
    show(): Promise<void>;
    destroy(): void;
}

/** One in-game purchase, in the vocabulary every mini-game host shares. */
export interface PlatformPaymentRequest {
    /** The offer this game sells under, from the host's developer console. */
    offerId: string;
    /** How many units of the host's in-game currency to buy. */
    quantity: number;
    /** Which of the game's zones/servers the currency lands in. Hosts default
     *  it to the first one; a single-zone game can leave it out. */
    zoneId?: string;
    /** Use the host's sandbox rather than charging real money. */
    sandbox?: boolean;
}

/** The share card for an active or passive share. `query` rides the launch
 *  options of whoever opens the shared card (invite links, room codes). */
export interface PlatformShareOptions {
    title?: string;
    imageUrl?: string;
    query?: string;
}

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * @deprecated Use {@link PlatformName}. Kept as an alias so existing imports
 * keep compiling; it named a closed set that a third-party host could not join.
 */
export type PlatformType = PlatformName;
