// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native PlatformAdapter driven headlessly by a mock NativeBridge — proves the
// host-bridge contract holds (fs / fetch / wasm / image-pixels / storage / input /
// identity) with no device, plus fills the platform-layer test gap that the
// DOM-free surface refactor uncovered (detectPlatform, mini-game canvas/image with
// the `as unknown` casts removed, node canvas/image fail loud).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    NativePlatformAdapter,
    installNativePlatform,
    type NativeBridge,
    type NativeInputListener,
} from '../src/platform/native';
import { getPlatformType, isNative, platformLanguage } from '../src/platform';
import { detectPlatform } from '../src/platform/types';
import type { InputEventCallbacks } from '../src/platform/types';

function makeBridge() {
    const store = new Map<string, string>();
    const cacheStore = new Map<string, ArrayBuffer>();
    const files = new Map<string, ArrayBuffer>([
        ['data/config.json', new TextEncoder().encode('{"a":1}').buffer as ArrayBuffer],
    ]);
    const listeners: NativeInputListener[] = [];
    const bridge: NativeBridge = {
        readFile: async (p) => {
            const b = files.get(p);
            if (!b) throw new Error('ENOENT ' + p);
            return b;
        },
        fileExists: async (p) => files.has(p),
        fetch: async () => ({ ok: true, status: 200, statusText: 'OK', text: '{"ok":true}' }),
        loadImagePixels: async () => ({ width: 2, height: 2, pixels: new Uint8Array(16).fill(255) }),
        getStorageItem: (k) => store.get(k) ?? null,
        setStorageItem: (k, v) => { store.set(k, v); },
        removeStorageItem: (k) => { store.delete(k); },
        storageKeys: () => [...store.keys()],
        readCacheFile: async (k) => cacheStore.get(k) ?? null,
        writeCacheFile: async (k, b) => { cacheStore.set(k, b); },
        registerInput: (l) => {
            listeners.push(l);
            return () => {
                const i = listeners.indexOf(l);
                if (i >= 0) listeners.splice(i, 1);
            };
        },
        devicePixelRatio: () => 3,
        now: () => 12345,
        language: () => 'zh_CN',
    };
    return { bridge, store, cacheStore, files, listeners };
}

function makeInputCallbacks(): InputEventCallbacks {
    return {
        onKeyDown: vi.fn(),
        onKeyUp: vi.fn(),
        onPointerMove: vi.fn(),
        onPointerDown: vi.fn(),
        onPointerUp: vi.fn(),
        onWheel: vi.fn(),
        onTouchStart: vi.fn(),
        onTouchMove: vi.fn(),
        onTouchEnd: vi.fn(),
        onTouchCancel: vi.fn(),
    };
}

