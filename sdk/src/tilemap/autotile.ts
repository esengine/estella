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
        const mode: TerrainMode = terrains[t.set]?.mode ?? 'edge';
        // Peering (edge/corner) only — wang sets carry per-corner colors, not a mask, and
        // resolve through buildWangIndices; skip them (and any tile missing a mask).
        if (mode === 'wang' || t.mask === undefined) continue;
        tileTerrain.set(id, t.set);
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

// ── Corner (Wang) terrain ────────────────────────────────────────────────────
// The modern model: a tile carries a COLOR at each of its 4 corners. A cell is resolved
// from the 4 colors on its corners (a half-cell "corner grid"), so one set blends many
// terrains. Corner order everywhere is [top-left, top-right, bottom-right, bottom-left].

/** Pack 4 corner color indices into one lookup key (8 bits each; up to 255 colors). */
export function packCorners(tl: number, tr: number, br: number, bl: number): number {
    // The low 3 bytes stay in int32 range; ADD the top byte (a plain multiply) so the OR's
    // int32 coercion can't wrap the key negative.
    return ((tl & 0xff) | ((tr & 0xff) << 8) | ((br & 0xff) << 16)) + ((bl & 0xff) * 0x1000000);
}

/** A wang set's resolver: packed 4-corner key → the tile id to draw. */
export interface WangIndex {
    byKey: Map<number, number>;
}

/** Built lookup over a tileset's wang terrains: per-set resolver + reverse tile→set. */
export interface WangIndices {
    sets: Map<number, WangIndex>;
    tileTerrain: Map<number, number>;
}

/** Build the corner-match resolver tables for a tileset's `wang` sets (first tile wins a dup). */
export function buildWangIndices(asset: TilesetAsset): WangIndices {
    const sets = new Map<number, WangIndex>();
    const tileTerrain = new Map<number, number>();
    const terrains = asset.terrains ?? [];
    for (const key of Object.keys(asset.tiles)) {
        const id = Number(key);
        const t = asset.tiles[id].terrain;
        if (!t || !t.corners || (terrains[t.set]?.mode ?? 'edge') !== 'wang') continue;
        tileTerrain.set(id, t.set);
        let index = sets.get(t.set);
        if (!index) { index = { byKey: new Map() }; sets.set(t.set, index); }
        const k = packCorners(t.corners[0], t.corners[1], t.corners[2], t.corners[3]);
        if (!index.byKey.has(k)) index.byKey.set(k, id);
    }
    return { sets, tileTerrain };
}

/** How many of the 4 corners differ between two packed keys. */
function cornerDist(a: number, b: number): number {
    let d = 0;
    for (let s = 0; s < 32; s += 8) {
        if (((a >>> s) & 0xff) !== ((b >>> s) & 0xff)) d++;
    }
    return d;
}

/**
 * Pick the tile whose 4 corner colors match `corners` ([TL, TR, BR, BL]); when no tile has
 * the exact combination, the nearest by corner-mismatch count is used, so a partial wang
 * set still paints. Returns 0 if the set is empty.
 */
export function resolveWang(index: WangIndex, corners: readonly number[]): number {
    const key = packCorners(corners[0] ?? 0, corners[1] ?? 0, corners[2] ?? 0, corners[3] ?? 0);
    const exact = index.byKey.get(key);
    if (exact !== undefined) return exact;
    let best = 0;
    let bestDist = Infinity;
    for (const [k, id] of index.byKey) {
        const d = cornerDist(k, key);
        if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
}
