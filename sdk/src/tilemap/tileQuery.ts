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
import { tileIdOf } from './tileBits';
import type { ResolvedTileCollision } from './tilesetResolve';
import type { Entity } from '../types';

/** A layer's resolved collision vocabulary: merge-eligible plain boxes + rich shapes. */
export interface LayerCollisionTable {
    boxIds: ReadonlySet<number>;
    shapes: ReadonlyMap<number, ResolvedTileCollision>;
}

let lookup_: ((layer: number) => LayerCollisionTable | null) | null = null;

/** Plugin-internal: install (or clear, with null) the layer → collision-table resolver. */
export function _bindTileCollisionLookup(
    fn: ((layer: number) => LayerCollisionTable | null) | null,
): void {
    lookup_ = fn;
}

const PLAIN_BOX: ResolvedTileCollision = { shape: { type: 'box' } };

/**
 * The resolved collision of the tile at grid cell (x, y) on `layer` — a plain
 * solid box, a rich shape (polygon / circle / one-way / sensor / material), or
 * null when the cell is empty or its tile has no collision.
 */
export function tileCollisionAt(layer: Entity | number, x: number, y: number): ResolvedTileCollision | null {
    const table = lookup_?.(layer as number);
    if (!table) return null;
    const id = tileIdOf(TilemapAPI.getTile(layer as Entity, x, y));
    if (id === 0) return null;
    if (table.boxIds.has(id)) return PLAIN_BOX;
    return table.shapes.get(id) ?? null;
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
 * originY), typically its Transform position).
 */
export function tileCollisionAtWorld(
    layer: Entity | number,
    worldX: number,
    worldY: number,
    originX = 0,
    originY = 0,
): ResolvedTileCollision | null {
    const t = TilemapAPI.worldToTile(layer as Entity, worldX, worldY, originX, originY);
    return tileCollisionAt(layer, Math.floor(t.x), Math.floor(t.y));
}
