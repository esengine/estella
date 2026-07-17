// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseTileset, serializeTileset } from '../src/tilemap/tilesetAsset';
import {
    packCorners, buildWangIndices, resolveWang, buildTerrainIndices,
} from '../src/tilemap/autotile';

// A minimal wang tileset: one set with colors [_, grass(1), sand(2)], and tiles covering
// a few corner combinations. Corner order is [TL, TR, BR, BL].
const wangRaw = {
    version: '1', texture: '@uuid:x', tileWidth: 16, tileHeight: 16, columns: 4, margin: 0, spacing: 0,
    terrains: [
        { name: 'Ground', mode: 'wang', colors: [{ name: 'Grass', color: '#3a3' }, { name: 'Sand', color: '#dc8' }] },
        { name: 'Wall', mode: 'edge' },
    ],
    tiles: {
        1: { terrain: { set: 0, corners: [1, 1, 1, 1] } }, // all grass
        2: { terrain: { set: 0, corners: [2, 2, 2, 2] } }, // all sand
        3: { terrain: { set: 0, corners: [1, 2, 2, 1] } }, // grass left, sand right
        4: { terrain: { set: 0, corners: [1, 1, 2, 2] } }, // grass top, sand bottom
        9: { terrain: { set: 1, mask: 1 } },               // a peering tile in another set
    },
};

describe('packCorners', () => {
    it('is a stable, collision-free key for distinct corner combos', () => {
        expect(packCorners(1, 1, 1, 1)).toBe(packCorners(1, 1, 1, 1));
        expect(packCorners(1, 2, 2, 1)).not.toBe(packCorners(1, 1, 2, 2));
        // the top corner (BL) still yields a positive integer (no signed << 24 overflow)
        expect(packCorners(0, 0, 0, 255)).toBeGreaterThan(0);
        expect(packCorners(0, 0, 0, 200)).toBeGreaterThan(0);
    });
});

describe('wang round-trip', () => {
    it('parses + serializes colors and per-tile corners', () => {
        const a = parseTileset(wangRaw);
        expect(a.terrains?.[0]).toEqual({
            name: 'Ground', mode: 'wang',
            colors: [{ name: 'Grass', color: '#3a3' }, { name: 'Sand', color: '#dc8' }],
        });
        expect(a.tiles[3].terrain).toEqual({ set: 0, corners: [1, 2, 2, 1] });
        // survives a serialize→parse cycle unchanged
        const b = parseTileset(serializeTileset(a));
        expect(b.tiles[3].terrain).toEqual({ set: 0, corners: [1, 2, 2, 1] });
        expect(b.terrains?.[0].colors).toHaveLength(2);
    });

    it('drops a terrain membership with neither a mask nor corners', () => {
        const a = parseTileset({
            ...wangRaw,
            tiles: { 7: { terrain: { set: 0 } }, 8: { terrain: { set: 0, corners: [1, 0, 0, 1] } } },
        });
        expect(a.tiles[7]).toBeUndefined();
        expect(a.tiles[8].terrain).toEqual({ set: 0, corners: [1, 0, 0, 1] });
    });
});

describe('buildWangIndices + resolveWang', () => {
    const asset = parseTileset(wangRaw);

    it('indexes only wang tiles (peering tiles stay out)', () => {
        const wi = buildWangIndices(asset);
        expect(wi.sets.has(0)).toBe(true);
        expect(wi.sets.has(1)).toBe(false);           // set 1 is 'edge', not wang
        expect(wi.tileTerrain.get(3)).toBe(0);
        expect(wi.tileTerrain.has(9)).toBe(false);
    });

    it('the peering resolver ignores wang tiles (no cross-pollution)', () => {
        const ti = buildTerrainIndices(asset);
        expect(ti.sets.has(0)).toBe(false);           // wang set absent from peering index
        expect(ti.tileTerrain.has(1)).toBe(false);
    });

    it('resolves an exact corner match', () => {
        const wi = buildWangIndices(asset);
        const set = wi.sets.get(0)!;
        expect(resolveWang(set, [1, 1, 1, 1])).toBe(1); // all grass
        expect(resolveWang(set, [2, 2, 2, 2])).toBe(2); // all sand
        expect(resolveWang(set, [1, 2, 2, 1])).toBe(3); // grass|sand vertical split
        expect(resolveWang(set, [1, 1, 2, 2])).toBe(4); // grass|sand horizontal split
    });

    it('falls back to the nearest tile by corner mismatch', () => {
        const wi = buildWangIndices(asset);
        const set = wi.sets.get(0)!;
        // [1,1,1,2] differs from tile 1 (all grass) in 1 corner, from others in >=2 → tile 1
        expect(resolveWang(set, [1, 1, 1, 2])).toBe(1);
        // [2,2,2,1] is 1 corner from tile 2 (all sand) → tile 2
        expect(resolveWang(set, [2, 2, 2, 1])).toBe(2);
    });
});