describe('NativePlatformAdapter (mock bridge)', () => {
    let env: ReturnType<typeof makeBridge>;
    let adapter: NativePlatformAdapter;

    beforeEach(() => {
        env = makeBridge();
        adapter = installNativePlatform(env.bridge);
    });

    it('installs as a first-class native platform identity', () => {
        expect(adapter.name).toBe('native');
        expect(getPlatformType()).toBe('native');
        expect(isNative()).toBe(true);
    });

    it('reads packaged files as bytes and text', async () => {
        expect(await adapter.fileExists('data/config.json')).toBe(true);
        expect(await adapter.fileExists('nope')).toBe(false);
        expect(new TextDecoder().decode(await adapter.readFile('data/config.json'))).toBe('{"a":1}');
        expect(await adapter.readTextFile('data/config.json')).toBe('{"a":1}');
        await expect(adapter.readFile('nope')).rejects.toThrow();
    });

    it('wraps the bridge fetch into a PlatformResponse', async () => {
        const res = await adapter.fetch('https://cdn/x.json');
        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('{"ok":true}');
        expect(await res.json()).toEqual({ ok: true });
    });

    it('decodes image pixels through the bridge (Path 2)', async () => {
        const img = await adapter.loadImagePixels('art/hero.png');
        expect(img.width).toBe(2);
        expect(img.height).toBe(2);
        expect(img.pixels.length).toBe(16);
        expect(img.pixels[0]).toBe(255);
    });

    it('instantiates wasm via the host JS engine WebAssembly (no bridge call)', async () => {
        // Minimal valid module: magic + version header.
        const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;
        const result = await adapter.instantiateWasm(bytes, {});
        expect(result.instance).toBeDefined();
        expect(result.module).toBeDefined();
    });

    it('round-trips storage and clears by prefix', () => {
        adapter.setStorageItem('esengine:a', '1');
        adapter.setStorageItem('esengine:b', '2');
        adapter.setStorageItem('other:c', '3');
        expect(adapter.getStorageItem('esengine:a')).toBe('1');
        adapter.removeStorageItem('esengine:a');
        expect(adapter.getStorageItem('esengine:a')).toBeNull();

        adapter.clearStorage('esengine:');
        expect(adapter.getStorageItem('esengine:b')).toBeNull();
        expect(adapter.getStorageItem('other:c')).toBe('3'); // untouched
    });

    it('reports clock, DPR and normalized language', () => {
        expect(adapter.now()).toBe(12345);
        expect(adapter.devicePixelRatio()).toBe(3);
        // base.platformLanguage() normalizes the bridge's underscore tag.
        expect(platformLanguage()).toBe('zh-CN');
    });

    it('dispatches pushed native input, synthesizing the primary pointer', () => {
        const cb = makeInputCallbacks();
        adapter.bindInputEvents(cb);
        expect(env.listeners.length).toBe(1);
        const sink = env.listeners[0];

        sink.onTouchStart(1, 10, 20);
        expect(cb.onTouchStart).toHaveBeenCalledWith(1, 10, 20);
        expect(cb.onPointerDown).toHaveBeenCalledWith(0, 10, 20);

        sink.onTouchMove(1, 30, 40);
        expect(cb.onPointerMove).toHaveBeenCalledWith(30, 40);

        sink.onTouchEnd(1);
        expect(cb.onPointerUp).toHaveBeenCalledWith(0);

        sink.onKeyDown?.('KeyA');
        expect(cb.onKeyDown).toHaveBeenCalledWith('KeyA');

        adapter.unbindInputEvents();
        expect(env.listeners.length).toBe(0);
    });

    it('fails loud on the offscreen DOM surfaces (native uses loadImagePixels)', () => {
        expect(() => adapter.createCanvas(1, 1)).toThrow(/native/);
        expect(() => adapter.createImage()).toThrow(/native/);
    });

    it('round-trips the offline content cache through the bridge', async () => {
        expect(await adapter.readCacheFile('https://cdn/a.png')).toBeNull();
        await adapter.writeCacheFile('https://cdn/a.png', new Uint8Array([1, 2, 3]).buffer);
        const got = await adapter.readCacheFile('https://cdn/a.png');
        expect(new Uint8Array(got!)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('degrades to no-cache when the bridge omits cache methods', async () => {
        const bare = makeBridge().bridge as Partial<NativeBridge>;
        delete bare.readCacheFile;
        delete bare.writeCacheFile;
        const a = new NativePlatformAdapter(bare as NativeBridge);
        expect(await a.readCacheFile('x')).toBeNull();
        await expect(a.writeCacheFile('x', new ArrayBuffer(1))).resolves.toBeUndefined();
    });
});

describe('detectPlatform()', () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).tt;
        delete (globalThis as Record<string, unknown>).wx;
    });

    it('is web with no vendor global', () => {
        expect(detectPlatform()).toBe('web');
    });

    it('is douyin when tt is present', () => {
        (globalThis as Record<string, unknown>).tt = { getSystemInfoSync: () => ({}) };
        expect(detectPlatform()).toBe('douyin');
    });

    it('is wechat when wx is present (and tt is not)', () => {
        (globalThis as Record<string, unknown>).wx = { getSystemInfoSync: () => ({}) };
        expect(detectPlatform()).toBe('wechat');
    });
});

describe('MiniGamePlatformAdapter surfaces (casts removed)', () => {
    it('returns a sized canvas and image from the host global', async () => {
        const { MiniGamePlatformAdapter } = await import('../src/platform/minigame/adapter');
        const g = {
            createCanvas: () => ({ width: 0, height: 0, getContext: () => null }),
            createImage: () => ({ width: 5, height: 7, src: '', onload: null, onerror: null }),
        };
        const profile = {
            id: 'wechat',
            hostLabel: 'WeChat',
            global: g,
            instantiateWasm: vi.fn(),
            createAudioBackend: vi.fn(),
            createVideoBackend: vi.fn(),
            createSocket: vi.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = new MiniGamePlatformAdapter(profile as any);
        expect(a.name).toBe('wechat');
        const c = a.createCanvas(10, 20);
        expect(c.width).toBe(10);
        expect(c.height).toBe(20);
        const img = a.createImage();
        expect(img.width).toBe(5);
        expect(img.height).toBe(7);
    });
});

describe('node adapter surfaces (fail loud, no render host)', () => {
    it('throws for canvas/image and rejects image decode', async () => {
        const { nodeAdapter } = await import('../src/platform/node');
        expect(() => nodeAdapter.createCanvas(1, 1)).toThrow();
        expect(() => nodeAdapter.createImage()).toThrow();
        await expect(nodeAdapter.loadImagePixels('x.png')).rejects.toThrow();
    });
});

describe('esengine/native entry', () => {
    // These two transform the WHOLE native entry graph (core + webAppFactory +
    // every re-export) on first import — several seconds cold, and slower still
    // under the full suite's parallel load. Give them room past the 5s default so
    // they measure re-export wiring, not machine contention.
    it('re-exports the native surface + the core SDK', async () => {
        const native = await import('../src/index.native');
        expect(typeof native.installNativePlatform).toBe('function');
        expect(typeof native.NativePlatformAdapter).toBe('function');
        // Core + webAppFactory are re-exported so a shell imports everything from here.
        expect(typeof native.createWebApp).toBe('function');
        expect(typeof native.createHeadlessApp).toBe('function');
        expect(typeof native.App).toBe('function');
    }, 30000);

    it('installNativePlatform from the entry activates the native platform', async () => {
        const native = await import('../src/index.native');
        native.installNativePlatform(makeBridge().bridge);
        const { getPlatformType, isNative } = await import('../src/platform');
        expect(getPlatformType()).toBe('native');
        expect(isNative()).toBe(true);
    }, 30000);
});
