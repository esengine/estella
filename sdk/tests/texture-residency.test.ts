// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    texture-residency.test.ts
 * @brief   Assets ↔ C++ pool residency contract: a released texture stays
 *          revivable by its residency key (no re-decode), hot-reload
 *          invalidation severs that identity, and the SDK holds exactly one
 *          pool reference regardless of how many callers loaded the texture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';

interface PoolEntry {
    refCount: number;
    path: string | null;
    evictable: boolean;
}

/**
 * Stateful stand-in for the C++ ResourcePool texture surface, modelling the
 * held → evictable → evicted lifecycle the SDK glue is written against.
 */
function createPoolFake() {
    const entries = new Map<number, PoolEntry>();
    const byPath = new Map<string, number>();
    let nextHandle = 1;

    const free = (handle: number): void => {
        const e = entries.get(handle);
        if (!e) return;
        if (e.path !== null && byPath.get(e.path) === handle) byPath.delete(e.path);
        entries.delete(handle);
    };

    const rm = {
        budget: 1024 * 1024,
        createTexture: vi.fn((): number => {
            const handle = nextHandle++;
            entries.set(handle, { refCount: 1, path: null, evictable: false });
            return handle;
        }),
        registerExternalTexture: vi.fn((): number => rm.createTexture()),
        registerTextureWithPath: vi.fn((handle: number, path: string): void => {
            const e = entries.get(handle);
            if (!e || e.refCount === 0) return;
            e.path = path;
            byPath.set(path, handle);
        }),
        acquireTextureByPath: vi.fn((path: string): number => {
            const handle = byPath.get(path);
            if (handle === undefined) return 0;
            const e = entries.get(handle)!;
            if (e.evictable) {
                e.evictable = false;
                e.refCount = 1;
            } else {
                e.refCount++;
            }
            return handle;
        }),
        invalidateTexturePath: vi.fn((path: string): boolean => {
            const handle = byPath.get(path);
            if (handle === undefined) return false;
            byPath.delete(path);
            const e = entries.get(handle)!;
            e.path = null;
            if (e.evictable) free(handle);
            return true;
        }),
        releaseTexture: vi.fn((handle: number): void => {
            const e = entries.get(handle);
            if (!e || e.refCount === 0) return;
            if (--e.refCount === 0) {
                if (rm.budget > 0 && e.path !== null) {
                    e.evictable = true;
                } else {
                    free(handle);
                }
            }
        }),
        getTextureDimensions: vi.fn((handle: number) => {
            const e = entries.get(handle);
            if (!e || e.refCount === 0) return null;
            return { width: 64, height: 64 };
        }),
        getTextureGLId: vi.fn(() => 1),
        // Test-only inspection helpers.
        entryOf: (handle: number) => entries.get(handle) ?? null,
        isResident: (handle: number) => entries.has(handle),
    };
    return rm;
}

let pool = createPoolFake();

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

// TextureLoader/imageDecode import the concrete base module (cycle-free); the
// rest go through the barrel — mock both ids with one factory.
const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 256, height: 256,
        getContext: () => ({
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(256 * 256 * 4) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024 * 1024),
    GL: null,
    FS: null,
} as never;

function buildAssets(): Assets {
    const backend: Backend = {
        fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(async () => '{}'),
        resolveUrl: (path: string) => `http://test/${path}`,
    } as unknown as Backend;
    return Assets.create({ backend, module: mockModule });
}

describe('texture residency (Assets ↔ pool contract)', () => {
    beforeEach(() => {
        pool = createPoolFake();
    });

    it('registers the residency key at load time', async () => {
        const assets = buildAssets();
        const result = await assets.loadTexture('tex/a.png');
        expect(pool.registerTextureWithPath).toHaveBeenCalledWith(result.handle, 'tex/a.png:f');
    });

    it('release keeps the texture evictable; the next load revives it without re-decoding', async () => {
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');
        expect(pool.createTexture).toHaveBeenCalledTimes(1);

        assets.releaseTexture('tex/a.png');
        expect(pool.entryOf(first.handle)).toMatchObject({ refCount: 0, evictable: true });
        expect(assets.getTexture('tex/a.png')).toBeUndefined();

        const second = await assets.loadTexture('tex/a.png');
        expect(second.handle).toBe(first.handle);
        expect(second.width).toBe(64);
        expect(pool.createTexture).toHaveBeenCalledTimes(1);  // no second decode+upload
        expect(pool.entryOf(second.handle)).toMatchObject({ refCount: 1, evictable: false });
    });

    it('the SDK holds one pool reference no matter how many callers loaded', async () => {
        const assets = buildAssets();
        const result = await assets.loadTexture('tex/a.png');
        await assets.loadTexture('tex/a.png');
        expect(pool.entryOf(result.handle)?.refCount).toBe(1);

        assets.releaseTexture('tex/a.png');
        expect(pool.releaseTexture).not.toHaveBeenCalled();  // still one SDK ref outstanding
        expect(pool.entryOf(result.handle)?.refCount).toBe(1);

        assets.releaseTexture('tex/a.png');
        expect(pool.releaseTexture).toHaveBeenCalledTimes(1);
        expect(pool.entryOf(result.handle)?.evictable).toBe(true);
    });

    it('invalidate severs the residency identity — an evicted entry is never revived', async () => {
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');
        assets.releaseTexture('tex/a.png');
        expect(pool.entryOf(first.handle)?.evictable).toBe(true);

        assets.invalidate('tex/a.png');
        expect(pool.isResident(first.handle)).toBe(false);  // evictable + invalidated → freed

        const second = await assets.loadTexture('tex/a.png');
        expect(second.handle).not.toBe(first.handle);
        expect(pool.createTexture).toHaveBeenCalledTimes(2);  // fresh bytes, no stale revive
    });

    it('invalidate on a held texture keeps it alive for current holders but blocks future revival', async () => {
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');

        assets.invalidate('tex/a.png');
        expect(pool.isResident(first.handle)).toBe(true);  // old handle keeps rendering

        const second = await assets.loadTexture('tex/a.png');
        expect(second.handle).not.toBe(first.handle);
        expect(pool.createTexture).toHaveBeenCalledTimes(2);
    });

    it('flip variants are distinct residency entries', async () => {
        const assets = buildAssets();
        const flipped = await assets.loadTexture('tex/a.png');
        const raw = await assets.loadTextureRaw('tex/a.png');
        expect(raw.handle).not.toBe(flipped.handle);
        expect(pool.registerTextureWithPath).toHaveBeenCalledWith(flipped.handle, 'tex/a.png:f');
        expect(pool.registerTextureWithPath).toHaveBeenCalledWith(raw.handle, 'tex/a.png:n');
    });

    it('with the budget off, release frees outright and the next load re-decodes', async () => {
        pool.budget = 0;
        const assets = buildAssets();
        const first = await assets.loadTexture('tex/a.png');
        assets.releaseTexture('tex/a.png');
        expect(pool.isResident(first.handle)).toBe(false);

        await assets.loadTexture('tex/a.png');
        expect(pool.createTexture).toHaveBeenCalledTimes(2);
    });
});
