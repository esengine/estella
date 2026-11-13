// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageMaterial.ts — a picture as a surface: the maps a lit material reads beside its colour.
 *
 *        A wall is not only its colour. Light catches the edges of its bricks and slides off its glaze, and a picture
 *        alone draws flat however well it is painted. So a source may say what its surface is as well as what it looks
 *        like: its relief, how rough it is, and where it is metal. Each is drawn with the same layers the colour is, as
 *        a grey picture of its own (light is high, light is rough, light is metal), and what a material needs is made
 *        from them: a normal map from the relief, and one map holding roughness and metal.
 *
 *        With nothing drawn for the relief, the colour's own lightness stands in for it: dark is low. That is the
 *        cheap guess every texture tool makes, and it is right for mortar and wrong for a painted stripe, which is why
 *        a relief can be drawn instead.
 */
import { renderImage, type RenderedImage, type RgbaBitmap, type ImageFigureDrawer, type ImageTextDrawer } from './imageRaster';
import type { ImageLayer, ImageMaterial, ImageSource } from './imageSource';

export type { ImageMaterial } from './imageSource';

export interface MaterialMaps {
    /** Tangent space, +z out of the surface, as the engine's lit materials read it. */
    normal: RgbaBitmap;
    /** Roughness in green and metal in blue, glTF's layout; null when both are one value everywhere. */
    surface: RgbaBitmap | null;
    /** The one value, where it is one. */
    roughness: number;
    metal: number;
    /** The grey pictures the maps were made from, for looking at. */
    height: RgbaBitmap;
    notes: string[];
}

type DrawOptions = { pictures?: Readonly<Record<string, RgbaBitmap>>; text?: ImageTextDrawer; figure?: ImageFigureDrawer };

const lightness = (p: Uint8Array, i: number): number => (p[i * 4]! * 0.2126 + p[i * 4 + 1]! * 0.7152 + p[i * 4 + 2]! * 0.0722) / 255;

/** The layers as a grey picture the size of the source, on black: what is not drawn is low, smooth, not metal. */
function greyOf(source: ImageSource, layers: readonly ImageLayer[], options: DrawOptions): { values: Float32Array; picture: RenderedImage } {
    const picture = renderImage({ size: source.size, background: '#000000', ...(source.tile ? { tile: true } : {}), layers }, options);
    const values = new Float32Array(picture.width * picture.height);
    for (let i = 0; i < values.length; i++) values[i] = lightness(picture.rgba, i);
    return { values, picture };
}

/**
 * A normal map from heights 0..1. The slope at a pixel is read across its neighbours (a Sobel), going round the edges of
 * a picture that repeats and stopping at them otherwise. Green is up the picture, which is +v as the engine lays a
 * texture, so a ridge lit from above is bright on its upper side.
 */
export function normalFromHeight(height: Float32Array, w: number, h: number, relief: number, wrap: boolean): RgbaBitmap {
    const at = (x: number, y: number): number => {
        const [cx, cy] = wrap ? [((x % w) + w) % w, ((y % h) + h) % h] : [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))];
        return height[cy * w + cx]!;
    };
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = ((at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) / 8;
            // Down the picture is down the surface: a height rising toward the top of the picture slopes toward +v.
            const dy = ((at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1)) - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))) / 8;
            const [nx, ny] = [-dx * relief, -dy * relief];
            const l = Math.hypot(nx, ny, 1);
            const o = (y * w + x) * 4;
            rgba[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
            rgba[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
            rgba[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
            rgba[o + 3] = 255;
        }
    }
    return { width: w, height: h, rgba };
}

/**
 * How much the join shows when a picture is laid beside itself, as a share of how much one row or column of it differs
 * from the next anyway: about 1 is a picture that repeats, well above it is a seam.
 */
