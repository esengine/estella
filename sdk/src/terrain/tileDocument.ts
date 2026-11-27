// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { HeightmapFormat } from './heightfield';

/** One tile of a `.esterrain`, by its place in the grid and the project paths of its images. @experimental */
export interface TerrainTileEntry { x: number; z: number; height: string; splat?: string; splat2?: string }

/** A `.esterrain` document. @experimental */
export interface TerrainTilesDocument {
    version: 1;
    /** Samples along a tile's side, its edges shared with its neighbours. */
    tileSamples: number;
    tilesX: number;
    tilesZ: number;
    /** How the tile and overview images hold their heights: a {@link HeightmapFormat}. */
    format: number;
    /** The whole area at low detail, always in memory: what distant ground is drawn from. */
    overview: string;
    overviewSplat?: string;
    overviewSplat2?: string;
    tiles: TerrainTileEntry[];
}

function optionalImage(ref: unknown, field: string): void {
    if (ref == null || ref === '') return;
    if (typeof ref !== 'string' || !ref.trim()) throw new Error(`${field} must name an image`);
}

/** A `.esterrain` checked, or a message naming what is wrong with it. */
export function parseTerrainTiles(json: unknown, file = 'terrain tiles'): TerrainTilesDocument {
    const o = json as Partial<TerrainTilesDocument> | null;
    if (!o || typeof o !== 'object' || o.version !== 1) throw new Error(`${file}: not a version 1 terrain`);
    const whole = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
    if (!whole(o.tileSamples, 3) || !whole(o.tilesX, 1) || !whole(o.tilesZ, 1)) throw new Error(`${file}: tileSamples, tilesX and tilesZ must be whole numbers`);
    if (typeof o.overview !== 'string' || !o.overview.trim()) throw new Error(`${file}: names no overview image`);
    optionalImage(o.overviewSplat, `${file}: overviewSplat`);
    optionalImage(o.overviewSplat2, `${file}: overviewSplat2`);
    const format = o.format ?? HeightmapFormat.RedGreen16;
    if (format !== HeightmapFormat.Grey && format !== HeightmapFormat.RedGreen16) throw new Error(`${file}: unsupported heightmap format ${JSON.stringify(format)}`);
    if (!Array.isArray(o.tiles)) throw new Error(`${file}: has no tile list`);
    const seen = new Set<string>();
    for (const t of o.tiles) {
        if (!whole(t?.x, 0) || !whole(t?.z, 0) || t.x >= o.tilesX || t.z >= o.tilesZ || typeof t.height !== 'string' || !t.height.trim()) {
            throw new Error(`${file}: tile ${JSON.stringify(t)} is outside the ${o.tilesX} by ${o.tilesZ} grid or names no heights`);
        }
        const key = `${t.x}:${t.z}`;
        if (seen.has(key)) throw new Error(`${file}: tile ${t.x}, ${t.z} is listed twice`);
        seen.add(key);
        optionalImage(t.splat, `${file}: tile ${key} splat`);
        optionalImage(t.splat2, `${file}: tile ${key} splat2`);
    }
    return { version: 1, tileSamples: o.tileSamples, tilesX: o.tilesX, tilesZ: o.tilesZ, format,
        overview: o.overview, overviewSplat: o.overviewSplat || undefined, overviewSplat2: o.overviewSplat2 || undefined, tiles: o.tiles };
}

/** @internal The image fields the runtime reads, in manifest order. */
export function terrainTileImageRefs(doc: TerrainTilesDocument): Set<string> {
    const refs = new Set<string>([doc.overview]);
    if (doc.overviewSplat) refs.add(doc.overviewSplat);
    if (doc.overviewSplat2) refs.add(doc.overviewSplat2);
    for (const tile of doc.tiles) {
        refs.add(tile.height);
        if (tile.splat) refs.add(tile.splat);
        if (tile.splat2) refs.add(tile.splat2);
    }
    return refs;
}

/** @internal The size required of a full-detail height tile, in a diagnostic shared by loading and cooking. */
export function terrainTileSizeError(key: string, path: string, side: number, image: { width: number; height: number }): string | null {
    if (image.width === side && image.height === side) return null;
    return `terrain tile ${key} (${path}) is ${image.width} by ${image.height}, not ${side} a side`;
}
