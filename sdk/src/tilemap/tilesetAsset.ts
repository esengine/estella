// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilesetAsset.ts
 * @brief   The `.estileset` tileset-palette asset — atlas slicing + per-tile behaviour.
 *          The reusable asset the Tileset editor authors and the
 *          single source of truth for how a tile looks (atlas grid) AND behaves (collision
 *          shape / animation / properties). Tilemaps reference it; collision is derived from
 *          it at runtime, so editing the tileset updates every map.
 *
 * Mirrors the `.esanim` format seam (`AnimationClip.ts`): one in-memory model
 * ({@link TilesetAsset}), a structure-tolerant {@link parseTileset}, and a clean
 * {@link serializeTileset} so `parse(serialize(x))` round-trips. The schema is
 * deliberately extensible — terrain/autotile (wang/rule) rules and physics-layer/one-way
 * flags slot onto tiles later without a version break.
 */

/** The current `.estileset` format version. */
export const TILESET_FORMAT_VERSION = '1';

/**
 * A tile's collision SHAPE, in tile-local pixels (origin top-left, y-down like the atlas).
 * `box` = the full cell AABB (greedy-merged at runtime); `polygon` = custom points for
 * slopes / partial tiles; `circle` = a disc centred at (cx, cy) with radius r.
 */
export type TileCollisionShape =
    | { type: 'box' }
    | { type: 'polygon'; points: [number, number][] }
    | { type: 'circle'; cx: number; cy: number; r: number };

/**
 * A tile's collision = a {@link TileCollisionShape} plus optional cross-cutting modifiers.
 * Every modifier is optional and omitted when at its engine default, so existing
 * `.estileset` files (plain `{type:'box'}` / `{type:'polygon'}`) round-trip byte-for-byte.
 * `oneWay` is the solid-side normal in physics/world convention (y-up; `{0,1}` = solid-top,
 * jump-through floor); flip flags reorient it at placement. Absence of `collision` = none.
 */
export type TilesetCollision = TileCollisionShape & {
    /** One-way (jump-through) platform: contacts from behind this normal pass through. */
    oneWay?: { nx: number; ny: number };
    /** Non-solid trigger volume (fires events, no physical response). */
    sensor?: boolean;
    /** Physics material overrides (absent = engine defaults). */
    density?: number;
    friction?: number;
    restitution?: number;
};

/** One animation frame: show tile `tile` for `durationMs` milliseconds. */
export interface TilesetAnimFrame {
    tile: number;
    durationMs: number;
}

/**
 * How a terrain's tiles match their neighbours. `edge` = 4-bit N/E/S/W peering (16-tile
 * sets, good for ground/walls); `corner` = the 8-bit "corners and sides" blob (up to 47
 * tiles, smooth blobby terrain) — both are single-terrain peering masks. `wang` = the
 * modern corner (Wang) model: each tile assigns a COLOR to each of its 4 corners, so one
 * set blends MANY terrains (grass↔sand↔water) and paints on a half-cell corner grid.
 * See `autotile.ts` for the resolvers.
 */
export type TerrainMode = 'edge' | 'corner' | 'wang';

/** One terrain color in a `wang` set (a corner can carry this). */
export interface TerrainColor {
    name: string;
    /** CSS color for the authoring dot / brush swatch. */
    color: string;
}

/** A named terrain (autotile rule set) in a tileset; tiles join it via {@link TilesetTileTerrain}. */
export interface TilesetTerrain {
    name: string;
    mode: TerrainMode;
    /** Authoring tint for a peering (edge/corner) terrain (CSS color); cosmetic. */
    color?: string;
    /** The corner-color palette for a `wang` set (index 0 in `corners` = none/empty). */
    colors?: TerrainColor[];
}

/**
 * A tile's membership in a terrain set. Edge/corner sets use `mask` (a peering bitmask,
 * see `autotile.ts`); a `wang` set uses `corners` — the color index at each corner in
 * [top-left, top-right, bottom-right, bottom-left] order (0 = none, else 1-based into the
 * set's {@link TilesetTerrain.colors}).
 */
export interface TilesetTileTerrain {
    set: number;
    mask?: number;
    corners?: number[];
}

/** Per-tile metadata. Sparse — only tiles that carry any of these appear in the map. */
export interface TilesetTile {
    collision?: TilesetCollision;
    properties?: Record<string, string>;
    animation?: TilesetAnimFrame[];
    terrain?: TilesetTileTerrain;
    /** Random-brush weight (Tiled's tile probability). Default 1; 0 = never scattered. */
    probability?: number;
}

