// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hostBridge.ts
 * @brief   Build a {@link NativeBridge} from the primitives a native host installs
 *          on the JS global.
 * @details The host's job is the small, unavoidable part — reading a packaged
 *          file, decoding an image, persisting a key — as `es_*` functions it
 *          binds from C++. Assembling those into the bridge the SDK consumes is
 *          the SDK's job, and belongs here rather than in a JS string inside the
 *          host: typed against the interface it must satisfy, checked by the
 *          compiler, and identical on every platform the host runs on.
 */

import { log } from '../../util/logger';
import type {
    NativeAudioBridge, NativeBridge, NativeFetchResult, NativeInputListener,
    NativeTextEditorBridge, NativeTextEditorPush,
} from './bridge';
import type { PlatformGlyph, PlatformGlyphRequest, PlatformRequestOptions } from '../types';
import { assertHostEnvironment } from './hostEnvironment';
import { hasAudioBindings } from '../../ecs/bridge/nativeBindings';

/** Touch phases the host reports, matching the order it dispatches. */
const TOUCH_START = 0;
const TOUCH_MOVE = 1;
const TOUCH_END = 2;

/** Pointer phases, same convention: a mouse has no cancel. */
const POINTER_DOWN = 0;
const POINTER_MOVE = 1;

/** The `es_*` primitives a native host binds. Required unless marked optional. */
export interface NativeHostBindings {
    /** A packaged file's bytes, or null when it is not in the package. */
    es_readAsset(path: string): ArrayBuffer | null;
    /** Decode a packaged image to top-first RGBA, or null on failure. */
    es_loadImagePixels(path: string): { width: number; height: number; pixels: ArrayBuffer } | null;
    /** Rasterize one glyph through the OS font stack — what a 2D canvas does on
     *  the web. Optional, all-or-nothing with the rest of {@link TEXT_BINDINGS}:
     *  a host that has not bound its font stack draws no text. */
    es_rasterizeGlyph?(request: PlatformGlyphRequest): {
        pixels: ArrayBuffer; width: number; height: number;
        advance: number; bearingX: number; bearingY: number;
    } | null;
    /** A writable byte store the platform may reclaim (the host's cache dir).
     *  Optional: without it there is no offline hot-update cache. */
    es_readCacheFile?(key: string): ArrayBuffer | null;
    es_writeCacheFile?(key: string, bytes: ArrayBuffer | Uint8Array | string): boolean;
    /** The durable store, for what a player would notice losing. Separate from the
     *  cache pair above because the platform is allowed to empty a cache and iOS
     *  does: a host that maps both onto one directory has decided saves are
     *  disposable, whether or not it meant to. */
    es_readDataFile?(key: string): ArrayBuffer | null;
    es_writeDataFile?(key: string, bytes: ArrayBuffer | Uint8Array | string): boolean;
    /** Native key-value store, when the host has one (NSUserDefaults /
     *  SharedPreferences). Absent hosts persist through es_writeDataFile. */
    es_getStorageItem?(key: string): string | null;
    es_setStorageItem?(key: string, value: string): void;
    es_removeStorageItem?(key: string): void;
    es_storageKeys?(): string[];
    /** Screen scale (1 when the host reports surface pixels directly). */
    es_devicePixelRatio?(): number;

    /** The gamepads this frame, in the W3C standard layout. Absent on a host with
     *  no pads to report — a phone, where the SDK sees the same empty list a
     *  browser without navigator.getGamepads() gives it. */
    es_pollGamepads?(): { index: number; connected: boolean; buttons: number[]; axes: number[] }[];

    /** The Steam client. Bound only where one can exist (desktop). */
    es_steam_init?(appId: number): boolean;
    es_steam_available?(): boolean;
    es_steam_identity?(): { id: string; name: string };
    es_steam_unlock?(id: string): boolean;
    es_steam_unlocked?(id: string): boolean;
    es_steam_setStat?(name: string, value: number): boolean;
    es_steam_getStat?(name: string): number;
    es_steam_store?(): boolean;
    es_steam_reset?(): boolean;

    /** Perform an HTTP request off the main thread (native TLS stack), calling
     *  back with the reply. Optional — a host without it stays offline (remote
     *  asset groups and hot-update do not resolve). */
    es_fetch?(
        request: {
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: string | ArrayBuffer;
            responseType?: string;
        },
        callback: (result: {
            ok: boolean;
            status: number;
            statusText: string;
            headers: Record<string, string>;
            arrayBuffer?: ArrayBuffer;
            text?: string;
            error?: string;
        }) => void,
    ): void;

