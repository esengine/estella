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

import { log } from '../../logger';
import type { NativeBridge, NativeInputListener } from './bridge';
import { assertHostEnvironment } from './hostEnvironment';

/** Touch phases the host reports, matching the order it dispatches. */
const TOUCH_START = 0;
const TOUCH_MOVE = 1;
const TOUCH_END = 2;

/** The `es_*` primitives a native host binds. Required unless marked optional. */
export interface NativeHostBindings {
    /** A packaged file's bytes, or null when it is not in the package. */
    es_readAsset(path: string): ArrayBuffer | null;
    /** Decode a packaged image to top-first RGBA, or null on failure. */
    es_loadImagePixels(path: string): { width: number; height: number; pixels: ArrayBuffer } | null;
    /** A writable byte store (the host's cache dir). Optional: without it there
     *  is no offline hot-update cache and no persistence for storage. */
    es_readCacheFile?(key: string): ArrayBuffer | null;
    es_writeCacheFile?(key: string, bytes: ArrayBuffer | Uint8Array | string): boolean;
    /** Native key-value store, when the host has one (NSUserDefaults /
     *  SharedPreferences). Absent hosts persist through es_writeCacheFile. */
    es_getStorageItem?(key: string): string | null;
    es_setStorageItem?(key: string, value: string): void;
    es_removeStorageItem?(key: string): void;
    es_storageKeys?(): string[];
    /** Screen scale (1 when the host reports surface pixels directly). */
    es_devicePixelRatio?(): number;
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

    const storage = hostStorage(bindings);

    return {
        readFile: (path) => {
            const bytes = bindings.es_readAsset(path);
            return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`asset not found: ${path}`));
        },
        fileExists: (path) => Promise.resolve(bindings.es_readAsset(path) != null),
        // Networking is the shell's to add (NSURLSession / OkHttp); until then a
        // packaged game is offline and remote groups simply do not resolve.
        fetch: () => Promise.resolve({ ok: false, status: 404 }),
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
    };
}

/** Where storage lands when the host has no native key-value store. */
const STORAGE_FILE = 'estella-storage.json';

/**
 * Key-value storage, best available: the host's own store, else a JSON file in
 * its writable cache dir, else memory for the session. The API is synchronous
 * (localStorage's shape), so the file variant keeps the map in memory and writes
 * through on every mutation — storage holds saves and settings, not bulk data.
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

    const entries = new Map<string, string>();
    const persistent = typeof bindings.es_readCacheFile === 'function'
        && typeof bindings.es_writeCacheFile === 'function';
    if (!persistent) {
        log.warn('native', 'host has no storage or cache bindings — saves last only for this session');
    } else {
        const bytes = bindings.es_readCacheFile!(STORAGE_FILE);
        if (bytes) {
            try {
                for (const [k, v] of Object.entries(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>)) {
                    entries.set(k, v);
                }
            } catch {
                log.warn('native', 'stored data was unreadable — starting empty');
            }
        }
    }
    const flush = (): void => {
        if (!persistent) return;
        // A string, not encoded bytes: the host writes UTF-8 itself, and a native
        // JS engine has no TextEncoder to reach for.
        bindings.es_writeCacheFile!(STORAGE_FILE, JSON.stringify(Object.fromEntries(entries)));
    };
    return {
        getStorageItem: (key) => entries.get(key) ?? null,
        setStorageItem: (key, value) => { entries.set(key, value); flush(); },
        removeStorageItem: (key) => { entries.delete(key); flush(); },
        storageKeys: () => [...entries.keys()],
    };
}
