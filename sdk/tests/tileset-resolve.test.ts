// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { resolveTilesetModel, type ResolvedTileset } from '../src/tilemap/tilesetResolve';
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
        expect(m.slots).toEqual([{ firstId: 1, textureHandle: 100, columns: 4 }]);
        expect(m.collidableTileIds).toEqual([2, 7]);
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
            { firstId: 1, textureHandle: 100, columns: 4 },
            { firstId: 9, textureHandle: 200, columns: 4 },
        ]);
        // A local 2 → global 2; B locals 1,2 → globals 9,10
        expect(m.collidableTileIds).toEqual([2, 9, 10]);
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