    /** The native audio engine, all-or-nothing (see {@link AUDIO_BINDINGS}). A
     *  host without a sound device binds none and stays silent. */
    // The OS text-editing surface (soft keyboard + IME). Optional as a group:
    // hasTextEditorBindings gates them, so a host that wired none simply has no
    // editing surface. The host pushes what the user did through
    // es_onNativeTextEditor, installed here.
    es_textEditor_focus?(
        value: string, selectionStart: number, selectionEnd: number,
        multiline: boolean, maxLength: number, password: boolean,
    ): void;
    es_textEditor_blur?(): void;
    es_textEditor_write?(value: string, selectionStart: number, selectionEnd: number): void;

    es_audioSpectrum?(bins: number): ArrayBuffer | null;
    es_audioLoad?(bytes: ArrayBuffer): { id: number; duration: number; bytes: number } | null;
    es_audioUnload?(bufferId: number): void;
    es_audioPlay?(bufferId: number, volume: number, pan: number, loop: boolean, rate: number): number;
    es_audioStop?(voiceId: number): void;
    es_audioPause?(voiceId: number): void;
    es_audioResume?(voiceId: number): void;
    es_audioSetVolume?(voiceId: number, volume: number): void;
    es_audioSetPan?(voiceId: number, pan: number): void;
    es_audioSetLoop?(voiceId: number, loop: boolean): void;
    es_audioSetRate?(voiceId: number, rate: number): void;
    es_audioVoiceState?(voiceId: number): { playing: boolean; currentTime: number } | null;
    es_audioSuspendAll?(): void;
    es_audioResumeAll?(): void;
}

/**
 * Assemble the bridge from a host's bindings. The returned object also installs
 * `es_onNativeTouch` on @p scope — the entry point the host calls per touch,
 * which fans out to whatever input sink the engine registered.
 *
 * @throws if a required binding is missing, naming it — a native boot should fail
 *         at the seam rather than somewhere deep in an asset load.
 */
