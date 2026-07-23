// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    collisionPalette.ts
 * @brief   The built-in COLLISION-LAYER palette — a fixed set of collision brushes a
 *          TilemapLayer paints when it references {@link COLLISION_PALETTE_REF} instead of
 *          an `.estileset`. This is the "obstacle grid" primitive: paint solid / slope /
 *          one-way / sensor cells over any background (a single big image) with NO render
 *          tileset, and the exact same runtime that spawns tile colliders + draws the
 *          editor overlay handles it — the brush id is a global tile id and this palette
 *          IS the layer's {@link TilesetModel} (render slots empty ⇒ nothing draws).
 *
 * Reuse, not a second system: a collision layer is an ordinary TilemapLayer whose tileset
 * ref is the sentinel {@link COLLISION_PALETTE_REF}. The chunk store, paint tools, chunk
 * codec, flip/rotate, greedy box merge, one-way / sensor handling, and the world-space
 * collision overlay all key off the painted gid → this palette's collision — identical to
 * the `.estileset` path (`resolveTilesetModel`), only sourced from a fixed in-code table.
 *
 * STABILITY: a brush `id` is painted into (and saved in) a layer's chunk blob, so the
 * id → shape mapping is a serialization contract. Only APPEND brushes; never renumber or
 * repurpose an existing id, or existing collision maps silently change shape.
 */
import type { ResolvedTileCollision, TilesetModel } from './tilesetResolve';

/** The sentinel tileset ref that turns a TilemapLayer into a collision (obstacle) layer.
 *  Mirrors the `builtin:<id>` shader convention — resolved in code, never a project asset.
 *  A per-layer physics material rides as a query string: `builtin:collision?friction=0.1`. */
export const COLLISION_PALETTE_REF = 'builtin:collision';

/** A collision layer's whole-layer physics material (absent = engine default). */
export interface CollisionMaterial {
    friction?: number;
    restitution?: number;
    density?: number;
}

/** True for a collision ref — the bare sentinel OR a material-carrying `...?friction=…`. */
function isCollisionRef(r: string): boolean {
    return r === COLLISION_PALETTE_REF || r.startsWith(COLLISION_PALETTE_REF + '?');
}

/** True when a layer's tileset ref list is the built-in collision palette. */
export function isCollisionPaletteRef(refs: readonly string[]): boolean {
    return refs.some(isCollisionRef);
}

/** The per-layer material encoded in a collision ref list, if any (else engine defaults). */
export function parseCollisionMaterial(refs: readonly string[]): CollisionMaterial {
    const ref = refs.find(isCollisionRef) ?? '';
    const q = ref.indexOf('?');
    if (q < 0) return {};
    const out: CollisionMaterial = {};
    for (const pair of ref.slice(q + 1).split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const key = pair.slice(0, eq);
        const val = Number(pair.slice(eq + 1));
        if (!Number.isFinite(val)) continue;
        if (key === 'friction') out.friction = val;
        else if (key === 'restitution') out.restitution = val;
        else if (key === 'density') out.density = val;
    }
    return out;
}

/** Build a collision ref carrying a per-layer material (the bare sentinel when empty). */
export function collisionRefWithMaterial(material: CollisionMaterial): string {
    const parts: string[] = [];
    if (material.friction !== undefined) parts.push(`friction=${material.friction}`);
    if (material.restitution !== undefined) parts.push(`restitution=${material.restitution}`);
    if (material.density !== undefined) parts.push(`density=${material.density}`);
    return parts.length > 0 ? `${COLLISION_PALETTE_REF}?${parts.join('&')}` : COLLISION_PALETTE_REF;
}

/**
 * One collision brush. `id` is the global tile id painted into the cell; `key` is a stable
 * string the editor maps to a label + icon; `collision` is what the cell resolves to —
 * consumed by the same spawn / overlay path as an `.estileset` tile.
 */
export interface CollisionBrush {
    id: number;
    key: string;
    collision: ResolvedTileCollision;
}

// Polygon points are tile-normalized [0,1], y-DOWN (top-left origin) — the same convention
// `resolveTilesetModel` produces after dividing `.estileset` pixels by tile size, so
// `tileColliderShape` / `tileCollisionOutlines` consume them unchanged. The four ramp/half
// polygons match the editor's `.estileset` slope presets.
export const COLLISION_BRUSHES: CollisionBrush[] = [
    { id: 1, key: 'solid', collision: { shape: { type: 'box' } } },
    { id: 2, key: 'rampR', collision: { shape: { type: 'polygon', points: [[0, 1], [1, 1], [1, 0]] } } },
    { id: 3, key: 'rampL', collision: { shape: { type: 'polygon', points: [[0, 0], [0, 1], [1, 1]] } } },
    { id: 4, key: 'halfBottom', collision: { shape: { type: 'polygon', points: [[0, 0.5], [1, 0.5], [1, 1], [0, 1]] } } },
    { id: 5, key: 'halfTop', collision: { shape: { type: 'polygon', points: [[0, 0], [1, 0], [1, 0.5], [0, 0.5]] } } },
    { id: 6, key: 'halfLeft', collision: { shape: { type: 'polygon', points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] } } },
    { id: 7, key: 'halfRight', collision: { shape: { type: 'polygon', points: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] } } },
    // One-way (jump-through) floor: solid-top normal in world y-up ({0,1}); flips reorient it.
    { id: 8, key: 'oneWay', collision: { shape: { type: 'box' }, oneWay: { nx: 0, ny: 1 } } },
    // Trigger volume: non-solid sensor box (fires contact events, no physical response).
    { id: 9, key: 'sensor', collision: { shape: { type: 'box' }, sensor: true } },
];

/** A brush is a plain solid box (no modifier) exactly when the greedy rectangle merge may
 *  fuse it — mirrors `isPlainBox` in tilesetResolve so the two paths agree. */
function isPlainBox(c: ResolvedTileCollision): boolean {
    return c.shape.type === 'box' && !c.oneWay && !c.sensor
        && c.density === undefined && c.friction === undefined && c.restitution === undefined;
}

/**
 * The collision palette AS a {@link TilesetModel} — the same model `resolveTilesetModel`
 * derives from `.estileset`(s), so a collision layer feeds the identical spawn + overlay
 * code. `slots` is empty (no atlas ⇒ the renderer draws nothing); `collidableTileIds` holds
 * the plain solid box (greedy-merged), `tileShapes` the richer brushes (slopes / halves /
 * one-way / sensor), one collider each.
 */
export function buildCollisionPaletteModel(material?: CollisionMaterial): TilesetModel {
    // A per-layer material folds onto every brush's collision. With a material set, even the
    // plain solid box carries it (density/friction/restitution) — so it stops being a "plain
    // box", leaves the greedy-merge set, and spawns one collider per cell (the material is
    // whole-layer, correctness over the merge optimization; the default path still merges).
    const mat = material && (material.friction !== undefined || material.restitution !== undefined
        || material.density !== undefined) ? material : undefined;
    const collidableTileIds: number[] = [];
    const tileShapes = new Map<number, ResolvedTileCollision>();
    for (const b of COLLISION_BRUSHES) {
        const rc: ResolvedTileCollision = mat ? { ...b.collision, ...mat } : b.collision;
        if (isPlainBox(rc)) collidableTileIds.push(b.id);
        else tileShapes.set(b.id, rc);
    }
    collidableTileIds.sort((a, b) => a - b);
    return { slots: [], animations: new Map(), collidableTileIds, tileShapes };
}
