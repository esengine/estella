// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assets-preload.test.ts
 * @brief   Assets.preload contract: explicit ref lists warm the typed caches
 *          with progress, types resolve via catalog → extension fallback, and
 *          undeterminable/failing refs land in `failed` without rejecting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { AssetLoader } from '../src/asset/AssetLoader';

vi.mock('../src/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 42),
        registerExternalTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        acquireTextureByPath: vi.fn(() => 0),
        invalidateTexturePath: vi.fn(() => false),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
    }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

vi.mock('../src/platform', () => ({
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

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024 * 1024),
    GL: null,
    FS: null,
} as never;

const catalogData: CatalogData = {
    version: 1,
    entries: {
        'sprites/hero.png': { type: 'texture' },
        'data/level.custom': { type: 'custom' },
    },
    addresses: {},
    labels: {},
};

describe('Assets.preload', () => {
    let assets: Assets;
    let backend: Backend;
    let customLoads: string[];

    beforeEach(() => {
        customLoads = [];
        backend = {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => 'payload'),
            resolveUrl: (path: string) => `http://test/${path}`,
        } as unknown as Backend;
        assets = Assets.create({
            backend,
            catalog: Catalog.fromJson(catalogData),
            module: mockModule,
        });
        const customLoader: AssetLoader<{ value: string }> = {
            type: 'custom',
            extensions: ['.custom'],
            load: async (path) => {
                customLoads.push(path);
                return { value: path };
            },
            unload: vi.fn(),
        };
        assets.register(customLoader);
    });

    it('warms caches for catalog-typed and extension-inferred refs, with progress', async () => {
        const ticks: Array<[number, number]> = [];
        const { failed } = await assets.preload(
            ['sprites/hero.png', 'data/level.custom', 'data/other.custom'],
            (loaded, total) => ticks.push([loaded, total]),
        );

        expect(failed).toEqual([]);
        // 'data/other.custom' has no catalog entry — its type came from the
        // .custom extension of the registered loader.
        expect(customLoads.sort()).toEqual(['data/level.custom', 'data/other.custom']);
        expect(assets.getTexture('sprites/hero.png')).toBeDefined();
        expect(ticks[0]).toEqual([0, 3]);
        expect(ticks[ticks.length - 1]).toEqual([3, 3]);

        // The eventual real load is a pure cache hit — the loader doesn't re-run.
        await assets.load('custom', 'data/level.custom');
        expect(customLoads.filter(p => p === 'data/level.custom')).toHaveLength(1);
    });

    it('reports refs whose type cannot be determined without rejecting', async () => {
        const { failed } = await assets.preload(['mystery/blob.xyz']);
        expect(failed).toEqual([
            { ref: 'mystery/blob.xyz', reason: 'unresolved' },
        ]);
    });

    it('reports load failures per ref and still completes the rest', async () => {
        const failing: AssetLoader<never> = {
            type: 'broken',
            extensions: ['.broken'],
            load: async () => { throw new Error('boom'); },
            unload: vi.fn(),
        };
        assets.register(failing);

        const { failed } = await assets.preload(['a.broken', 'data/level.custom']);
        expect(customLoads).toEqual(['data/level.custom']);
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ ref: 'a.broken', type: 'broken', reason: 'load-failed', error: 'boom' });
    });
});
