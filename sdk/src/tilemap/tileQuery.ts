// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilemap/tileQuery.ts
 * @brief   Runtime tile-collision queries — "what collision does the tile at
 *          (x, y) carry?" without raycasting the physics world.
 *
 * Collision data lives TS-side (resolved from `.estileset` / Tiled sources by the
 * tilemap plugin), so these are cheap map lookups over the live tile grid: read
 * the cell id via {@link TilemapAPI.getTile}, then classify it against the
 * layer's resolved collision table. The plugin installs the layer → table
 * resolver at build; querying before the plugin runs (or a layer with no
 * collision data) returns null/false rather than throwing.
 */
import { TilemapAPI } from './tilemapAPI';
import { tileIdOf, tileFlagsOf } from './tileBits';
import { oneWayNormalWorld } from './tiledLoader';
import type { ResolvedTileCollision } from './tilesetResolve';
import type { Entity } from '../types';

/** A layer's resolved collision vocabulary: merge-eligible plain boxes + rich shapes. */
export interface LayerCollisionTable {
    boxIds: ReadonlySet<number>;
    shapes: ReadonlyMap<number, ResolvedTileCollision>;
}

type CollisionLookup = (layer: number) => LayerCollisionTable | null;
let lookup_: CollisionLookup | null = null;
const legacyOwner = {};
const lookups: Array<{ owner: object; fn: CollisionLookup }> = [];

/** Plugin-internal: install (or clear, with null) the layer → collision-table resolver. */
export function _bindTileCollisionLookup(
    fn: ((layer: number) => LayerCollisionTable | null) | null,
    owner: object = legacyOwner,
): void {
    const index = lookups.findIndex(entry => entry.owner === owner);
    if (index >= 0) lookups.splice(index, 1);
    if (fn) lookups.push({ owner, fn });
    lookup_ = lookups[lookups.length - 1]?.fn ?? null;
}

/** @internal A layer's collision vocabulary, or null when it has none (yet). */
export function tileCollisionTable(layer: number): LayerCollisionTable | null {
    return lookup_?.(layer) ?? null;
}

const PLAIN_BOX: ResolvedTileCollision = { shape: { type: 'box' } };

/**
 * Reorient a resolved tile collision by the cell's flip flags — the query twin of
 * the spawn path ({@link oneWayNormalWorld} + polygonLocalVerts), so a gameplay
 * query of a flipped collidable tile agrees with the collider physics actually
 * spawns. A box is flip-symmetric, so only polygon / circle geometry and a
 * one-way normal are transformed; the shared table entry is never mutated.
 */
function flipTileCollision(
    rc: ResolvedTileCollision, flipH: boolean, flipV: boolean, flipD: boolean,
): ResolvedTileCollision {
    // Normalized ([0,1], x-right / y-down) point flip, mirroring polygonLocalVerts.
    const flipPt = (sx: number, syDown: number): [number, number] => {
        let s = sx;
        let t = 1 - syDown; // to y-up
        if (flipV) t = 1 - t;
        if (flipH) s = 1 - s;
        if (flipD) { const tmp = s; s = t; t = tmp; }
        return [s, 1 - t]; // back to y-down
    };
    let shape = rc.shape;
    if (shape.type === 'polygon') {
        shape = { type: 'polygon', points: shape.points.map(([x, y]) => flipPt(x, y)) };
    } else if (shape.type === 'circle') {
        const [cx, cy] = flipPt(shape.cx, shape.cy);
        shape = { type: 'circle', cx, cy, r: shape.r };
    }
    const out: ResolvedTileCollision = { ...rc, shape };
    if (rc.oneWay) {
        const n = oneWayNormalWorld(rc.oneWay.nx, rc.oneWay.ny, flipH, flipV, flipD);
        out.oneWay = { nx: n.x + 0, ny: n.y + 0 }; // +0 normalizes a negated -0 to +0
    }
    return out;
}

/**
 * The resolved collision of the tile at grid cell (x, y) on `layer` — a plain
 * solid box, a rich shape (polygon / circle / one-way / sensor / material), or
 * null when the cell is empty or its tile has no collision.
 */
export function tileCollisionAt(layer: Entity | number, x: number, y: number): ResolvedTileCollision | null {
    const table = lookup_?.(layer as number);
    if (!table) return null;
    const raw = TilemapAPI.getTile(layer as Entity, x, y);
    const id = tileIdOf(raw);
    if (id === 0) return null;
    if (table.boxIds.has(id)) return PLAIN_BOX; // a box is flip-symmetric
    const rc = table.shapes.get(id);
    if (!rc) return null;
    // Apply the cell's flips so the queried shape / one-way normal matches the
    // collider the spawn path builds for the same flipped tile.
    const f = tileFlagsOf(raw);
    return (f.flipH || f.flipV || f.flipD) ? flipTileCollision(rc, f.flipH, f.flipV, f.flipD) : rc;
}

/**
 * True when the tile at grid cell (x, y) has SOLID collision — any non-sensor
 * shape. One-way platforms count as solid (they block from their solid side);
 * check {@link tileCollisionAt}'s `.oneWay` to treat them specially.
 */
export function isTileSolid(layer: Entity | number, x: number, y: number): boolean {
    const c = tileCollisionAt(layer, x, y);
    return c != null && !c.sensor;
}

/**
 * {@link tileCollisionAt} addressed in WORLD pixels — converts through the
 * layer's own grid (`worldToTile`, honoring the layer origin at (originX,
 * originY), typically its Transform position, and optional world Z rotation in radians).
 */
export function tileCollisionAtWorld(
    layer: Entity | number,
    worldX: number,
    worldY: number,
    originX = 0,
    originY = 0,
    rotation = 0,
): ResolvedTileCollision | null {
    const t = TilemapAPI.worldToTile(layer as Entity, worldX, worldY, originX, originY, rotation);
    return tileCollisionAt(layer, Math.floor(t.x), Math.floor(t.y));
}
