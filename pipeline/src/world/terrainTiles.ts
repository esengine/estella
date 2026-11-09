// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    terrainTiles.ts
 * @brief   One area's ground cut into the tiles and overview of a `.esterrain`.
 */
import { HeightmapFormat, type Heightfield, type TerrainTilesDocument } from 'esengine';

export interface TerrainSplat { width: number; height: number; pixels: Uint8Array }

export interface SplitTerrainOptions {
    /** Project-relative directory the tiles are written under, and the stem their names start with. */
    dir: string;
    name: string;
    /** Samples along a tile's side, edges shared: a power of two plus one. */
    tileSamples?: number;
    /** Samples along the overview's longer side. */
    overviewSamples?: number;
}

export interface TerrainImageOut { width: number; height: number; rgba: Uint8Array }

export interface SplitTerrain {
    document: TerrainTilesDocument;
    documentPath: string;
    /** Project-relative path → the image to write there as a PNG, exactly (no colour conversion). */
    images: Map<string, TerrainImageOut>;
}

const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(v, a), b);

function heightAt(f: Heightfield, u: number, v: number): number {
    const x = clamp(u, 0, 1) * (f.width - 1), y = clamp(v, 0, 1) * (f.height - 1);
    const i = Math.min(Math.floor(x), f.width - 2), j = Math.min(Math.floor(y), f.height - 2);
    const fx = x - i, fy = y - j, d = f.data, w = f.width;
    const a = d[j * w + i]!, b = d[j * w + i + 1]!, c = d[(j + 1) * w + i]!, e = d[(j + 1) * w + i + 1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

function heightsPng(width: number, height: number, sample: (i: number, j: number) => number): TerrainImageOut {
    const out = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        const v = Math.round(clamp(sample(i, j), 0, 1) * 65535), k = (j * width + i) * 4;
        out[k] = v >> 8; out[k + 1] = v & 255; out[k + 3] = 255;
    }
    return { width, height, rgba: out };
}

function splatPng(s: TerrainSplat, width: number, height: number, u0: number, v0: number, du: number, dv: number): TerrainImageOut {
    const out = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
        const x = Math.round(clamp(u0 + i * du, 0, 1) * (s.width - 1)), y = Math.round(clamp(v0 + j * dv, 0, 1) * (s.height - 1));
        out.set(s.pixels.subarray((y * s.width + x) * 4, (y * s.width + x) * 4 + 4), (j * width + i) * 4);
    }
    return { width, height, rgba: out };
}

/**
 * Cuts `field` (and its splatmaps) into tiles of `tileSamples` a side and an overview. A field whose sides are not a whole number of
 * tiles is resampled up to the next size that is, so the ground keeps its shape and its edges.
 */
export function splitTerrain(field: Heightfield, splat: TerrainSplat | null, splat2: TerrainSplat | null, options: SplitTerrainOptions): SplitTerrain {
    const t = options.tileSamples ?? 513, n = t - 1;
    if (!Number.isInteger(t) || t < 3) throw new Error('tileSamples must be a whole number of at least 3');
    const tilesX = Math.max(1, Math.ceil((field.width - 1) / n)), tilesZ = Math.max(1, Math.ceil((field.height - 1) / n));
    const sx = tilesX * n + 1, sz = tilesZ * n + 1;
    const most = Math.max(sx, sz), overviewMost = Math.min(options.overviewSamples ?? 1025, most);
    const ow = Math.max(2, Math.round((sx - 1) / (most - 1) * (overviewMost - 1)) + 1), oh = Math.max(2, Math.round((sz - 1) / (most - 1) * (overviewMost - 1)) + 1);
    const dir = options.dir.replace(/\/+$/, ''), stem = `${dir}/${options.name}`;
    const files = new Map<string, TerrainImageOut>();
    const overview = `${stem}_overview.png`;
    files.set(overview, heightsPng(ow, oh, (i, j) => heightAt(field, i / (ow - 1), j / (oh - 1))));
    const document: TerrainTilesDocument = { version: 1, tileSamples: t, tilesX, tilesZ, format: HeightmapFormat.RedGreen16, overview, tiles: [] };
    if (splat) files.set(document.overviewSplat = `${stem}_overview_splat.png`, splatPng(splat, ow, oh, 0, 0, 1 / (ow - 1), 1 / (oh - 1)));
    if (splat2) files.set(document.overviewSplat2 = `${stem}_overview_splat2.png`, splatPng(splat2, ow, oh, 0, 0, 1 / (ow - 1), 1 / (oh - 1)));
    for (let tz = 0; tz < tilesZ; tz++) for (let tx = 0; tx < tilesX; tx++) {
        const u0 = tx * n / (sx - 1), v0 = tz * n / (sz - 1), du = 1 / (sx - 1), dv = 1 / (sz - 1);
        const height = `${stem}_${tx}_${tz}.png`;
        files.set(height, heightsPng(t, t, (i, j) => heightAt(field, u0 + i * du, v0 + j * dv)));
        const entry: TerrainTilesDocument['tiles'][number] = { x: tx, z: tz, height };
        if (splat) files.set(entry.splat = `${stem}_${tx}_${tz}_splat.png`, splatPng(splat, t, t, u0, v0, du, dv));
        if (splat2) files.set(entry.splat2 = `${stem}_${tx}_${tz}_splat2.png`, splatPng(splat2, t, t, u0, v0, du, dv));
        document.tiles.push(entry);
    }
    return { document, documentPath: `${stem}.esterrain`, images: files };
}
