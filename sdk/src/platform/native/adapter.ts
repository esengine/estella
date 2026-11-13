// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    adapter.ts
 * @brief   The native PlatformAdapter — the same engine wasm + TS SDK running on
 *          an embedded Dawn (WebGPU) + JS engine host (iOS/Android), NOT a WebView.
 *          It owns no OS capability itself: every call delegates to the injected
 *          {@link NativeBridge}. WASM instantiates through the host JS engine's
 *          `WebAssembly` global (like the Node host); textures take the
 *          pixel-decode path (loadImagePixels), so the offscreen DOM
 *          canvas/image methods fail loud rather than pretend.
 *
 * @beta   Pre-1.0: unshipped native host; the adapter surface will change with the
 *         shell. Public via the `esengine/native` entry.
 */

import type {
    PlatformAdapter,
    PlatformRequestOptions,
    PlatformResponse,
    WasmInstantiateResult,
    InputEventCallbacks,
    GamepadSnapshot,
    ImageLoadResult,
    PlatformCanvas,
    PlatformImage,
    PlatformGlyph,
    PlatformGlyphRequest,
    PlatformTextEditor,
    PlatformSocket,
    PlatformSocketOptions,
    PlatformNativeChannel,
    PlatformRewardedAd,
    PlatformInterstitialAd,
} from '../types';
import { NativeSocket } from './socket';
import { unavailableDevice } from '../../device/core';
import type { PlatformAudioBackend } from '../../audio/PlatformAudioBackend';
import type { PlatformVideoBackend, VideoBackendContext } from '../../video/PlatformVideoBackend';
import { WasmVideoBackend } from '../../video/WasmVideoBackend';
import { setPlatform } from '../base';
import { createPrimaryPointer } from '../primaryPointer';
import { NativeAudioBackend } from '../../audio/NativeAudioBackend';
import { createNativeTextEditor } from './textEditor';
import {
    createNativeChannel, createNativeInterstitialAd, createNativeRewardedAd, nativeChannelHasAds,
} from './channel';
import { browserLanguageTag } from './languageTag';
import { createSteamAchievements } from './steamAchievements';
import type { AchievementProvider } from '../../services/achievements';
import type { NativeBridge, NativeInputListener } from './bridge';

export class NativePlatformAdapter implements PlatformAdapter {
    readonly name = 'native' as const;
    device() { return this.bridge_.device?.() ?? this.unavailableDevice_; }
    private readonly unavailableDevice_ = unavailableDevice();
    private inputCleanup_: (() => void) | null = null;

    constructor(private readonly bridge_: NativeBridge) {
        // Only advertise audio when the host bound an engine; otherwise the base
        // helper falls back to the silent Null backend (createAudioBackend stays
        // undefined), exactly as on a host with no sound device.
        if (bridge_.audio) {
            const audio = bridge_.audio;
            this.createAudioBackend = () => new NativeAudioBackend(audio);
        }
        // Likewise for text: present only when the host bound its font stack, so
        // `platformHasGlyphRasterizer()` answers truthfully and the glyph atlas
        // knows whether this device can produce glyphs at all.
        if (bridge_.rasterizeGlyph) {
            const rasterize = bridge_.rasterizeGlyph.bind(bridge_);
            this.rasterizeGlyph = (request) => rasterize(request);
        }
        // The app's own native code, and ads over it. The ad factories exist only
        // when that code answers for ads, so `Ads.available` is the truth about
        // THIS app rather than about native hosts in general. Asked once, here:
        // the app's plugins registered before the script started.
        if (bridge_.channel) {
            const channel = createNativeChannel(bridge_.channel);
            this.channel_ = channel;
            if (nativeChannelHasAds(channel)) {
                this.createRewardedAd = (adUnitId) => createNativeRewardedAd(channel, adUnitId);
                this.createInterstitialAd = (adUnitId) => createNativeInterstitialAd(channel, adUnitId);
            }
        }
    }

    private channel_: PlatformNativeChannel | null = null;

    /** The app's own native code; null on a host built before the channel. */
    nativeChannel(): PlatformNativeChannel | null {
        return this.channel_;
    }

    /** Assigned in the constructor only when the app's native code answers for ads. */
    createRewardedAd?: (adUnitId: string) => PlatformRewardedAd | null;
    createInterstitialAd?: (adUnitId: string) => PlatformInterstitialAd | null;

    /** Assigned in the constructor only when the host bound an audio engine. */
    createAudioBackend?: () => PlatformAudioBackend;

    /** Assigned in the constructor only when the host bound a glyph rasterizer. */
    rasterizeGlyph?: (request: PlatformGlyphRequest) => PlatformGlyph | null;

    async fetch(url: string, options?: PlatformRequestOptions): Promise<PlatformResponse> {
        const r = await this.bridge_.fetch(url, options);
        const text = () =>
            Promise.resolve(r.text ?? new TextDecoder().decode(r.arrayBuffer ?? new ArrayBuffer(0)));
        return {
            ok: r.ok,
            status: r.status,
            statusText: r.statusText ?? '',
            headers: r.headers ?? {},
            json: async <T>() => JSON.parse(await text()) as T,
            text,
            arrayBuffer: () =>
                Promise.resolve(
                    r.arrayBuffer ?? (new TextEncoder().encode(r.text ?? '').buffer as ArrayBuffer),
                ),
        };
    }