export function createHostBridge(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): NativeBridge {
    // Both halves of the contract, checked at the seam: the JS environment the
    // host had to install, then its own es_* primitives.
    assertHostEnvironment(scope);
    const bindings = scope as unknown as NativeHostBindings;
    for (const name of ['es_readAsset', 'es_loadImagePixels'] as const) {
        if (typeof bindings[name] !== 'function') {
            throw new Error(`[native] host binding ${name}() is missing — the shell must install it before booting`);
        }
    }

    let listener: NativeInputListener | null = null;
    scope.es_onNativeTouch = (type: number, id: number, x: number, y: number): void => {
        if (!listener) return;
        if (type === TOUCH_START) listener.onTouchStart(id, x, y);
        else if (type === TOUCH_MOVE) listener.onTouchMove(id, x, y);
        else if (type === TOUCH_END) listener.onTouchEnd(id);
        else listener.onTouchCancel(id);
    };
    scope.es_onNativePointer = (type: number, button: number, x: number, y: number): void => {
        if (!listener) return;
        if (type === POINTER_DOWN) listener.onPointerDown(button, x, y);
        else if (type === POINTER_MOVE) listener.onPointerMove(x, y);
        else listener.onPointerUp(button);
    };
    scope.es_onNativeWheel = (deltaX: number, deltaY: number): void => {
        listener?.onWheel(deltaX, deltaY);
    };
    scope.es_onNativeKey = (down: boolean, code: string): void => {
        if (!listener) return;
        if (down) listener.onKeyDown(code); else listener.onKeyUp(code);
    };

    const storage = hostStorage(bindings);
    const audio = hostAudio(bindings, scope);
    const textEditor = hostTextEditor(bindings, scope);
    const lifecycle = hostLifecycle(scope);

    return {
        readFile: (path) => {
            const bytes = bindings.es_readAsset(path);
            return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`asset not found: ${path}`));
        },
        fileExists: (path) => Promise.resolve(bindings.es_readAsset(path) != null),
        fetch: (url, options) => hostFetch(bindings, url, options),
        loadImagePixels: (path) => {
            const decoded = bindings.es_loadImagePixels(path);
            return decoded
                ? Promise.resolve({
                    width: decoded.width,
                    height: decoded.height,
                    pixels: new Uint8Array(decoded.pixels),
                })
                : Promise.reject(new Error(`image decode failed: ${path}`));
        },
        ...(bindings.es_rasterizeGlyph ? { rasterizeGlyph: (request) => hostGlyph(bindings, request) } : {}),
        ...storage,
        ...(bindings.es_readCacheFile && bindings.es_writeCacheFile
            ? {
                readCacheFile: (key: string) => Promise.resolve(bindings.es_readCacheFile!(key)),
                writeCacheFile: (key: string, bytes: ArrayBuffer) => {
                    bindings.es_writeCacheFile!(key, bytes);
                    return Promise.resolve();
                },
            }
            : {}),
        registerInput: (sink) => {
            listener = sink;
            return () => { listener = null; };
        },
        devicePixelRatio: () => bindings.es_devicePixelRatio?.() ?? 1,
        // All-or-nothing: the host binds the whole surface or none of it, so one
        // probe decides rather than nine optional calls at every site.
        ...(bindings.es_steam_init
            ? {
                steam: {
                    init: (appId: number) => bindings.es_steam_init!(appId),
                    available: () => bindings.es_steam_available?.() ?? false,
                    identity: () => bindings.es_steam_identity?.() ?? { id: '', name: '' },
                    unlock: (id: string) => bindings.es_steam_unlock?.(id) ?? false,
                    unlocked: (id: string) => bindings.es_steam_unlocked?.(id) ?? false,
                    setStat: (n: string, v: number) => bindings.es_steam_setStat?.(n, v) ?? false,
                    getStat: (n: string) => bindings.es_steam_getStat?.(n) ?? 0,
                    store: () => bindings.es_steam_store?.() ?? false,
                    reset: () => bindings.es_steam_reset?.() ?? false,
                },
            }
            : {}),
        ...(bindings.es_pollGamepads
            // 'standard' is asserted HERE rather than by the host: the layout is
            // this bridge's contract with the SDK, and a host that filled the
            // arrays in that order has already met it.
            ? {
                pollGamepads: () => bindings.es_pollGamepads!().map((pad) => ({
                    index: pad.index,
                    connected: pad.connected,
                    buttons: pad.buttons,
                    axes: pad.axes,
                    mapping: 'standard',
                })),
            }
            : {}),
        ...(audio ? { audio } : {}),
        ...(textEditor ? { textEditor } : {}),
        ...lifecycle,
    };
}

/**
 * One glyph from the host's font stack, as the atlas wants it. The host answers
 * with an ArrayBuffer (a native JS engine hands raw buffers across, as it does
 * for decoded images); the view is the SDK's to put on, so the atlas' upload
 * path sees the same Uint8Array it gets from a canvas.
 */
function hostGlyph(bindings: NativeHostBindings, request: PlatformGlyphRequest): PlatformGlyph | null {
    const glyph = bindings.es_rasterizeGlyph!(request);
    if (!glyph) return null;
    return {
        pixels: new Uint8Array(glyph.pixels),
        width: glyph.width,
        height: glyph.height,
        advance: glyph.advance,
        bearingX: glyph.bearingX,
        bearingY: glyph.bearingY,
    };
}

/**
 * Perform an HTTP request through the host's native stack (es_fetch), wrapping
 * its callback in the Promise the adapter expects. A host without es_fetch is
 * offline — a 404, exactly as before, so remote groups just fail to resolve.
 */
function hostFetch(
    bindings: NativeHostBindings, url: string, options?: PlatformRequestOptions,
): Promise<NativeFetchResult> {
    if (typeof bindings.es_fetch !== 'function') {
        return Promise.resolve({ ok: false, status: 404, statusText: 'no network' });
    }
    return new Promise((resolve, reject) => {
        bindings.es_fetch!(
            {
                url,
                method: options?.method,
                headers: options?.headers,
                body: options?.body,
                responseType: options?.responseType,
            },
            (r) => {
                if (r.error) {
                    reject(new Error(r.error));
                    return;
                }
                resolve({
                    ok: r.ok,
                    status: r.status,
                    statusText: r.statusText,
                    headers: r.headers,
                    arrayBuffer: r.arrayBuffer,
                    text: r.text,
                });
            },
        );
    });
}

