// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseTileset, serializeTileset, type TilesetAsset } from '../src/tilemap/tilesetAsset';
import {
    TB_N, TB_E, TB_S, TB_W, TB_NE, TB_SE, TB_SW, TB_NW, TERRAIN_NEIGHBORS,
    normalizeCornerMask, buildTerrainIndices, resolveAutotile,
} from '../src/tilemap/autotile';

describe('tileset terrain round-trip', () => {
    it('parses and serializes terrains + per-tile terrain', () => {
        const raw = {
            version: '1', texture: '@uuid:x', tileWidth: 16, tileHeight: 16, columns: 4,
            margin: 0, spacing: 0,
            terrains: [{ name: 'Grass', mode: 'corner', color: '#3a3' }, { name: 'Dirt', mode: 'edge' }],
            tiles: {
                5: { terrain: { set: 0, mask: TB_N | TB_E } },
                6: { collision: { type: 'box' }, terrain: { set: 1, mask: TB_S } },
            },
        };
        const a = parseTileset(raw);
        expect(a.terrains).toHaveLength(2);
        expect(a.terrains?.[0]).toEqual({ name: 'Grass', mode: 'corner', color: '#3a3' });
        expect(a.terrains?.[1].mode).toBe('edge');
        expect(a.tiles[5].terrain).toEqual({ set: 0, mask: TB_N | TB_E });
        expect(a.tiles[6].terrain).toEqual({ set: 1, mask: TB_S });
        // round-trips
        expect(parseTileset(serializeTileset(a))).toEqual(a);
    });

    it('drops invalid terrain entries and unknown modes default to edge', () => {
        const a = parseTileset({
            tiles: { 1: { terrain: { set: -1, mask: 2 } }, 2: { terrain: { set: 0, mask: 1 } } },
            terrains: [{ name: 'X', mode: 'weird' }, { notName: true }],
        });
        expect(a.tiles[1]?.terrain).toBeUndefined(); // set < 0 rejected
        expect(a.tiles[2]?.terrain).toEqual({ set: 0, mask: 1 });
        expect(a.terrains).toHaveLength(1);
        expect(a.terrains?.[0]).toEqual({ name: 'X', mode: 'edge' });
    });
});

describe('corner (blob) mask normalization', () => {
    it('keeps a corner only when both adjacent sides peer', () => {
        // NE present but missing N → NE dropped.
        expect(normalizeCornerMask(TB_NE | TB_E)).toBe(TB_E);
        // NE present with both N and E → kept.
        expect(normalizeCornerMask(TB_NE | TB_N | TB_E)).toBe(TB_NE | TB_N | TB_E);
        // all sides + all corners → full mask kept.
        const full = TB_N | TB_E | TB_S | TB_W | TB_NE | TB_SE | TB_SW | TB_NW;
        expect(normalizeCornerMask(full)).toBe(full);
    });
});

function neighborsFromMask(mask: number): boolean[] {
    return TERRAIN_NEIGHBORS.map((n) => (mask & n.bit) !== 0);
}

describe('resolveAutotile', () => {
    it('edge mode: each of the 16 side combos resolves to its own tile', () => {
        const tiles: TilesetAsset['tiles'] = {};
        for (let m = 0; m < 16; m++) tiles[m + 1] = { terrain: { set: 0, mask: m } };
        const asset = parseTileset({
            tiles, terrains: [{ name: 'G', mode: 'edge' }],
        });
        const idx = buildTerrainIndices(asset).sets.get(0)!;
        for (let m = 0; m < 16; m++) {
            expect(resolveAutotile(idx, neighborsFromMask(m))).toBe(m + 1);
        }
    });

    it('edge mode: corner-only neighbours are ignored (masked to sides)', () => {
        const asset = parseTileset({
            tiles: { 1: { terrain: { set: 0, mask: 0 } } }, terrains: [{ name: 'G', mode: 'edge' }],
        });
        const idx = buildTerrainIndices(asset).sets.get(0)!;
        // only NE/SW peer → no side bits → resolves to the mask-0 tile.
        expect(resolveAutotile(idx, neighborsFromMask(TB_NE | TB_SW))).toBe(1);
    });

    it('falls back to the nearest mask by Hamming distance when no exact match', () => {
        const asset = parseTileset({
            tiles: {
                1: { terrain: { set: 0, mask: 0 } },
                2: { terrain: { set: 0, mask: TB_N | TB_E | TB_S | TB_W } },
            },
            terrains: [{ name: 'G', mode: 'edge' }],
        });
        const idx = buildTerrainIndices(asset).sets.get(0)!;
        // N|E|S (3 bits) is closer to the full 4-bit tile than to the empty tile.
        expect(resolveAutotile(idx, neighborsFromMask(TB_N | TB_E | TB_S))).toBe(2);
        // N only (1 bit) is closer to empty.
        expect(resolveAutotile(idx, neighborsFromMask(TB_N))).toBe(1);
    });

    it('reverse tile→terrain map covers every terrain tile', () => {
        const asset = parseTileset({
            tiles: { 3: { terrain: { set: 0, mask: 1 } }, 9: { terrain: { set: 1, mask: 2 } } },
            terrains: [{ name: 'A', mode: 'edge' }, { name: 'B', mode: 'edge' }],
        });
        const { tileTerrain } = buildTerrainIndices(asset);
        expect(tileTerrain.get(3)).toBe(0);
        expect(tileTerrain.get(9)).toBe(1);
        expect(tileTerrain.has(1)).toBe(false);
    });
});