    readFile(path: string): Promise<ArrayBuffer> {
        return this.bridge_.readFile(path);
    }

    async readTextFile(path: string): Promise<string> {
        return new TextDecoder().decode(await this.bridge_.readFile(path));
    }

    fileExists(path: string): Promise<boolean> {
        return this.bridge_.fileExists(path);
    }

    loadImagePixels(path: string): Promise<ImageLoadResult> {
        return this.bridge_.loadImagePixels(path);
    }

    async instantiateWasm(
        pathOrBuffer: string | ArrayBuffer,
        imports: WebAssembly.Imports,
    ): Promise<WasmInstantiateResult> {
        // The host JS engine (JavaScriptCore / V8 / Hermes) provides WebAssembly —
        // no bridge call needed, same as the Node host.
        const buffer = typeof pathOrBuffer === 'string' ? await this.bridge_.readFile(pathOrBuffer) : pathOrBuffer;
        const { instance, module } = await WebAssembly.instantiate(buffer, imports);
        return { instance, module };
    }

    // No offscreen DOM on native: image decode is the pixel path (loadImagePixels),
    // and the GPU surface enters via the device handle (out of scope). Fail loud,
    // like the Node host, instead of returning a fake canvas.
    createCanvas(_width: number, _height: number): PlatformCanvas {
        throw new Error('[native] no offscreen 2D canvas — decode via loadImagePixels (Path 2)');
    }

    createImage(): PlatformImage {
        throw new Error('[native] no DOM images — decode via loadImagePixels');
    }

    /** The OS soft keyboard + IME, when the host wired one. Null → editable
     *  fields render but cannot be typed into (platform/native/textEditor.ts). */
    createTextEditor(): PlatformTextEditor | null {
        const editor = this.bridge_.textEditor;
        return editor ? createNativeTextEditor(editor) : null;
    }

    now(): number {
        return this.bridge_.now?.() ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }

    devicePixelRatio(): number {
        return this.bridge_.devicePixelRatio();
    }

    safeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
        return this.bridge_.safeAreaInsets?.() ?? { top: 0, bottom: 0, left: 0, right: 0 };
    }

    language(): string {
        // The OS's spelling ('zh-Hans-CN', 'zh_CN.UTF-8') reduced to the one a
        // browser reports ('zh-CN'), so a game compares the same tag everywhere.
        return browserLanguageTag(this.bridge_.language?.()) ?? 'en';
    }

    bindInputEvents(callbacks: InputEventCallbacks): void {
        this.inputCleanup_?.();
        const pointer = createPrimaryPointer(callbacks);
        const heldKeys = new Set<string>();
        const heldTouches = new Set<number>();
        const heldButtons = new Set<number>();
        const cancelInput = (): void => {
            for (const code of heldKeys) callbacks.onKeyUp(code);
            heldKeys.clear();
            for (const id of heldTouches) pointer.cancel(id);
            heldTouches.clear();
            heldButtons.clear();
            callbacks.onInputCancel?.();
        };
        const listener: NativeInputListener = {
            onTouchStart: (id, x, y) => { heldTouches.add(id); pointer.start(id, x, y); },
            onTouchMove: (id, x, y) => { if (heldTouches.has(id)) pointer.move(id, x, y); },
            onTouchEnd: (id) => { if (heldTouches.delete(id)) pointer.end(id); },
            onTouchCancel: (id) => { if (heldTouches.delete(id)) pointer.cancel(id); },
            // Straight through, NOT via createPrimaryPointer: a mouse already is
            // the pointer and carries a button, and routing it through the touch
            // synthesizer would drop every button but the first.
            onPointerDown: (button, x, y) => { heldButtons.add(button); callbacks.onPointerDown(button, x, y); },
            onPointerMove: (x, y) => callbacks.onPointerMove(x, y),
            onPointerUp: (button) => { if (heldButtons.delete(button)) callbacks.onPointerUp(button); },
            onWheel: (dx, dy) => callbacks.onWheel(dx, dy),
            onKeyDown: (code) => { heldKeys.add(code); callbacks.onKeyDown(code); },
            onKeyUp: (code) => { if (heldKeys.delete(code)) callbacks.onKeyUp(code); },
        };
        const unregisterInput = this.bridge_.registerInput(listener);
        const unregisterHide = this.bridge_.onHide?.(cancelInput);
        this.inputCleanup_ = () => {
            unregisterInput();
            unregisterHide?.();
            cancelInput();
        };
    }

    unbindInputEvents(): void {
        this.inputCleanup_?.();
        this.inputCleanup_ = null;
    }

    // Foreground/background: the shell has no DOM visibility event, so the
    // Lifecycle plugin's native branch subscribes here and the host pushes the
    // signal through the bridge. A bridge without them → the app stays visible.
    onAppShow(callback: () => void): () => void {
        return this.bridge_.onShow?.(callback) ?? (() => {});
    }

    onAppHide(callback: () => void): () => void {
        return this.bridge_.onHide?.(callback) ?? (() => {});
    }

    // OS memory pressure → residency caches (the audio buffer cache) trim. A bridge
    // without the signal never fires.
    onMemoryWarning(callback: () => void): () => void {
        return this.bridge_.onMemoryWarning?.(callback) ?? (() => {});
    }

    // Device loss, pushed by the shell — invisible from JS on native, since the
    // surface lives in the host binary. A bridge without it never fires.
    onContextLost(callback: () => void): () => void {
        return this.bridge_.onContextLost?.(callback) ?? (() => {});
    }

    // Same shape, same reason: QuickJS has no window.onerror, so an uncaught
    // error is only visible to the shell's exception callback.
    onUnhandledError(callback: (error: unknown) => void): () => void {
        return this.bridge_.onUnhandledError?.(callback) ?? (() => {});
    }

    getStorageItem(key: string): string | null {
        return this.bridge_.getStorageItem(key);
    }

    setStorageItem(key: string, value: string): void {
        this.bridge_.setStorageItem(key, value);
    }

    removeStorageItem(key: string): void {
        this.bridge_.removeStorageItem(key);
    }

    clearStorage(prefix: string): void {
        for (const k of this.bridge_.storageKeys()) {
            if (k.startsWith(prefix)) this.bridge_.removeStorageItem(k);
        }
    }

    // Content-addressed disk cache — delegates to the shell's on-disk store when it
    // provides one, else behaves as "no cache" (miss / no-op), so hot-update degrades
    // to plain CDN refetch on a shell without caching.
    async readCacheFile(key: string): Promise<ArrayBuffer | null> {
        return this.bridge_.readCacheFile ? this.bridge_.readCacheFile(key) : null;
    }

    hasCacheStorage(): boolean { return Boolean(this.bridge_.readCacheFile && this.bridge_.writeCacheFile); }

    async writeCacheFile(key: string, bytes: ArrayBuffer): Promise<void> {
        if (this.bridge_.writeCacheFile) await this.bridge_.writeCacheFile(key, bytes);
    }

    // The engine-owned software decoder, exactly as the mini-game family uses it:
    // the videodec runtime is compiled into the device binary (a side module the
    // host answers through es_video_*), so WasmVideoBackend acquires it off
    // app.sideModules and plays a cooked `.esv` — a device has no other video path.
    createVideoBackend(ctx: VideoBackendContext): PlatformVideoBackend {
        return new WasmVideoBackend(ctx);
    }

    /** Whatever the shell can see; none where it reports nothing, which is the
     *  same empty list a browser without navigator.getGamepads() gives. */
    pollGamepads(): GamepadSnapshot[] {
        return this.bridge_.pollGamepads?.() ?? [];
    }

    /**
     * Bring Steam up for @p appId and hand back its achievements provider, or null.
     *
     * Null is the ordinary answer: no client running, signed out, a build that
     * ships nowhere near Steam, or a platform that has none. The service keeps its
     * local provider and the game behaves the same.
     */
    steamAchievements(appId: number): AchievementProvider | null {
        const steam = this.bridge_.steam;
        if (!steam || !steam.init(appId) || !steam.available()) return null;
        return createSteamAchievements(steam);
    }

    /** The signed-in Steam account, or null. `id` is a string: 64 bits of account
     *  id do not survive a double. */
    steamIdentity(): { id: string; name: string } | null {
        const steam = this.bridge_.steam;
        return steam?.available() ? steam.identity() : null;
    }

    /** Open the window at the project's design resolution. A no-op on a host that
     *  has no window of its own. */
    setWindowSize(width: number, height: number): void {
        this.bridge_.setWindowSize?.(width, height);
    }

    /** The store overlay covering the game, and uncovering it. */
    onStoreOverlay(listener: (covered: boolean) => void): () => void {
        const steam = this.bridge_.steam;
        if (!steam) return () => {};
        let live = true;
        steam.onOverlay((covered) => { if (live) listener(covered); });
        return () => { live = false; };
    }

    isHandheld(): boolean {
        return this.bridge_.isHandheld?.() ?? false;
    }

    deviceName(): string {
        return this.bridge_.deviceName?.() ?? '';
    }

    createSocket(options: PlatformSocketOptions): PlatformSocket {
        const socket = this.bridge_.socket;
        if (!socket) throw new Error('this native host carries no socket client');
        return new NativeSocket(options.url, socket);
    }
}

/** Install a {@link NativePlatformAdapter} built from the host `bridge` as the
 *  active platform. The native shell calls this once at boot, before creating the
 *  engine App (mirrors the web/wechat/node entry points). */
export function installNativePlatform(bridge: NativeBridge): NativePlatformAdapter {
    const adapter = new NativePlatformAdapter(bridge);
    setPlatform(adapter);
    return adapter;
}