/**
 * Assemble the audio bridge from the host's es_audio* primitives, or undefined
 * when the host bound none (→ silent Null backend). Also installs
 * `es_onNativeAudioEnded`, the entry point the host calls when a voice ends on
 * its own, fanning out to the backend that subscribed.
 */
function hostAudio(
    bindings: NativeHostBindings, scope: Record<string, unknown>,
): NativeAudioBridge | undefined {
    if (!hasAudioBindings(scope)) return undefined;
    let ended: ((voiceId: number) => void) | null = null;
    scope.es_onNativeAudioEnded = (voiceId: number): void => { ended?.(voiceId); };
    return {
        load: (bytes) => bindings.es_audioLoad!(bytes),
        unload: (id) => bindings.es_audioUnload!(id),
        play: (buf, vol, pan, loop, rate) => bindings.es_audioPlay!(buf, vol, pan, loop, rate),
        stop: (v) => bindings.es_audioStop!(v),
        pause: (v) => bindings.es_audioPause!(v),
        resume: (v) => bindings.es_audioResume!(v),
        setVolume: (v, x) => bindings.es_audioSetVolume!(v, x),
        setPan: (v, x) => bindings.es_audioSetPan!(v, x),
        setLoop: (v, on) => bindings.es_audioSetLoop!(v, on),
        setRate: (v, x) => bindings.es_audioSetRate!(v, x),
        voiceState: (v) => bindings.es_audioVoiceState!(v),
        suspendAll: () => bindings.es_audioSuspendAll!(),
        resumeAll: () => bindings.es_audioResumeAll!(),
        onEnded: (cb) => { ended = cb; return () => { if (ended === cb) ended = null; }; },
        // Optional: a host without the analyser tap simply has no spectrum, and
        // a visualizer falls back to flat bars (as it does on any backend
        // without analysis).
        ...(bindings.es_audioSpectrum
            ? { spectrum: (bins: number) => bindings.es_audioSpectrum!(bins) }
            : {}),
    };
}

/**
 * The host's editing surface, when it bound one: calls out through its
 * `es_textEditor_*` entry points, and takes what the user did through
 * `es_onNativeTextEditor`, installed here the way the lifecycle signals are.
 * All-or-nothing — a host with only some of the entry points has no surface,
 * rather than one that opens a keyboard it cannot read.
 */
function hostTextEditor(
    bindings: NativeHostBindings,
    scope: Record<string, unknown>,
): NativeTextEditorBridge | undefined {
    if (!bindings.es_textEditor_focus || !bindings.es_textEditor_blur || !bindings.es_textEditor_write) {
        return undefined;
    }
    let subs: ((push: NativeTextEditorPush) => void)[] = [];
    scope.es_onNativeTextEditor = (push: NativeTextEditorPush): void => {
        for (const cb of subs) cb(push);
    };
    return {
        focus: (value, selectionStart, selectionEnd, multiline, maxLength, password) =>
            bindings.es_textEditor_focus!(value, selectionStart, selectionEnd, multiline, maxLength, password),
        blur: () => bindings.es_textEditor_blur!(),
        write: (value, selectionStart, selectionEnd) =>
            bindings.es_textEditor_write!(value, selectionStart, selectionEnd),
        subscribe: (handler) => {
            subs.push(handler);
            return () => { subs = subs.filter((s) => s !== handler); };
        },
    };
}

/**
 * The lifecycle signals the host pushes (like touch), each installed as an
 * `es_onNative*` entry the shell calls and exposed as a subscribe/unsubscribe on
 * the bridge: foreground/background (`es_onNativeVisibility` → onShow/onHide, the
 * Lifecycle plugin auto-pauses) and memory pressure (`es_onNativeMemoryWarning` →
 * onMemoryWarning, residency caches trim).
 */
function hostLifecycle(
    scope: Record<string, unknown>,
): Pick<NativeBridge, 'onShow' | 'onHide' | 'onMemoryWarning'> {
    /** A subscriber list installed behind a host push entry; returns its API. */
    const signal = (install: (fire: () => void) => void): ((cb: () => void) => () => void) => {
        let subs: (() => void)[] = [];
        install(() => { for (const cb of subs) cb(); });
        return (cb) => { subs.push(cb); return () => { subs = subs.filter((c) => c !== cb); }; };
    };

    let onShow: (() => void) | undefined;
    let onHide: (() => void) | undefined;
    const subShow = signal((fire) => { onShow = fire; });
    const subHide = signal((fire) => { onHide = fire; });
    scope.es_onNativeVisibility = (visible: boolean): void => { (visible ? onShow : onHide)?.(); };

    return {
        onShow: subShow,
        onHide: subHide,
        onMemoryWarning: signal((fire) => { scope.es_onNativeMemoryWarning = fire; }),
    };
}

