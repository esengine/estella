// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-asset-generation.test.ts
 * @brief   Spine is an asset like any other: a preparation that reads two
 *          documents and holds the pages it took.
 *
 * @details What it produces is data — the two documents and the pages it took —
 *          and its era owns the receipts. The native skeleton is a runtime
 *          backend's, built from this. So every rule the asset layer already
 *          follows applies to spine unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';

function createPoolFake() {
    const live = new Set<number>();
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        createTextureFromBytes: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn((handle: number) => { live.delete(handle); }),
        getTextureDimensions: vi.fn(() => ({ width: 4, height: 4 })),
        getTextureGLId: vi.fn((handle: number) => handle + 1000),
        setTextureMetadata: vi.fn(),
        liveTextures: () => live.size,
    };
}
let pool = createPoolFake();
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 4, height: 4,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 4; img.height = 4; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(), platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(), platformFileExists: vi.fn(),
    platformLoadSubpackage: vi.fn(async () => {}),
    platformGetStorageItem: () => null, platformSetStorageItem: vi.fn(),
    platformWriteCacheFile: vi.fn(async () => {}),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

/** An atlas naming one page, in the shape a spine export writes. */
const ATLAS = 'hero.png\nsize: 4,4\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n';
const OTHER_ATLAS = 'winter.png\nsize: 4,4\nformat: RGBA8888\n';

function realm(docs: Record<string, string>, fail?: (url: string) => boolean): Assets {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async (url: string) => {
                if (fail?.(url)) throw new Error(`no bytes at ${url}`);
                return new ArrayBuffer(8);
            }),
            fetchText: vi.fn(async (url: string) => {
                const key = Object.keys(docs).find((k) => url.endsWith(k));
                return key ? docs[key] : '{}';
            }),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
    assets.getTextureLoader().setPixelDecoder(async () => ({
        width: 4, height: 4, pixels: new Uint8Array(64),
    }));
    return assets;
}

describe('a spine asset is a preparation', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('the atlas pages are the era\'s, and go back with it', async () => {
        const assets = realm({ 'hero.atlas': ATLAS });
        const held = await assets.acquireSpine('spine/hero.skel', 'spine/hero.atlas');

        expect(held.value.textures.size, 'the page the atlas names').toBe(1);
        expect(pool.liveTextures()).toBe(1);

        held.release();
        expect(pool.liveTextures(), 'the page the preparation took').toBe(0);
    });

    it('the documents it read are source edges, the page an owned one', async () => {
        const assets = realm({ 'hero.atlas': ATLAS });
        await assets.acquireSpine('spine/hero.skel', 'spine/hero.atlas');

        const edges = assets.dependenciesOf('spine', 'spine/hero.skel:spine/hero.atlas');
        expect(edges).toContainEqual({ kind: 'source', path: 'spine/hero.atlas' });
        expect(edges).toContainEqual({ kind: 'owned', type: 'texture', path: 'spine/hero.png' });
    });

    it('a preparation that fails keeps no page', async () => {
        // The pages are taken BEFORE the skeleton document is read, so a
        // failure there is the window where they have no owner yet.
        const assets = realm({ 'hero.atlas': ATLAS }, (url) => url.endsWith('.skel'));

        await expect(assets.acquireSpine('spine/hero.skel', 'spine/hero.atlas'))
            .rejects.toThrow(/no bytes/);

        expect(pool.liveTextures(), 'the pages the failed preparation took').toBe(0);
    });

    it('the same skeleton with another atlas is another asset', async () => {
        // The pair is the identity: a component authors both fields, so a scene
        // can say so, and one era for both would draw the wrong pages.
        const assets = realm({ 'hero.atlas': ATLAS, 'winter.atlas': OTHER_ATLAS });

        const summer = await assets.acquireSpine('spine/hero.skel', 'spine/hero.atlas');
        const winter = await assets.acquireSpine('spine/hero.skel', 'spine/winter.atlas');

        expect([...summer.value.textures.keys()]).toEqual(['hero.png']);
        expect([...winter.value.textures.keys()]).toEqual(['winter.png']);
        expect(pool.liveTextures(), 'one page each').toBe(2);
    });

    it('two holders of one pair share the era', async () => {
        const assets = realm({ 'hero.atlas': ATLAS });
        const first = await assets.acquireSpine('spine/hero.skel', 'spine/hero.atlas');
        const second = await assets.acquireSpine('spine/hero.skel', 'spine/hero.atlas');

        expect(pool.liveTextures(), 'the page was uploaded twice').toBe(1);
        expect(second.generation, 'two eras for one unchanged pair').toBe(first.generation);

        first.release();
        expect(pool.liveTextures(), 'released while a holder was still using it').toBe(1);
        second.release();
        expect(pool.liveTextures()).toBe(0);
    });
});
