// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { resolveTilesetModel, atlasCells, type ResolvedTileset } from '../src/tilemap/tilesetResolve';
import type { TilesetAsset } from '../src/tilemap/tilesetAsset';

function tileset(over: Partial<TilesetAsset>): TilesetAsset {
    return {
        version: '1', texture: '@uuid:tex', tileWidth: 16, tileHeight: 16,
        columns: 4, margin: 0, spacing: 0, tiles: {}, ...over,
    };
}

describe('resolveTilesetModel', () => {
    it('single tileset → one slot at firstId 1, collidable ids live', () => {
        const rt: ResolvedTileset = {
            textureHandle: 100,
            asset: tileset({
                columns: 4, tileCount: 8,
                tiles: { 2: { collision: { type: 'box' } }, 7: { collision: { type: 'polygon', points: [[0, 16], [16, 16], [0, 0]] } } },
            }),
        };
        const m = resolveTilesetModel([rt]);
        expect(m.slots).toEqual([{ firstId: 1, textureHandle: 100, columns: 4, margin: 0, spacing: 0 }]);
        // box tiles greedy-merge (collidableTileIds); polygon tiles carry their own shape.
        expect(m.collidableTileIds).toEqual([2]);
        expect(m.tileShapes.get(7)?.shape).toEqual({ type: 'polygon', points: [[0, 1], [1, 1], [0, 0]] }); // normalized
        expect(m.animations.size).toBe(0);
    });

    it('two tilesets → contiguous global ids; collision re-keyed to global', () => {
        const a: ResolvedTileset = {
            textureHandle: 100,
            asset: tileset({ columns: 4, tileCount: 8, tiles: { 2: { collision: { type: 'box' } } } }),
        };
        const b: ResolvedTileset = {
            textureHandle: 200,
            asset: tileset({ columns: 4, tileCount: 4, tiles: { 1: { collision: { type: 'box' } }, 2: { collision: { type: 'box' } } } }),
        };
        const m = resolveTilesetModel([a, b]);
        // tileset B starts at firstId 1 + 8 = 9
        expect(m.slots).toEqual([
            { firstId: 1, textureHandle: 100, columns: 4, margin: 0, spacing: 0 },
            { firstId: 9, textureHandle: 200, columns: 4, margin: 0, spacing: 0 },
        ]);
        // A local 2 → global 2; B locals 1,2 → globals 9,10
        expect(m.collidableTileIds).toEqual([2, 9, 10]);
    });

    it('carries the tileset margin/spacing into the render slot', () => {
        const rt: ResolvedTileset = {
            textureHandle: 100,
            asset: tileset({ columns: 4, tileCount: 8, margin: 4, spacing: 8 }),
        };
        const m = resolveTilesetModel([rt]);
        expect(m.slots).toEqual([{ firstId: 1, textureHandle: 100, columns: 4, margin: 4, spacing: 8 }]);
    });

    it('animations re-key both the tile and its frames to global ids', () => {
        const a: ResolvedTileset = { textureHandle: 1, asset: tileset({ tileCount: 8 }) };
        const b: ResolvedTileset = {
            textureHandle: 2,
            asset: tileset({
                columns: 2, tileCount: 4,
                tiles: { 1: { animation: [{ tile: 1, durationMs: 100 }, { tile: 2, durationMs: 150 }] } },
            }),
        };
        const m = resolveTilesetModel([a, b]);
        // B starts at 9 → animated tile global 9, frames global 9 & 10
        expect(m.animations.get(9)).toEqual([
            { tileId: 9, duration: 100 },
            { tileId: 10, duration: 150 },
        ]);
    });

    it('tileCount falls back to the highest authored tile id', () => {
        const a: ResolvedTileset = {
            textureHandle: 1,
            asset: tileset({ columns: 4, tiles: { 3: { collision: { type: 'box' } } } }), // no tileCount
        };
        const b: ResolvedTileset = { textureHandle: 2, asset: tileset({ tileCount: 4, tiles: { 1: { collision: { type: 'box' } } } }) };
        const m = resolveTilesetModel([a, b]);
        // a's count falls back to max id 3 → b starts at firstId 4
        expect(m.slots[1].firstId).toBe(4);
        expect(m.collidableTileIds).toEqual([3, 4]); // a tile 3 → 3; b tile 1 → global 4
    });
});

describe('atlasCells', () => {
    // Every shipped Tiled map, read for the one thing Tiled itself decides: how
    // many columns its atlas has. Only one of them carries a margin, and that is
    // the case a hand-written expectation would most likely get wrong.
    it('agrees with the column count Tiled wrote for every shipped map', () => {
        const maps = [
            '../../fixtures/scenes/tilemap-spacing/map.tmj',
            '../../fixtures/scenes/tilemap-multiset/map.tmj',
            '../../fixtures/scenes/tilemap-gidobj/map.tmj',
            '../../fixtures/scenes/tilemap-hex/map.tmj',
            '../../examples/tilemap-demo/assets/maps/level.tmj',
        ];
        let checked = 0;
        for (const rel of maps) {
            const map = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
            for (const ts of map.tilesets ?? []) {
                if (!ts.imagewidth) continue;
                expect(atlasCells(ts.imagewidth, ts.margin ?? 0, ts.tilewidth, ts.spacing ?? 0))
                    .toBe(ts.columns);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(4);
    });

    it("a Tiled margin borders both sides of the atlas", () => {
        // Three 32px tiles with 2px gaps inside a 4px border span 4+96+4+4 = 108.
        expect(atlasCells(108, 4, 32, 2)).toBe(3);
        // At 104 a third tile would have to eat the far border, so only two fit.
        expect(atlasCells(104, 4, 32, 2)).toBe(2);
    });

    it('answers zero rather than a negative count', () => {
        expect(atlasCells(16, 4096, 32, 0)).toBe(0);
        expect(atlasCells(64, 0, 0, 0)).toBe(0);
    });
});