export function seamOf(image: RgbaBitmap): number {
    const { width: w, height: h, rgba } = image;
    if (w < 4 || h < 4) return 1;
    const step = (a: number, b: number): number => {
        let d = 0;
        for (let k = 0; k < 4; k++) d += Math.abs(rgba[a * 4 + k]! - rgba[b * 4 + k]!);
        return d;
    };
    let [across, inside, insideCount] = [0, 0, 0];
    for (let y = 0; y < h; y++) across += step(y * w + w - 1, y * w);
    for (let x = 0; x < w; x++) across += step((h - 1) * w + x, x);
    for (let y = 0; y < h; y++) for (let x = 0; x + 1 < w; x += Math.max(1, Math.floor(w / 16))) { inside += step(y * w + x, y * w + x + 1); insideCount++; }
    for (let x = 0; x < w; x++) for (let y = 0; y + 1 < h; y += Math.max(1, Math.floor(h / 16))) { inside += step(y * w + x, (y + 1) * w + x); insideCount++; }
    const usual = inside / Math.max(1, insideCount);
    const join = across / (w + h);
    // A flat picture has no usual step to measure against: its join shows only if there is one at all.
    return usual < 0.25 ? (join < 0.5 ? 1 : join / 0.25) : join / usual;
}

/** The maps a source's `material` asks for, drawn beside its colour @p color. */
export function renderMaterialMaps(source: ImageSource, color: RgbaBitmap, options: DrawOptions = {}): MaterialMaps {
    const material = source.material ?? {};
    const [w, h] = [color.width, color.height];
    const notes: string[] = [];
    let height: Float32Array;
    let heightPicture: RgbaBitmap;
    if (material.height) {
        const drawn = greyOf(source, material.height, options);
        [height, heightPicture] = [drawn.values, drawn.picture];
        notes.push(...drawn.picture.notes.map((n) => `height: ${n}`));
    } else {
        height = new Float32Array(w * h);
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            height[i] = lightness(color.rgba, i);
            const v = Math.round(height[i]! * 255);
            rgba.set([v, v, v, 255], i * 4);
        }
        heightPicture = { width: w, height: h, rgba };
    }
    let [low, high] = [1, 0];
    for (const v of height) { if (v < low) low = v; if (v > high) high = v; }
    if (high - low < 1 / 255) notes.push('the relief is flat: its height is one value everywhere, so the normal map says nothing');

    const constant = (v: ImageMaterial['roughness'], fallback: number): number => (typeof v === 'number' ? v : fallback);
    const drawnMap = (v: ImageMaterial['roughness'], name: string): Float32Array | null => {
        if (!Array.isArray(v)) return null;
        const drawn = greyOf(source, v, options);
        notes.push(...drawn.picture.notes.map((n) => `${name}: ${n}`));
        return drawn.values;
    };
    const [rough, metal] = [drawnMap(material.roughness, 'roughness'), drawnMap(material.metal, 'metal')];
    let surface: RgbaBitmap | null = null;
    if (rough || metal) {
        const rgba = new Uint8Array(w * h * 4);
        const [r0, m0] = [Math.round(constant(material.roughness, 0.8) * 255), Math.round(constant(material.metal, 0) * 255)];
        for (let i = 0; i < w * h; i++) {
            rgba[i * 4] = 255;
            rgba[i * 4 + 1] = rough ? Math.round(rough[i]! * 255) : r0;
            rgba[i * 4 + 2] = metal ? Math.round(metal[i]! * 255) : m0;
            rgba[i * 4 + 3] = 255;
        }
        surface = { width: w, height: h, rgba };
    }
    return {
        normal: normalFromHeight(height, w, h, material.relief ?? 4, source.tile === true),
        surface,
        roughness: constant(material.roughness, 0.8),
        metal: constant(material.metal, 0),
        height: heightPicture,
        notes,
    };
}