/** A reusable tileset palette asset (`.estileset`). */
export interface TilesetAsset {
    version: string;
    /** `@uuid:` ref to the atlas texture. */
    texture: string;
    tileWidth: number;
    tileHeight: number;
    /** Tiles per atlas row. */
    columns: number;
    /** Border (px) inside the atlas before the first tile. */
    margin: number;
    /** Gap (px) between adjacent tiles. */
    spacing: number;
    /** Total tile count (optional; otherwise derived from the texture + grid). */
    tileCount?: number;
    /** Per-tile metadata keyed by tile id (1-based; id 0 = empty). */
    tiles: Record<number, TilesetTile>;
    /** Terrain (autotile) rule sets; a tile joins one via its `terrain.set` index. */
    terrains?: TilesetTerrain[];
}

function posInt(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function nonNeg(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** A one-way normal: `true` → solid-top (0,1); an {nx,ny}/{x,y} object → that unit normal. */
function normalizeOneWay(raw: any): { nx: number; ny: number } | undefined {
    if (raw === true) return { nx: 0, ny: 1 };
    if (!raw || typeof raw !== 'object') return undefined;
    const nx = Number.isFinite(raw.nx) ? raw.nx : (Number.isFinite(raw.x) ? raw.x : 0);
    const ny = Number.isFinite(raw.ny) ? raw.ny : (Number.isFinite(raw.y) ? raw.y : 1);
    const len = Math.hypot(nx, ny);
    return len > 1e-6 ? { nx: nx / len, ny: ny / len } : { nx: 0, ny: 1 };
}

function normalizeCollision(raw: any): TilesetCollision | undefined {
    if (raw === true) return { type: 'box' };          // legacy / Tiled-style boolean flag
    if (!raw || typeof raw !== 'object') return undefined;

    // Shape first.
    let shape: TileCollisionShape;
    if (raw.type === 'polygon' && Array.isArray(raw.points)) {
        const points = raw.points
            .filter((p: any) => Array.isArray(p) && p.length >= 2
                && typeof p[0] === 'number' && typeof p[1] === 'number')
            .map((p: any) => [p[0], p[1]] as [number, number]);
        if (points.length < 3) return undefined;      // a polygon needs at least a triangle
        shape = { type: 'polygon', points };
    } else if (raw.type === 'circle' && Number.isFinite(raw.r) && raw.r > 0) {
        shape = {
            type: 'circle',
            cx: Number.isFinite(raw.cx) ? raw.cx : 0,
            cy: Number.isFinite(raw.cy) ? raw.cy : 0,
            r: raw.r,
        };
    } else {
        // Any other truthy collision (incl. `{type:'box'}` or a legacy `true`) = a full-cell box.
        shape = { type: 'box' };
    }

    // Modifiers — attached only when present, so a plain box/polygon stays byte-identical.
    const out: TilesetCollision = shape;
    const oneWay = normalizeOneWay(raw.oneWay);
    if (oneWay) out.oneWay = oneWay;
    if (raw.sensor === true) out.sensor = true;
    if (Number.isFinite(raw.density)) out.density = raw.density;
    if (Number.isFinite(raw.friction)) out.friction = raw.friction;
    if (Number.isFinite(raw.restitution)) out.restitution = raw.restitution;
    return out;
}

/** Parse arbitrary JSON into a normalized {@link TilesetAsset} (tolerant of missing fields). */
export function parseTileset(rawJson: unknown): TilesetAsset {
    const raw = rawJson as Record<string, any> | null | undefined;
    const tiles: Record<number, TilesetTile> = {};
    const rawTiles = (raw && typeof raw.tiles === 'object' && raw.tiles) || {};
    for (const key of Object.keys(rawTiles)) {
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0) continue;
        const t = rawTiles[key] ?? {};
        const tile: TilesetTile = {};
        const collision = normalizeCollision(t.collision);
        if (collision) tile.collision = collision;
        if (t.properties && typeof t.properties === 'object') {
            tile.properties = {};
            for (const k of Object.keys(t.properties)) tile.properties[k] = String(t.properties[k]);
        }
        if (Array.isArray(t.animation)) {
            const frames = t.animation
                .filter((f: any) => f && Number.isInteger(f.tile))
                .map((f: any) => ({ tile: f.tile, durationMs: nonNeg(f.durationMs, 100) }));
            if (frames.length > 0) tile.animation = frames;
        }
        if (t.terrain && typeof t.terrain === 'object'
            && Number.isInteger(t.terrain.set) && t.terrain.set >= 0) {
            const tt: TilesetTileTerrain = { set: t.terrain.set };
            if (Number.isInteger(t.terrain.mask) && t.terrain.mask >= 0) tt.mask = t.terrain.mask;
            if (Array.isArray(t.terrain.corners) && t.terrain.corners.length === 4
                && t.terrain.corners.every((c: any) => Number.isInteger(c) && c >= 0)) {
                tt.corners = [t.terrain.corners[0], t.terrain.corners[1], t.terrain.corners[2], t.terrain.corners[3]];
            }
            // A membership needs at least one of the two payloads (peering mask or wang corners).
            if (tt.mask !== undefined || tt.corners !== undefined) tile.terrain = tt;
        }
        if (typeof t.probability === 'number' && Number.isFinite(t.probability)
            && t.probability >= 0 && t.probability !== 1) {
            tile.probability = t.probability;
        }
        if (tile.collision || tile.properties || tile.animation || tile.terrain
            || tile.probability !== undefined) tiles[id] = tile;
    }
    const terrains: TilesetTerrain[] = Array.isArray(raw?.terrains)
        ? raw.terrains
            .filter((t: any) => t && typeof t.name === 'string')
            .map((t: any): TilesetTerrain => {
                const mode: TerrainMode = t.mode === 'corner' ? 'corner' : t.mode === 'wang' ? 'wang' : 'edge';
                const colors: TerrainColor[] = Array.isArray(t.colors)
                    ? t.colors
                        .filter((c: any) => c && typeof c.color === 'string')
                        .map((c: any): TerrainColor => ({ name: typeof c.name === 'string' ? c.name : '', color: c.color }))
                    : [];
                return {
                    name: t.name,
                    mode,
                    ...(typeof t.color === 'string' ? { color: t.color } : {}),
                    ...(colors.length > 0 ? { colors } : {}),
                };
            })
        : [];
    return {
        version: typeof raw?.version === 'string' ? raw.version : TILESET_FORMAT_VERSION,
        texture: typeof raw?.texture === 'string' ? raw.texture : '',
        tileWidth: posInt(raw?.tileWidth, 16),
        tileHeight: posInt(raw?.tileHeight, 16),
        columns: posInt(raw?.columns, 1),
        margin: nonNeg(raw?.margin, 0),
        spacing: nonNeg(raw?.spacing, 0),
        tileCount: Number.isInteger(raw?.tileCount) ? raw?.tileCount : undefined,
        tiles,
        ...(terrains.length > 0 ? { terrains } : {}),
    };
}

/** Serialize a {@link TilesetAsset} to a plain JSON-ready object (drops empty/undefined). */
export function serializeTileset(asset: TilesetAsset): Record<string, unknown> {
    const tiles: Record<string, TilesetTile> = {};
    for (const id of Object.keys(asset.tiles)) tiles[id] = asset.tiles[Number(id)];
    const out: Record<string, unknown> = {
        version: asset.version || TILESET_FORMAT_VERSION,
        texture: asset.texture,
        tileWidth: asset.tileWidth,
        tileHeight: asset.tileHeight,
        columns: asset.columns,
        margin: asset.margin,
        spacing: asset.spacing,
        tiles,
    };
    if (asset.tileCount !== undefined) out.tileCount = asset.tileCount;
    if (asset.terrains && asset.terrains.length > 0) out.terrains = asset.terrains;
    return out;
}

/** A fresh tileset over a texture (no per-tile metadata yet). */
export function createTileset(
    texture: string, tileWidth = 16, tileHeight = 16, columns = 1,
): TilesetAsset {
    return {
        version: TILESET_FORMAT_VERSION,
        texture, tileWidth, tileHeight, columns,
        margin: 0, spacing: 0, tiles: {},
    };
}

/**
 * The tile ids flagged collidable — feeds `generateLayerCollision` (the box-merge set) and
 * the Tiled-style `collisionTileIds`. Polygon tiles are included (their custom shape is
 * emitted separately at collider-build time).
 */
export function collidableTileIds(asset: TilesetAsset): number[] {
    return Object.keys(asset.tiles)
        .map(Number)
        .filter((id) => asset.tiles[id].collision !== undefined)
        .sort((a, b) => a - b);
}
