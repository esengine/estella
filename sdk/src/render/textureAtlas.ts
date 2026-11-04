// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  textureAtlas.ts
 * @brief Packs several textures onto one canvas at run time, so sprites that share it batch into one draw.
 */
import { Draw } from './draw';
import { BlendMode } from './blend';
import { Renderer, onDeviceRestored } from './renderer';
import { RenderTexture, type RenderTextureHandle } from './renderTexture';
import { getResourceManager, getTextureDimensions } from '../wasm/resourceManager';
import { log } from '../util/logger';
import { uvRectFromPixels } from './uvRect';

/** Where one source texture sits on an atlas. @experimental */
export interface AtlasEntry {
    /** Left edge in atlas pixels. */
    x: number;
    /** Top edge in atlas pixels, counted from the top of the canvas. */
    y: number;
    width: number;
    height: number;
    /** What `Sprite.uvOffset` takes to show exactly this entry. */
    uvOffset: { x: number; y: number };
    /** What `Sprite.uvScale` takes to show exactly this entry. */
    uvScale: { x: number; y: number };
}

/** Options of {@link TextureAtlas.pack}. @experimental */
export interface TextureAtlasOptions {
    /** The largest canvas edge to try, in pixels. Default 2048. */
    maxSize?: number;
    /** Transparent pixels kept between neighbours so a filtered edge does not pick up the next picture. Default 2. */
    padding?: number;
    /** Sampling filter of the canvas. Default `'linear'`. */
    filter?: 'nearest' | 'linear';
}

/** A packed canvas and where each source sits on it. @experimental */
export interface TextureAtlasHandle {
    /** Resource-table handle of the canvas — what `Sprite.texture` takes. */
    readonly texture: number;
    readonly width: number;
    readonly height: number;
    /** The entry of a source texture handle, or undefined when it was not packed. */
    get(source: number): AtlasEntry | undefined;
    /** `{ texture, uvOffset, uvScale }` for a source, ready to spread into a `Sprite`. */
    sprite(source: number): { texture: number; uvOffset: { x: number; y: number }; uvScale: { x: number; y: number } };
    /** Draws the canvas again from the sources; done for you after a device loss. */
    repaint(): void;
    /** Frees the canvas. The sources are not touched. */
    release(): void;
}

export interface PackSize {
    width: number;
    height: number;
}

export interface PackLayout {
    width: number;
    height: number;
    /** One top-left corner per input, in input order. */
    places: Array<{ x: number; y: number }>;
}

const nextPow2 = (n: number): number => {
    let p = 1;
    while (p < n) p *= 2;
    return p;
};

/** Rows of pictures, tallest first, in a canvas `width` wide; null if they run past `maxHeight`. */
function shelves(sizes: readonly PackSize[], order: readonly number[], width: number, padding: number, maxHeight: number): { places: Array<{ x: number; y: number }>; used: number } | null {
    const places = new Array<{ x: number; y: number }>(sizes.length);
    let x = 0, y = 0, rowHeight = 0;
    for (const i of order) {
        const w = sizes[i].width + padding, h = sizes[i].height + padding;
        if (x + w > width) {
            y += rowHeight;
            x = 0;
            rowHeight = 0;
        }
        if (w > width || y + h > maxHeight) return null;
        places[i] = { x, y };
        x += w;
        rowHeight = Math.max(rowHeight, h);
    }
    return { places, used: y + rowHeight };
}

/**
 * Lays the sizes out on the smallest power-of-two canvas that holds them, widening before it grows
 * tall. Throws when even `maxSize` on both edges is not enough.
 * @internal
 */