/** The `.esmaterial` that reads the maps, by the names they were saved under beside it. */
export function imageMaterialDoc(maps: MaterialMaps, files: { normal: string; surface: string | null }, constants: { version: string | number; blendNone: number; cullBack: number }): Record<string, unknown> {
    return {
        version: constants.version,
        type: 'material',
        shader: 'builtin:model',
        blendMode: constants.blendNone,
        depthTest: true,
        depthWrite: true,
        cull: constants.cullBack,
        properties: {
            u_normalMap: files.normal,
            // A map holds the values and the factors multiply it, so where there is a map they stand aside.
            ...(files.surface
                ? { u_metallicRoughnessMap: files.surface, u_roughness: 1, u_metallic: 1 }
                : { u_roughness: maps.roughness, u_metallic: maps.metal }),
        },
    };
}

/** A picture laid beside itself, two by two: the joins run down and across its middle, where a seam shows if there is one. */
export function laidTwice(image: RgbaBitmap): RgbaBitmap {
    const { width: w, height: h, rgba } = image;
    const out = new Uint8Array(w * 2 * h * 2 * 4);
    for (let y = 0; y < h * 2; y++) {
        for (let x = 0; x < w * 2; x++) {
            const from = ((y % h) * w + (x % w)) * 4;
            out.set(rgba.subarray(from, from + 4), (y * w * 2 + x) * 4);
        }
    }
    return { width: w * 2, height: h * 2, rgba: out };
}

/**
 * The surface under a low light from the upper left, as a flat wall of it would take one: what the relief and the
 * roughness do, which neither the colour nor the normal map's own colours show. For looking at; the engine's own
 * shading is what a scene gets.
 */
export function litPreview(color: RgbaBitmap, maps: MaterialMaps): RgbaBitmap {
    const { width: w, height: h } = color;
    const out = new Uint8Array(w * h * 4);
    const light = [-0.55, 0.55, 0.63];
    const half = (() => { const v = [light[0]!, light[1]!, light[2]! + 1]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
    const srgb = (v: number): number => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255);
    for (let i = 0; i < w * h; i++) {
        const n = [maps.normal.rgba[i * 4]! / 127.5 - 1, maps.normal.rgba[i * 4 + 1]! / 127.5 - 1, maps.normal.rgba[i * 4 + 2]! / 127.5 - 1];
        const rough = maps.surface ? maps.surface.rgba[i * 4 + 1]! / 255 : maps.roughness;
        const metal = maps.surface ? maps.surface.rgba[i * 4 + 2]! / 255 : maps.metal;
        const diffuse = Math.max(0, n[0]! * light[0]! + n[1]! * light[1]! + n[2]! * light[2]!);
        const shine = Math.pow(Math.max(0, n[0]! * half[0]! + n[1]! * half[1]! + n[2]! * half[2]!), 2 / Math.max(0.02, rough * rough) - 1) * (1 - rough) * 1.6;
        for (let k = 0; k < 3; k++) {
            const base = Math.pow(color.rgba[i * 4 + k]! / 255, 2.2);
            out[i * 4 + k] = srgb(base * (1 - metal) * (0.18 + 0.95 * diffuse) + (0.04 + (base - 0.04) * metal) * (shine + metal * 0.25 * (0.3 + diffuse)));
        }
        out[i * 4 + 3] = 255;
    }
    return { width: w, height: h, rgba: out };
}

/** Two pictures side by side, the second scaled to the first's height. */
export function sideBySide(a: RgbaBitmap, b: RgbaBitmap): RgbaBitmap {
    const out = new Uint8Array((a.width + b.width + 8) * a.height * 4).fill(60);
    for (let y = 0; y < a.height; y++) {
        out.set(a.rgba.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * (a.width + b.width + 8) * 4);
        const by = Math.min(b.height - 1, Math.floor((y / a.height) * b.height));
        out.set(b.rgba.subarray(by * b.width * 4, (by + 1) * b.width * 4), (y * (a.width + b.width + 8) + a.width + 8) * 4);
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return { width: a.width + b.width + 8, height: a.height, rgba: out };
}
