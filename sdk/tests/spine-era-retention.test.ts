// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-era-retention.test.ts
 * @brief   A native skeleton keeps the era it was parsed from alive.
 *
 * @details Everything else about spine ownership is now structural; this was
 *          still a protocol — "tear the entities down before the scene gives its
 *          assets back". A residency that holds a claim on its own era needs no
 *          such rule: the scene gives back the receipt IT took, and the pages
 *          the runtime is posing are held by the runtime's.
 *
 *          One claim per RESIDENCY, not per entity: the refcount already knows
 *          when the native skeleton is no longer needed, and a claim per entity
 *          would model that lifetime twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { AssetScope } from '../src/asset/AssetLease';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { spineEraOf, type SpineAssetValue, type SpineEraBinding } from '../src/spine/prepareSpine';
import { fakeSpineModule } from './helpers/fakeSpineModule';

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

const SKEL = 'spine/hero.skel';
const ATLAS = 'spine/hero.atlas';
const atlasNaming = (page: string) => `${page}\nsize: 4,4\nformat: RGBA8888\n`;

function realm(docs: Record<string, string>): Assets {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
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

/** One acquired era, as a scene would hold it, plus what the runtime is given. */
async function acquired(assets: Assets, scope: AssetScope): Promise<SpineEraBinding> {
    const lease = await assets.acquireSpine(SKEL, ATLAS);
    scope.add(lease);
    return spineEraOf({ skeleton: SKEL, atlas: ATLAS }, lease as never);
}

/** The binding, with its retains and releases counted (and ordered). */
function counted(era: SpineEraBinding) {
    const claims = { retained: 0, released: 0, release: vi.fn() };
    return {
        claims,
        era: {
            id: era.id,
            pair: era.pair,
            value: era.value,
            retain: () => {
                claims.retained++;
                const claim = era.retain();
                return claim && {
                    release: () => { claims.released++; claims.release(); claim.release(); },
                };
            },
        } as SpineEraBinding,
    };
}

describe('a native skeleton keeps the era it was parsed from', () => {
    beforeEach(() => { pool = createPoolFake(); });

    it('the scene giving its receipt back does not take the page being posed', async () => {
        // The protocol this replaces: "despawn the spine entities before the
        // scene releases its assets". Ownership does not take an order of
        // operations to be right.
        const assets = realm({ 'hero.atlas': atlasNaming('hero.png') });
        const scene = new AssetScope();
        const era = await acquired(assets, scene);
        const native = fakeSpineModule();
        const runtime = new SpineRuntime('4.2', native.module);
        expect(runtime.loadEntity(1 as Entity, era)).toBe(true);
        expect(pool.liveTextures()).toBe(1);

        scene.releaseAll();

        expect(pool.liveTextures(), 'the page the runtime is still posing').toBe(1);
        expect(native.skeletons).toHaveLength(1);

        runtime.removeEntity(1 as Entity);
        expect(pool.liveTextures(), 'nothing holds it now').toBe(0);
    });

    it('one claim per residency, however many entities share it', async () => {
        const assets = realm({ 'hero.atlas': atlasNaming('hero.png') });
        const scene = new AssetScope();
        const { era, claims } = counted(await acquired(assets, scene));
        const native = fakeSpineModule();
        const runtime = new SpineRuntime('4.2', native.module);

        runtime.loadEntity(1 as Entity, era);
        runtime.loadEntity(2 as Entity, era);
        expect(claims.retained, 'a claim per entity models the residency twice').toBe(1);
        expect(native.skeletons).toHaveLength(1);

        scene.releaseAll();
        runtime.removeEntity(1 as Entity);
        expect(claims.released, 'released while an entity still poses it').toBe(0);
        expect(pool.liveTextures()).toBe(1);

        runtime.removeEntity(2 as Entity);
        expect(claims.released).toBe(1);
        expect(pool.liveTextures()).toBe(0);
        // In the order it is owned: the native object, then what it was made of.
        expect(claims.release.mock.invocationCallOrder[0],
               'the era went back before the skeleton parsed from it')
            .toBeGreaterThan(native.unloadSkeleton.mock.invocationCallOrder[0]);
    });

    it('two eras of one pair are held apart, by their own residencies', async () => {
        // A hot update mid-scene: one entity stays on what it is posing, the
        // next binds the new era. Neither claim is the other's.
        const docs = { 'hero.atlas': atlasNaming('summer.png') };
        const assets = realm(docs);
        const scene = new AssetScope();
        const old = await acquired(assets, scene);
        const native = fakeSpineModule();
        const runtime = new SpineRuntime('4.2', native.module);
        runtime.loadEntity(1 as Entity, old);

        docs['hero.atlas'] = atlasNaming('winter.png');
        assets.invalidate(ATLAS);
        for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
        const fresh = await acquired(assets, scene);
        expect(fresh.id, 'the update produced no new era').not.toBe(old.id);
        runtime.loadEntity(2 as Entity, fresh);

        scene.releaseAll();
        expect(pool.liveTextures(), 'a page from each era').toBe(2);

        runtime.removeEntity(1 as Entity);
        expect(pool.liveTextures(), 'the era the other entity is on went too').toBe(1);
        runtime.removeEntity(2 as Entity);
        expect(pool.liveTextures()).toBe(0);
    });

    it('a candidate that will not parse leaves no claim behind', async () => {
        const assets = realm({ 'hero.atlas': atlasNaming('hero.png') });
        const scene = new AssetScope();
        const { era, claims } = counted(await acquired(assets, scene));
        const native = fakeSpineModule();
        const runtime = new SpineRuntime('4.2', native.module);

        native.parses = false;
        expect(runtime.loadEntity(1 as Entity, era)).toBe(false);

        expect(claims.retained - claims.released, 'a claim outlived the failed candidate').toBe(0);
        expect(native.skeletons).toEqual([]);
        scene.releaseAll();
        expect(pool.liveTextures()).toBe(0);
    });

    it('disposing a runtime gives back every claim exactly once', async () => {
        const assets = realm({ 'hero.atlas': atlasNaming('hero.png') });
        const scene = new AssetScope();
        const { era, claims } = counted(await acquired(assets, scene));
        const native = fakeSpineModule();
        const runtime = new SpineRuntime('4.2', native.module);
        runtime.loadEntity(1 as Entity, era);
        runtime.loadEntity(2 as Entity, era);

        scene.releaseAll();
        runtime.dispose();

        expect(claims.released).toBe(1);
        expect(native.skeletons).toEqual([]);
        expect(native.instances).toEqual([]);
        expect(pool.liveTextures()).toBe(0);
    });
});