/** Where storage lands when the host has no native key-value store. */
const STORAGE_FILE = 'estella-storage.json';

/**
 * Key-value storage, best available: the host's own store, else a JSON file in
 * its durable directory, else memory for the session. The API is synchronous
 * (localStorage's shape), so the file variant keeps the map in memory and writes
 * through on every mutation — storage holds saves and settings, not bulk data.
 *
 * The file is WRITTEN to the DATA store, never the cache. An older host that binds
 * only the cache pair still persists through it, because a cache that usually
 * survives beats losing the save at every exit — but it is the wrong directory on
 * any platform that reclaims one, so say so once rather than let a player find out.
 *
 * It is READ from the cache too, once, when the durable store has nothing: builds
 * before the split wrote every save there, and a player updating across it would
 * otherwise open the game to a blank profile.
 */
function hostStorage(bindings: NativeHostBindings): Pick<
    NativeBridge, 'getStorageItem' | 'setStorageItem' | 'removeStorageItem' | 'storageKeys'
> {
    if (typeof bindings.es_getStorageItem === 'function') {
        return {
            getStorageItem: (key) => bindings.es_getStorageItem!(key),
            setStorageItem: (key, value) => bindings.es_setStorageItem?.(key, value),
            removeStorageItem: (key) => bindings.es_removeStorageItem?.(key),
            storageKeys: () => bindings.es_storageKeys?.() ?? [],
        };
    }

    const durable = typeof bindings.es_readDataFile === 'function'
        && typeof bindings.es_writeDataFile === 'function';
    const read = durable ? bindings.es_readDataFile! : bindings.es_readCacheFile;
    const write = durable ? bindings.es_writeDataFile! : bindings.es_writeCacheFile;

    const entries = new Map<string, string>();
    const persistent = typeof read === 'function' && typeof write === 'function';
    /** Read a stored blob into `entries`. False when it was not readable. */
    const adopt = (bytes: ArrayBuffer): boolean => {
        try {
            for (const [k, v] of Object.entries(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>)) {
                entries.set(k, v);
            }
            return true;
        } catch {
            log.warn('native', 'stored data was unreadable — starting empty');
            return false;
        }
    };

    /** The save came from the cache directory and owes the durable one a copy. */
    let inherited = false;
    if (!persistent) {
        log.warn('native', 'host has no storage or file bindings — saves last only for this session');
    } else {
        if (!durable) {
            log.warn('native', 'host binds no durable store — saves go to its cache, which the platform may reclaim');
        }
        const own = read!(STORAGE_FILE);
        if (own) {
            adopt(own);
        } else if (durable) {
            // Nothing in the durable store. Either nothing was ever saved, in which
            // case the cache holds nothing either — or the player updated from a
            // build that knew only the cache directory, and their save is the file
            // sitting in it. Not looking there is indistinguishable from having
            // deleted it, and it would happen on exactly the version that claims to
            // have made saves safe.
            const previous = bindings.es_readCacheFile?.(STORAGE_FILE) ?? null;
            if (previous && adopt(previous) && entries.size > 0) {
                inherited = true;
                log.info('native', 'adopted the save an earlier build left in the cache directory');
            }
        }
    }
    const flush = (): void => {
        if (!persistent) return;
        // A string, not encoded bytes: the host writes UTF-8 itself, and a native
        // JS engine has no TextEncoder to reach for.
        write!(STORAGE_FILE, JSON.stringify(Object.fromEntries(entries)));
    };
    // Write an inherited save through now rather than at the next mutation: the
    // cache copy is never read again, and the directory it is in is the one the
    // platform is allowed to empty.
    if (inherited) flush();
    return {
        getStorageItem: (key) => entries.get(key) ?? null,
        setStorageItem: (key, value) => { entries.set(key, value); flush(); },
        removeStorageItem: (key) => { entries.delete(key); flush(); },
        storageKeys: () => [...entries.keys()],
    };
}
