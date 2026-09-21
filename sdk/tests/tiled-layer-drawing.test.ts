// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tiled-layer-drawing.test.ts
 * @brief   What Tiled says about drawing a layer survives into the layer that draws it.
 *
 * @details A layer hidden in Tiled drew in the editor and in every package: the
 *          asset loader copied a layer's tiles and size and left `visible`,
 *          `opacity`, the tint and the parallax behind, so the Tilemap component
 *          had nothing to hand its layers but a cell size.
 */
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { PublishedTilemap } from '../src/tilemap/tilesetCache';
import { tiledLayerComponent } from '../src/tilemap/tiledLoader';

// The tilemap loaders come with the subsystem now, not with the asset
// registry: a package without tilemaps does not carry a tilemap parser.
import { registerTilemapSupport } from '../src/tilemap/tilemapSupport';
registerTilemapSupport();

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: vi.fn(() => false) }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

const PATH = 'assets/maps/level.tmj';

const MAP = JSON.stringify({
    width: 1, height: 1, tilewidth: 16, tileheight: 12, tilesets: [],
    layers: [
        { type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [0] },
        {
            type: 'tilelayer', name: 'water', width: 1, height: 1, data: [0],
            visible: false, opacity: 0.5, tintcolor: '#ff8000', parallaxx: 0.25, parallaxy: 0.75,
        },
    ],
});

async function loadedLayers() {
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(0)),
            fetchText: vi.fn(async () => MAP),
            resolveUrl: (p: string) => p,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: null as never,
    });
    await assets.acquireTyped('tilemap', PATH);
    return assets.resolveRegistryAsset<PublishedTilemap>('tilemap', PATH)!.source.layers;
}

describe('a Tiled layer draws the way Tiled says', () => {
    it('keeps what the map says about drawing each layer through the asset load', async () => {
        const [ground, water] = await loadedLayers();
        expect(ground.visible).toBe(true);
        expect(water.visible).toBe(false);
        expect(water.opacity).toBe(0.5);
        expect(water.parallaxX).toBe(0.25);
        expect(water.parallaxY).toBe(0.75);
        expect(water.tintColor.r).toBeCloseTo(1);
        expect(water.tintColor.g).toBeCloseTo(128 / 255);
    });

    it('hands the layer component all of it', async () => {
        const [, water] = await loadedLayers();
        expect(tiledLayerComponent(water, 16, 12, 1)).toEqual({
            cellSize: { x: 16, y: 12 },
            renderLayer: 1,
            visible: false,
            opacity: 0.5,
            tintColor: water.tintColor,
            parallaxFactor: { x: 0.25, y: 0.75 },
        });
    });
});
