// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The persistent content-addressed disk cache behind offline hot-update: the http
// backend serves cached (content-addressed, immutable) assets without the network,
// the node adapter backs it with a real filesystem, and both cache wrappers degrade
// to "no cache" on a platform (web) that omits the methods.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { HttpBackend } from '../src/asset/Backend';
import { setPlatform, platformReadCacheFile, platformWriteCacheFile } from '../src/platform/base';
import type { PlatformAdapter, PlatformResponse } from '../src/platform/types';
import { nodeAdapter } from '../src/platform/node';

function mockPlatform(over: Partial<PlatformAdapter>): PlatformAdapter {
    return {
        name: 'web',
        fetch: vi.fn(),
        readFile: vi.fn(), readTextFile: vi.fn(), fileExists: vi.fn(),
        loadImagePixels: vi.fn(), instantiateWasm: vi.fn(),
        createCanvas: vi.fn(), createImage: vi.fn(), now: () => 0,
        bindInputEvents: vi.fn(), createAudioBackend: vi.fn(),
        devicePixelRatio: () => 1,
        getStorageItem: () => null, setStorageItem: vi.fn(),
        removeStorageItem: vi.fn(), clearStorage: vi.fn(),
        ...over,
    } as unknown as PlatformAdapter;
}

function okResponse(bytes: ArrayBuffer): PlatformResponse {
    return {
        ok: true, status: 200, statusText: 'OK', headers: {},
        json: async () => ({}), text: async () => '', arrayBuffer: async () => bytes,
    };
}

describe('HttpBackend content cache (offline hot-update store)', () => {
    it('serves a cached http asset without touching the network (offline)', async () => {
        const cached = new Uint8Array([1, 2, 3, 4]).buffer;
        const fetch = vi.fn(() => { throw new Error('offline'); });
        setPlatform(mockPlatform({ fetch: fetch as never, readCacheFile: async () => cached }));

        const got = await new HttpBackend({ baseUrl: '' }).fetchBinary('https://cdn/assets/abcd.png');

        expect(new Uint8Array(got)).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(fetch).not.toHaveBeenCalled(); // cache hit ⇒ no network
    });

    it('falls through to the network on a cache miss', async () => {
        const net = new Uint8Array([9, 9]).buffer;
        const fetch = vi.fn(async () => okResponse(net));
        setPlatform(mockPlatform({ fetch: fetch as never, readCacheFile: async () => null }));

        const got = await new HttpBackend({ baseUrl: '' }).fetchBinary('https://cdn/assets/x.png');

        expect(new Uint8Array(got)).toEqual(new Uint8Array([9, 9]));
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('never consults the cache for non-http (local/same-origin) paths', async () => {
        const net = new Uint8Array([7]).buffer;
        const readCacheFile = vi.fn(async () => new Uint8Array([0]).buffer);
        const fetch = vi.fn(async () => okResponse(net));
        setPlatform(mockPlatform({ fetch: fetch as never, readCacheFile }));

        const got = await new HttpBackend({ baseUrl: '' }).fetchBinary('estella://project/a.png');

        expect(new Uint8Array(got)).toEqual(new Uint8Array([7]));
        expect(readCacheFile).not.toHaveBeenCalled(); // local path bypasses the cache
    });
});

describe('node adapter disk cache (real filesystem)', () => {
    const dir = join(tmpdir(), `esengine-cache-test-${process.pid}`);
    beforeEach(() => { process.env.ESENGINE_CACHE_DIR = dir; });
    afterEach(async () => {
        delete process.env.ESENGINE_CACHE_DIR;
        await rm(dir, { recursive: true, force: true });
    });

    it('round-trips bytes through the filesystem, misses on an absent key', async () => {
        const key = 'https://cdn/assets/deadbeef.png';
        expect(await nodeAdapter.readCacheFile(key)).toBeNull(); // empty cache

        await nodeAdapter.writeCacheFile(key, new Uint8Array([5, 6, 7, 8, 9]).buffer);
        const got = await nodeAdapter.readCacheFile(key);

        expect(got).not.toBeNull();
        expect(new Uint8Array(got!)).toEqual(new Uint8Array([5, 6, 7, 8, 9]));
        expect(await nodeAdapter.readCacheFile('https://cdn/assets/other.png')).toBeNull();
    });

    it('end-to-end: HttpBackend serves an updated asset from the real disk cache OFFLINE', async () => {
        const url = 'https://cdn/v2/assets/cafebabe.png';
        const bytes = new Uint8Array([10, 20, 30, 40]).buffer;
        // Platform: real node fs cache (temp dir above) + a fetch that always fails (offline).
        const offlineFetch = vi.fn(() => { throw new Error('offline'); });
        setPlatform(mockPlatform({
            fetch: offlineFetch as never,
            readCacheFile: (k) => nodeAdapter.readCacheFile(k),
            writeCacheFile: (k, b) => nodeAdapter.writeCacheFile(k, b),
        }));

        // "applyUpdate" persisted the verified bytes to disk while online…
        await platformWriteCacheFile(url, bytes);
        // …now, offline, the http backend loads them straight off disk (no network).
        const got = await new HttpBackend({ baseUrl: '' }).fetchBinary(url);

        expect(new Uint8Array(got)).toEqual(new Uint8Array([10, 20, 30, 40]));
        expect(offlineFetch).not.toHaveBeenCalled();
    });
});

describe('cache wrappers degrade on a platform with no cache (web)', () => {
    it('read returns null and write no-ops when the adapter omits the methods', async () => {
        setPlatform(mockPlatform({})); // no readCacheFile / writeCacheFile
        expect(await platformReadCacheFile('k')).toBeNull();
        await expect(platformWriteCacheFile('k', new ArrayBuffer(2))).resolves.toBeUndefined();
    });
});
