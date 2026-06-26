// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    autotile.ts
 * @brief   Terrain autotiling: pick a tile from a `.estileset` terrain set by how a cell
 *          peers with its same-terrain neighbours. Pure (no engine deps) so the painter
 *          and tests share one resolver.
 *
 * Two modes (see {@link TerrainMode}): `edge` matches the 4 sides (N/E/S/W → 16 tiles),
 * `corner` is the 8-bit "corners and sides" blob — a corner peering bit only counts when
 * both of its adjacent sides also peer (the classic 47-tile reduction). When no tile has
 * the exact mask, the nearest by Hamming distance is used, so a partial set still paints.
 */

import type { TilesetAsset, TerrainMode } from './tilesetAsset';

// Peering-direction bits. Sides are the low nibble so `& SIDE_BITS` keeps edge masks.
export const TB_N = 1;
export const TB_E = 2;
export const TB_S = 4;
export const TB_W = 8;
export const TB_NE = 16;
export const TB_SE = 32;
export const TB_SW = 64;
export const TB_NW = 128;

const SIDE_BITS = TB_N | TB_E | TB_S | TB_W;

/**
 * The 8 neighbour offsets (tile grid, y down) paired with their peering bit. Index order
 * is the contract for {@link resolveAutotile}'s `neighbors` argument.
 */
export const TERRAIN_NEIGHBORS: ReadonlyArray<{ dx: number; dy: number; bit: number }> = [
    { dx: 0, dy: -1, bit: TB_N },
    { dx: 1, dy: -1, bit: TB_NE },
    { dx: 1, dy: 0, bit: TB_E },
    { dx: 1, dy: 1, bit: TB_SE },
    { dx: 0, dy: 1, bit: TB_S },
    { dx: -1, dy: 1, bit: TB_SW },
    { dx: -1, dy: 0, bit: TB_W },
    { dx: -1, dy: -1, bit: TB_NW },
];

/** Drop corner bits whose two adjacent sides don't both peer (the blob rule). */
export function normalizeCornerMask(mask: number): number {
    let m = mask;
    if ((m & TB_N) === 0 || (m & TB_E) === 0) m &= ~TB_NE;
    if ((m & TB_S) === 0 || (m & TB_E) === 0) m &= ~TB_SE;
    if ((m & TB_S) === 0 || (m & TB_W) === 0) m &= ~TB_SW;
    if ((m & TB_N) === 0 || (m & TB_W) === 0) m &= ~TB_NW;
    return m;
}

/** Canonicalize a raw peering mask for a mode (edge → sides only, corner → blob rule). */
export function canonicalMask(mode: TerrainMode, mask: number): number {
    return mode === 'corner' ? normalizeCornerMask(mask) : mask & SIDE_BITS;
}

/** A terrain set's resolver table: canonical peering mask → the tile id to draw. */
export interface TerrainIndex {
    mode: TerrainMode;
    byMask: Map<number, number>;
}

/** Built lookup over a tileset's terrains: per-set resolver + reverse tile→set. */
export interface TerrainIndices {
    /** setIndex → its {@link TerrainIndex}. */
    sets: Map<number, TerrainIndex>;
    /** tile id → the terrain set it belongs to (for reverse-deriving a painted cell's terrain). */
    tileTerrain: Map<number, number>;
}

/** Build the terrain resolver tables for a tileset (first tile wins a duplicated mask). */
export function buildTerrainIndices(asset: TilesetAsset): TerrainIndices {
    const sets = new Map<number, TerrainIndex>();
    const tileTerrain = new Map<number, number>();
    const terrains = asset.terrains ?? [];
    for (const key of Object.keys(asset.tiles)) {
        const id = Number(key);
        const t = asset.tiles[id].terrain;
        if (!t) continue;
        tileTerrain.set(id, t.set);
        const mode: TerrainMode = terrains[t.set]?.mode ?? 'edge';
        let index = sets.get(t.set);
        if (!index) {
            index = { mode, byMask: new Map() };
            sets.set(t.set, index);
        }
        const mask = canonicalMask(mode, t.mask);
        if (!index.byMask.has(mask)) index.byMask.set(mask, id);
    }
    return { sets, tileTerrain };
}

function popcount(n: number): number {
    let c = 0;
    for (let v = n; v !== 0; v &= v - 1) c++;
    return c;
}

/**
 * Pick the tile for a cell given which of its 8 neighbours are the same terrain.
 * `neighbors` is indexed by {@link TERRAIN_NEIGHBORS} order. Returns 0 if the set is empty.
 */
export function resolveAutotile(index: TerrainIndex, neighbors: readonly boolean[]): number {
    let mask = 0;
    for (let i = 0; i < TERRAIN_NEIGHBORS.length; i++) {
        if (neighbors[i]) mask |= TERRAIN_NEIGHBORS[i].bit;
    }
    mask = canonicalMask(index.mode, mask);
    const exact = index.byMask.get(mask);
    if (exact !== undefined) return exact;
    let best = 0;
    let bestDist = Infinity;
    for (const [m, id] of index.byMask) {
        const d = popcount(m ^ mask);
        if (d < bestDist) {
            bestDist = d;
            best = id;
        }
    }
    return best;
}
