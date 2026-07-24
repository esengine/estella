// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The native host contract. A host embeds a bare JS engine and installs
 *        two things: the browser globals its engine lacks, and its own `es_*`
 *        primitives. Both are checked at the seam — a native boot should name
 *        what is missing, not fail later somewhere unrelated.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHostBridge, assertHostEnvironment } from '../src/platform/native';

/** The globals a real host installs (console, timers, clock, decoder). */
function hostGlobals(): Record<string, unknown> {
    return {
        console: { log: () => {}, error: () => {}, warn: () => {} },
        setTimeout: () => 0,
        clearTimeout: () => {},
        performance: { now: () => 0 },
        TextDecoder,
    };
}

function hostScope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...hostGlobals(),
        es_readAsset: () => new ArrayBuffer(4),
        es_loadImagePixels: () => ({ width: 1, height: 1, pixels: new ArrayBuffer(4) }),
        ...overrides,
    };
}

describe('assertHostEnvironment', () => {
    it('names the missing global and what needs it', () => {
        const scope = hostGlobals();
        delete scope.setTimeout;
        expect(() => assertHostEnvironment(scope)).toThrow(/setTimeout\(\).*asset cache/s);
    });

    it('catches a global present but not callable', () => {
        expect(() => assertHostEnvironment({ ...hostGlobals(), performance: {} }))
            .toThrow(/performance\.now\(\)/);
    });

    it('passes on a fully-equipped host', () => {
        expect(() => assertHostEnvironment(hostGlobals())).not.toThrow();
    });
});

describe('createHostBridge', () => {
    it('refuses to build without a required primitive, naming it', () => {
        const scope = hostScope();
        delete scope.es_loadImagePixels;
        expect(() => createHostBridge(scope)).toThrow(/es_loadImagePixels/);
    });

    it('routes host touches to the registered input sink', () => {
        const scope = hostScope();
        const bridge = createHostBridge(scope);
        const sink = { onTouchStart: vi.fn(), onTouchMove: vi.fn(), onTouchEnd: vi.fn(), onTouchCancel: vi.fn() };
        const stop = bridge.registerInput(sink);

        const dispatch = scope.es_onNativeTouch as (t: number, i: number, x: number, y: number) => void;
        dispatch(0, 1, 10, 20);
        dispatch(1, 1, 11, 21);
        dispatch(2, 1, 11, 21);
        expect(sink.onTouchStart).toHaveBeenCalledWith(1, 10, 20);
        expect(sink.onTouchMove).toHaveBeenCalledWith(1, 11, 21);
        expect(sink.onTouchEnd).toHaveBeenCalledWith(1);

        // Unsubscribing must actually detach: a host keeps dispatching regardless.
        stop();
        dispatch(0, 1, 0, 0);
        expect(sink.onTouchStart).toHaveBeenCalledTimes(1);
    });

    it('persists storage through the host cache file', () => {
        const files = new Map<string, string>();
        const scope = hostScope({
            es_readCacheFile: (key: string) => {
                const text = files.get(key);
                return text === undefined ? null : new TextEncoder().encode(text).buffer;
            },
            es_writeCacheFile: (key: string, bytes: string) => { files.set(key, bytes); return true; },
        });

        createHostBridge(scope).setStorageItem('save', '{"level":3}');
        // A fresh bridge (the next launch) reads what the previous one wrote.
        expect(createHostBridge(scope).getStorageItem('save')).toBe('{"level":3}');
    });

    it('degrades to session storage when the host has no cache, without throwing', () => {
        const bridge = createHostBridge(hostScope());
        bridge.setStorageItem('k', 'v');
        expect(bridge.getStorageItem('k')).toBe('v');
        expect(bridge.storageKeys()).toEqual(['k']);
    });

    it('prefers a native key-value store over the file fallback', () => {
        const native = new Map<string, string>([['seen', 'yes']]);
        const bridge = createHostBridge(hostScope({
            es_getStorageItem: (k: string) => native.get(k) ?? null,
            es_setStorageItem: (k: string, v: string) => { native.set(k, v); },
            es_removeStorageItem: (k: string) => { native.delete(k); },
            es_storageKeys: () => [...native.keys()],
        }));
        expect(bridge.getStorageItem('seen')).toBe('yes');
        bridge.setStorageItem('x', '1');
        expect(native.get('x')).toBe('1');
    });
});