export function packRects(sizes: readonly PackSize[], maxSize: number, padding: number): PackLayout {
    if (sizes.length === 0) return { width: 1, height: 1, places: [] };
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].height - sizes[a].height || sizes[b].width - sizes[a].width || a - b);
    let area = 0;
    for (const s of sizes) area += (s.width + padding) * (s.height + padding);
    const widest = Math.max(...sizes.map((s) => s.width + padding));
    for (let width = Math.max(nextPow2(Math.ceil(Math.sqrt(area))), nextPow2(widest)); width <= maxSize; width *= 2) {
        const laid = shelves(sizes, order, width, padding, maxSize);
        if (laid) return { width, height: nextPow2(laid.used), places: laid.places };
    }
    throw new Error(`${sizes.length} textures do not fit in ${maxSize}×${maxSize} (with ${padding} px of padding)`);
}

/** Column-major orthographic projection over a rectangle: what RenderTexture.begin wants. */
function ortho(l: number, r: number, b: number, t: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = -1;
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[15] = 1;
    return m;
}

export const TextureAtlas = {
    /**
     * Draws `sources` (texture handles) onto one new canvas and returns where each landed. Call it
     * from a `Schedule.Update` system, not a draw callback. Null while the renderer is not up yet;
     * throws when a handle has no size or the textures do not fit. Keep the sources alive: a device
     * loss draws the canvas again from them.
     * @experimental
     */
    pack(sources: readonly number[], options: TextureAtlasOptions = {}): TextureAtlasHandle | null {
        const maxSize = options.maxSize ?? 2048;
        const padding = options.padding ?? 2;
        const unique = [...new Set(sources)];
        const sizes = unique.map((source) => {
            const dims = getTextureDimensions(source);
            if (!dims || dims.width <= 0 || dims.height <= 0) throw new Error(`texture handle ${source} has no size to pack`);
            return { width: dims.width, height: dims.height };
        });
        const layout = packRects(sizes, maxSize, padding);

        const rt: RenderTextureHandle = RenderTexture.create({ width: layout.width, height: layout.height, depth: false, filter: options.filter ?? 'linear' });
        if (rt.texture === 0) {
            RenderTexture.release(rt);
            return null;
        }

        const entries = new Map<number, AtlasEntry>();
        unique.forEach((source, i) => {
            const { x, y } = layout.places[i];
            const { width, height } = sizes[i];
            entries.set(source, {
                x, y, width, height,
                ...uvRectFromPixels({ x, y, width, height }, layout.width, layout.height),
            });
        });

        const repaint = (): void => {
            // Pixels count from the top of the canvas, the projection from its bottom.
            const vp = ortho(0, layout.width, 0, layout.height);
            RenderTexture.begin(rt, vp);
            Draw.begin(vp);
            Renderer.setViewport(0, 0, layout.width, layout.height);
            // Nothing blends: the first rect clears to transparent and each picture is copied as it is.
            Draw.setBlendMode(BlendMode.None);
            Draw.rect({ x: layout.width / 2, y: layout.height / 2 }, { x: layout.width, y: layout.height }, { r: 1, g: 1, b: 1, a: 0 });
            // Draw takes the device's own texture id, which a device loss renumbers: ask afresh each time.
            const rm = getResourceManager();
            for (const [source, e] of entries) {
                const deviceId = rm?.getTextureGLId(source) ?? 0;
                if (deviceId === 0) continue;
                Draw.texture({ x: e.x + e.width / 2, y: layout.height - e.y - e.height / 2 }, { x: e.width, y: e.height }, deviceId);
            }
            Draw.end();
            RenderTexture.end();
            RenderTexture.contentDrawn(rt);
        };
        repaint();

        const unsubscribe = onDeviceRestored(() => {
            try {
                repaint();
            } catch (error) {
                log.warn('textureAtlas', `the atlas cannot be drawn again after the device came back: ${String(error)}`);
            }
        });

        return {
            texture: rt.texture,
            width: layout.width,
            height: layout.height,
            get: (source) => entries.get(source),
            sprite: (source) => {
                const e = entries.get(source);
                if (!e) throw new Error(`texture handle ${source} is not on this atlas`);
                return { texture: rt.texture, uvOffset: { ...e.uvOffset }, uvScale: { ...e.uvScale } };
            },
            repaint,
            release: () => {
                unsubscribe();
                RenderTexture.release(rt);
            },
        };
    },
};
