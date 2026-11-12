// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    layers.ts
 * @brief   A terrain layer (`.esterrainlayer`): one kind of ground (grass, a path's dirt, sand, rock) as the textures an artist made for it,
 *          and how they are laid; and the layers of a terrain packed into the texture arrays its shader reads.
 *
 * @details A layer names up to three textures, read as data and laid by world position:
 *            - albedo: the colour (sRGB);
 *            - normal: a tangent-space normal map, green up (the OpenGL convention);
 *            - mask: red the ambient occlusion, green the roughness, blue the height (where two layers meet, the higher shows).
 *          A texture a layer leaves out is made up: white albedo, a flat normal, and a mask of no occlusion, the layer's `roughness` and
 *          half height. The layers are packed at one size (the largest of their textures, to a power of two within `maxSize`), the tint
 *          multiplied into the albedo and the normal's strength into its slope, so the shader reads three arrays and nothing per layer
 *          but its tile.
 */
import type { AssetLoader, LoadContext } from '../asset/AssetLoader';
import { worldUnitScale } from '../ecs/worldUnits';

/** One kind of ground, as a `.esterrainlayer` file holds it. @experimental */
export interface TerrainLayerDef {
    /** Project paths of the textures (see the file's notes); an empty or missing one is made up. */
    albedo?: string;
    normal?: string;
    mask?: string;
    /** How many world units one repeat of the textures covers. */
    tile: number;
    /** Multiplies the albedo, 0 to 1 a channel. */
    tint: [number, number, number];
    /** The roughness where there is no mask, 0 to 1. */
    roughness: number;
    /** How strongly the normal map bends the light: 1 as drawn, 0 flat. */
    normalStrength: number;
    /**
     * How much the layer's own height decides where it meets another, 0 to 1: 0 blends by the paint alone (a smooth edge, for grass into sand),
     * 1 by the layers' heights (stones standing through grass). Absent, it is the material's `u_heightBlend`.
     */
    heightBlend?: number;
}

/** A layer file that names no tile repeats every 4 m: 400 units at the engine's reference, in the project's own (ecs/worldUnits.ts). */
const DEFAULT_TILE = 400;
const DEFAULTS: TerrainLayerDef = { tile: DEFAULT_TILE, tint: [1, 1, 1], roughness: 0.9, normalStrength: 1 };

/** A layer from a file's JSON, with what it leaves out at its defaults; throws naming the first field it cannot take. */
export function parseTerrainLayer(json: unknown, file = 'terrain layer'): TerrainLayerDef {
    if (!json || typeof json !== 'object') throw new Error(`${file}: an object`);
    const o = json as Record<string, unknown>;
    const num = (key: string, fallback: number, min: number, max: number): number => {
        const v = o[key];
        if (v === undefined) return fallback;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${file}.${key}: a number from ${min} to ${max}, not ${JSON.stringify(v)}`);
        return v;
    };
    const path = (key: string): string | undefined => {
        const v = o[key];
        if (v === undefined || v === '') return undefined;
        if (typeof v !== 'string') throw new Error(`${file}.${key}: a texture path, not ${JSON.stringify(v)}`);
        return v;
    };
    const tint = o.tint === undefined ? DEFAULTS.tint : o.tint;
    if (!Array.isArray(tint) || tint.length !== 3 || tint.some((c) => typeof c !== 'number' || !Number.isFinite(c)))
        throw new Error(`${file}.tint: three numbers, red, green and blue`);
    return {
        albedo: path('albedo'), normal: path('normal'), mask: path('mask'),
        tile: num('tile', DEFAULT_TILE * worldUnitScale(), 1e-3, 1e6),
        tint: tint as [number, number, number],
        roughness: num('roughness', DEFAULTS.roughness, 0, 1),
        normalStrength: num('normalStrength', DEFAULTS.normalStrength, 0, 4),
        ...(o.heightBlend === undefined ? {} : { heightBlend: num('heightBlend', 0, 0, 1) }),
    };
}

/** Loads `.esterrainlayer` files as checked layers. @experimental */
export class TerrainLayerAssetLoader implements AssetLoader<TerrainLayerDef> {
    readonly type = 'terrain-layer';
    readonly extensions = ['.esterrainlayer'];

    async load(path: string, ctx: LoadContext): Promise<TerrainLayerDef> {
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        return parseTerrainLayer(JSON.parse(text), path);
    }

    unload(): void {
        // A layer is plain data; the arrays made from it belong to the terrain that packed them.
    }
}

/** An image read as data: RGBA, top row first. */
export interface LayerImage { width: number; height: number; pixels: Uint8Array }

/** A layer with its textures read (null where it has none). */
export interface LayerSource { def: TerrainLayerDef; albedo: LayerImage | null; normal: LayerImage | null; mask: LayerImage | null }

/** The layers packed: one image a layer in each of the three arrays, all `size` by `size`. */
export interface PackedLayers { size: number; albedo: Uint8Array[]; normal: Uint8Array[]; mask: Uint8Array[]; tiles: number[]; heightBlends: number[] }

/** `image` resampled (bilinear, wrapping, as the layer tiles) to `size` by `size`. */
function resample(image: LayerImage, size: number): Uint8Array {
    if (image.width === size && image.height === size) return image.pixels;
    const out = new Uint8Array(size * size * 4);
    const { width: w, height: h, pixels: p } = image;
    for (let y = 0; y < size; y++) {
        const fy = ((y + 0.5) / size) * h - 0.5, y0 = Math.floor(fy), ty = fy - y0;
        const ya = ((y0 % h) + h) % h, yb = (ya + 1) % h;
        for (let x = 0; x < size; x++) {
            const fx = ((x + 0.5) / size) * w - 0.5, x0 = Math.floor(fx), tx = fx - x0;
            const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w;
            for (let c = 0; c < 4; c++) {
                const a = p[(ya * w + xa) * 4 + c]!, b = p[(ya * w + xb) * 4 + c]!, d = p[(yb * w + xa) * 4 + c]!, e = p[(yb * w + xb) * 4 + c]!;
                out[(y * size + x) * 4 + c] = Math.round((a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty);
            }
        }
    }
    return out;
}

/** Packs `layers` into the three arrays, at the size of their largest texture to a power of two no larger than `maxSize`. */
export function packLayers(layers: readonly LayerSource[], maxSize = 1024): PackedLayers {
    let largest = 16;
    for (const l of layers) for (const img of [l.albedo, l.normal, l.mask]) if (img) largest = Math.max(largest, img.width, img.height);
    const size = Math.min(2 ** Math.ceil(Math.log2(largest)), Math.max(maxSize, 16));
    const n = size * size;
    const albedo: Uint8Array[] = [], normal: Uint8Array[] = [], mask: Uint8Array[] = [];
    for (const { def, albedo: a, normal: nm, mask: m } of layers) {
        const colour = a ? new Uint8Array(resample(a, size)) : new Uint8Array(n * 4).fill(255);
        // The tint is in linear light; the albedo bytes are sRGB, so it multiplies them through its own sRGB encoding.
        const tint = def.tint.map((c) => Math.pow(Math.min(Math.max(c, 0), 1), 1 / 2.2));
        for (let k = 0; k < n; k++) {
            for (let c = 0; c < 3; c++) colour[k * 4 + c] = Math.round(colour[k * 4 + c]! * tint[c]!);
            colour[k * 4 + 3] = 255;
        }
        albedo.push(colour);
        const bend = new Uint8Array(n * 4);
        const src = nm ? resample(nm, size) : null;
        for (let k = 0; k < n; k++) {
            // The slope scaled by the strength, the normal made whole again.
            const x = src ? (src[k * 4]! / 255 * 2 - 1) * def.normalStrength : 0;
            const y = src ? (src[k * 4 + 1]! / 255 * 2 - 1) * def.normalStrength : 0;
            const z = Math.sqrt(Math.max(1 - Math.min(x * x + y * y, 1), 0));
            const len = Math.hypot(x, y, z) || 1;
            bend[k * 4] = Math.round((x / len * 0.5 + 0.5) * 255);
            bend[k * 4 + 1] = Math.round((y / len * 0.5 + 0.5) * 255);
            bend[k * 4 + 2] = Math.round((z / len * 0.5 + 0.5) * 255);
            bend[k * 4 + 3] = 255;
        }
        normal.push(bend);
        if (m) {
            mask.push(new Uint8Array(resample(m, size)));
        } else {
            // Without a mask the layer stands as high as its colour is bright, as a ground of stones between sand does.
            const made = new Uint8Array(n * 4);
            const rough = Math.round(def.roughness * 255);
            for (let k = 0; k < n; k++) {
                made[k * 4] = 255;
                made[k * 4 + 1] = rough;
                made[k * 4 + 2] = a ? Math.round(colour[k * 4]! * 0.299 + colour[k * 4 + 1]! * 0.587 + colour[k * 4 + 2]! * 0.114) : 128;
                made[k * 4 + 3] = 255;
            }
            mask.push(made);
        }
    }
    // A layer with no height blend of its own is -1: the shader reads the material's.
    return { size, albedo, normal, mask, tiles: layers.map((l) => l.def.tile), heightBlends: layers.map((l) => l.def.heightBlend ?? -1) };
}
