// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilemap-source-invalidate.test.ts
 * @brief   A `.tmj` changed on disk: the realm publishes a new era, and the
 *          sync notices because the object it derived from is not the one the
 *          lookup answers with any more.
 *
 * @details The tilemap sync re-derives on IDENTITY (`sourceDerivedFrom_ !==
 *          cached`), so a hot reload that mutated a cached record in place
 *          would leave every derived layer as it was.
 */
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { PublishedTilemap } from '../src/tilemap/tilesetCache';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: vi.fn(() => false) }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const PATH = 'assets/maps/level.tmj';

/** A map whose one property carries the era, so a lookup can say which it is. */
const mapDocument = (tileWidth: number): string => JSON.stringify({
    width: 1, height: 1, tilewidth: tileWidth, tileheight: 16,
    tilesets: [], layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [0] }],
});

function realm(doc: () => string): Assets {
    return Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(0)),
            fetchText: vi.fn(async () => doc()),
            resolveUrl: (p: string) => p,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: null as never,
    });
}

describe('a tilemap source is its realm\'s, and a reload is a new era', () => {
    it('publishes for the ref, and takes it back when the last holder goes', async () => {
        const assets = realm(() => mapDocument(16));
        const held = await assets.acquireTyped('tilemap', PATH);

        expect(assets.resolveRegistryAsset<PublishedTilemap>('tilemap', PATH)?.source.tileWidth).toBe(16);
        held.release();
        expect(assets.resolveRegistryAsset('tilemap', PATH), 'the module cache never released one').toBeUndefined();
    });

    it('a reload publishes a NEW object — the identity the sync re-derives on', async () => {
        let width = 16;
        const assets = realm(() => mapDocument(width));
        await assets.acquireTyped('tilemap', PATH);
        const before = assets.resolveRegistryAsset<PublishedTilemap>('tilemap', PATH)!.source;

        width = 32;
        assets.invalidate(PATH);
        await new Promise((r) => setTimeout(r, 0));

        const after = assets.resolveRegistryAsset<PublishedTilemap>('tilemap', PATH)!.source;
        expect(after.tileWidth).toBe(32);
        expect(after, 'the sync only re-derives when the object changes').not.toBe(before);
    });

    it('two realms hold their own map of the same name', async () => {
        const a = realm(() => mapDocument(16));
        const b = realm(() => mapDocument(32));
        await a.acquireTyped('tilemap', PATH);
        await b.acquireTyped('tilemap', PATH);

        expect(a.resolveRegistryAsset<PublishedTilemap>('tilemap', PATH)?.source.tileWidth).toBe(16);
        expect(b.resolveRegistryAsset<PublishedTilemap>('tilemap', PATH)?.source.tileWidth).toBe(32);
    });
});
