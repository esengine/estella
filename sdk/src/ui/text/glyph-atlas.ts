// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/glyph-atlas.ts
 * @brief   Runtime dynamic glyph atlas — the cache + multi-page
 *          packer that turns "I need glyph X" into "here is its atlas rectangle".
 *
 * Design: the atlas is SDF-agnostic. It deals only in upload-ready bitmaps; the
 * injected {@link GlyphRasterizer} owns rasterization AND any SDF conversion, and
 * the injected {@link AtlasPageStore} owns the GPU texture pages. Both are
 * interfaces so the orchestration is unit-testable (mock both) and the real
 * Canvas2D + engine implementations stay thin and swappable (e.g. a plain-alpha
 * rasterizer fallback).
 *
 * Because SDF is resolution-independent, each glyph is rasterized ONCE at a fixed
 * `sdfRenderSize`; the display size scales the quad at draw time. The cache key
 * therefore carries no display size — only (font, codepoint, style).
 */
import { ShelfPacker, type Packer } from '../../util/shelfPack';
import { log } from '../../util/logger';
import { bitmapFontOf, bitmapGlyph } from './bitmap-font';
import { UI_TEXT_TABULAR } from './text-transform';

/** A glyph rendered to an upload-ready bitmap plus its layout metrics (in render-size px). */
export interface RasterGlyph {
    /** Upload-ready pixels matching the atlas page format (RGBA8), row-major. Empty for whitespace. */
    pixels: Uint8Array;
    /** Bitmap size in texels (0 for whitespace — no atlas cell is allocated). */
    width: number;
    height: number;
    /** Pen advance after this glyph. */
    advance: number;
    /** Offset from the pen origin to the bitmap's left / top (top-left origin). */
    bearingX: number;
    bearingY: number;
}

/** A figure spaced as a tabular one: advanced by the widest figure's width and centred in that cell. Pure. */
export function tabularFigure(glyph: RasterGlyph, widest: number): RasterGlyph {
    if (!(widest > glyph.advance)) return glyph;
    const shift = (widest - glyph.advance) / 2;
    return { ...glyph, advance: widest, bearingX: glyph.bearingX + shift };
}

export interface GlyphRasterizer {
    /** The size glyphs are rasterized at; metrics are in these units. */
    readonly renderSize: number;
    /** SDF spread in rasterized texels — the distance one half of the encoded
     *  range covers. 0 when the glyphs are plain coverage, not a distance field. */
    readonly spread: number;
    /**
     * Render one glyph to an upload-ready bitmap + metrics, or null if the glyph
     * cannot be produced (unknown codepoint / no font). `pixelSize` overrides the
     * rasterization size (bitmap mode rasterizes per display size); omitted → the
     * rasterizer's default renderSize.
     */
    rasterize(codepoint: number, fontFamily: string, style: number, pixelSize?: number): RasterGlyph | null;
}

export interface AtlasPageStore {
    /**
     * Allocate a blank `size`×`size` page; return an opaque page id (e.g. a texture
     * handle). `paint` draws every glyph placed on the page so far into a blank
     * page-sized RGBA buffer — how a page that lost its pixels gets them back.
     */
    createPage(size: number, paint: (pixels: Uint8Array) => void, distance?: boolean): number;
    /** Upload `pixels` into the [x,y,w,h] sub-rect of page `pageId`. */
    uploadSubRegion(pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array): void;
    /** Release an owned page. Optional for stores whose page lifetime is external. */
    releasePage?(pageId: number): void;
}

/** A cached glyph's atlas location (normalized UVs) + metrics. */
export interface GlyphEntry {
    pageId: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    width: number;
    height: number;
    advance: number;
    bearingX: number;
    bearingY: number;
    scale?: number;
}

export interface GlyphAtlasOptions {
    /** Page texture size in texels (square). Default 1024. */
    pageSize?: number;
    /** Gutter between glyphs to prevent bilinear bleed. Default 1. */
    padding?: number;
    /** SDF (one fixed source, scalable) vs bitmap (per-size, device density). Default true. */
    sdf?: boolean;
    /** Device pixel ratio for bitmap per-size rasterization. Default 1. */
    dpr?: number;
}

/** Numeric glyph/style/size suffixes leave the complete family prefix intact. */
function familyFromKey(key: string): string {
    let end = key.length;
    for (let i = 0; i < 3; i++) end = key.lastIndexOf('|', end - 1);
    return key.slice(0, end);
}

/** What a page's cell holds: enough to rasterize the glyph again into the same place. */
interface GlyphPlacement {
    codepoint: number;
    fontFamily: string;
    style: number;
    pixelSize: number;
    outline: number;
    shadow?: GlyphShadow;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GlyphShadow {
    key: string;
    taps: ReadonlyArray<readonly [number, number]>;
    strength: number;
    downsample: number;
}

/** Which glyph an entry is, for an atlas that has to produce a variant of it. */
interface GlyphIdentity {
    codepoint: number;
    fontFamily: string;
    style: number;
    pixelSize: number;
}

const DILATE_LEVELS = [1, 32, 64, 96, 128, 160, 192, 224, 255];

/**
 * Grow a coverage glyph by @p radius texels: every texel takes the strongest
 * coverage within the radius, faded over its last texel so the ring's edge is
 * antialiased like the glyph's own. The tile gains `margin` texels on every side
 * for the ring to grow into. Pure.
 *
 * This is the outline a coverage glyph can have. A distance-field glyph is grown
 * by moving the edge the shader reads (see text-renderer outlineBias); a coverage
 * one has no distance to move, and stamping copies of it around a circle draws
 * the glyph several times rather than drawing a ring — fine for a hairline, eight
 * ghosts at the widths a game label asks for.
 */
export function dilateCoverage(alpha: Uint8Array, width: number, height: number, radius: number): {
    alpha: Uint8Array; width: number; height: number; margin: number;
} {
    const r = Math.max(0, radius);
    const margin = Math.ceil(r) + 1;
    const w = width + margin * 2;
    const h = height + margin * 2;
    const out = new Uint8Array(w * h);
    const size = w * h;
    const nearestRow = new Int32Array(size);
    const inkX = new Int32Array(w);
    const inkY = new Int32Array(w);
    const hull = new Int32Array(w);
    const hullStart = new Float64Array(w + 1);
    const none = 2 * (w + h);
    for (const level of DILATE_LEVELS) {
        for (let x = 0; x < w; x++) {
            let row = -none;
            for (let y = 0; y < h; y++) {
                const sx = x - margin, sy = y - margin;
                if (sx >= 0 && sy >= 0 && sx < width && sy < height && alpha[sy * width + sx] >= level) row = y;
                nearestRow[y * w + x] = row;
            }
            row = none + h;
            for (let y = h - 1; y >= 0; y--) {
                const sx = x - margin, sy = y - margin;
                if (sx >= 0 && sy >= 0 && sx < width && sy < height && alpha[sy * width + sx] >= level) row = y;
                const above = nearestRow[y * w + x];
                if (row - y < y - above) nearestRow[y * w + x] = row;
            }
        }
        for (let y = 0; y < h; y++) {
            const line = y * w;
            let top = -1;
            for (let x = 0; x < w; x++) {
                const row = nearestRow[line + x];
                const dy = y - row;
                if (Math.abs(dy) >= none) continue;
                const f = x * x + dy * dy;
                let start = 0;
                while (top >= 0) {
                    const q = hull[top];
                    const qy = y - nearestRow[line + q];
                    start = (f - (q * q + qy * qy)) / (2 * (x - q));
                    if (start > hullStart[top]) break;
                    top--;
                }
                top++;
                hull[top] = x;
                hullStart[top] = top === 0 ? -Infinity : start;
            }
            if (top < 0) continue;
            let at = 0;
            for (let x = 0; x < w; x++) {
                while (at < top && hullStart[at + 1] <= x) at++;
                inkX[x] = hull[at];
                inkY[x] = nearestRow[line + hull[at]];
            }
            for (let x = 0; x < w; x++) {
                const weight = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x - inkX[x], y - inkY[x])));
                if (weight <= 0) continue;
                const v = alpha[(inkY[x] - margin) * width + inkX[x] - margin] * weight + 0.5;
                if (v > out[line + x]) out[line + x] = v;
            }
        }
    }
    return { alpha: out, width: w, height: h, margin };
}

/** A coverage tile grown into its outline, in the atlas's RGBA format (RGB 255, A coverage). */
function outlineRaster(raster: RasterGlyph, radius: number): RasterGlyph {
    const n = raster.width * raster.height;
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) alpha[i] = raster.pixels[i * 4 + 3];
    const grown = dilateCoverage(alpha, raster.width, raster.height, radius);
    const pixels = new Uint8Array(grown.width * grown.height * 4);
    for (let i = 0; i < grown.alpha.length; i++) {
        const o = i * 4;
        pixels[o] = 255; pixels[o + 1] = 255; pixels[o + 2] = 255; pixels[o + 3] = grown.alpha[i];
    }
    return {
        pixels, width: grown.width, height: grown.height, advance: raster.advance,
        bearingX: raster.bearingX - grown.margin, bearingY: raster.bearingY + grown.margin,
    };
}

export function shadowRaster(raster: RasterGlyph, taps: ReadonlyArray<readonly [number, number]>, strength: number): RasterGlyph {
    let reach = 0;
    for (const [x, y] of taps) reach = Math.max(reach, Math.abs(x), Math.abs(y));
    const margin = Math.ceil(reach) + 1;
    const sw = raster.width, sh = raster.height;
    const w = sw + margin * 2, h = sh + margin * 2;
    const coverage = new Float32Array((sw + 2) * (sh + 2));
    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) coverage[(y + 1) * (sw + 2) + x + 1] = raster.pixels[(y * sw + x) * 4 + 3] / 255;
    }
    const at = (x: number, y: number): number => (x < -1 || y < -1 || x > sw || y > sh) ? 0 : coverage[(y + 1) * (sw + 2) + x + 1];
    const sum = new Float32Array(w * h);
    for (const [ox, oy] of taps) {
        const fx = -margin - ox, fy = -margin + oy;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        for (let y = 0; y < h; y++) {
            const sy = y + iy;
            if (sy < -1 || sy > sh) continue;
            for (let x = 0; x < w; x++) {
                const sx = x + ix;
                if (sx < -1 || sx > sw) continue;
                sum[y * w + x] += at(sx, sy) * w00 + at(sx + 1, sy) * w10 + at(sx, sy + 1) * w01 + at(sx + 1, sy + 1) * w11;
            }
        }
    }
    const a = Math.min(0.999, Math.max(0.001, strength));
    const clear = Math.log(1 - a);
    const pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const m = taps.length > 0 ? sum[i] / taps.length : 0;
        const o = i * 4;
        pixels[o] = 255; pixels[o + 1] = 255; pixels[o + 2] = 255;
        pixels[o + 3] = Math.round(Math.min(1, (1 - Math.exp(clear * m)) / a) * 255);
    }
    return { pixels, width: w, height: h, advance: raster.advance, bearingX: raster.bearingX - margin, bearingY: raster.bearingY + margin };
}

export function distanceShadowRaster(raster: RasterGlyph, spread: number, taps: ReadonlyArray<readonly [number, number]>,
                                     strength: number, downsample: number): RasterGlyph {
    const f = Math.max(1, Math.round(downsample));
    const w = Math.ceil(raster.width / f), h = Math.ceil(raster.height / f);
    const pixels = new Uint8Array(w * h * 4);
    const reach = Math.max(spread, 1e-3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let sy = y * f; sy < Math.min(raster.height, (y + 1) * f); sy++) {
                for (let sx = x * f; sx < Math.min(raster.width, (x + 1) * f); sx++) {
                    const d = (raster.pixels[(sy * raster.width + sx) * 4 + 3] - 128) / 128 * reach;
                    sum += Math.min(1, Math.max(0, 0.5 + d / f));
                }
            }
            pixels[(y * w + x) * 4 + 3] = Math.round(sum / (f * f) * 255);
        }
    }
    const small: RasterGlyph = { pixels, width: w, height: h, advance: raster.advance, bearingX: raster.bearingX / f, bearingY: raster.bearingY / f };
    const cell = shadowRaster(small, taps.map(([x, y]) => [x / f, y / f] as const), strength);
    return { ...cell, advance: raster.advance, bearingX: cell.bearingX * f, bearingY: cell.bearingY * f };
}

/**
 * Caches glyphs into one or more atlas pages, rasterizing on first use.
 */
export class GlyphAtlas {
    /** Which glyph each placed entry is — what an outline of it is grown from. */
    private readonly identity_ = new WeakMap<GlyphEntry, GlyphIdentity>();
    private readonly pageSize: number;
    private readonly padding: number;
    private readonly sdf: boolean;
    private dpr: number;
    private contentScale_ = 1;
    private generation_ = 0;
    private readonly cache = new Map<string, GlyphEntry>();
    private readonly cpuCache = new Map<string, GlyphEntry | null>();
    private readonly missingCounts_ = new Map<string, number>();
    private readonly pages: number[] = [];
    private readonly packers: Packer[] = [];
    private readonly placements: GlyphPlacement[][] = [];

    constructor(
        private readonly rasterizer: GlyphRasterizer,
        private readonly store: AtlasPageStore | null,
        opts: GlyphAtlasOptions = {},
    ) {
        this.pageSize = opts.pageSize ?? 1024;
        this.padding = opts.padding ?? 1;
        this.sdf = opts.sdf ?? true;
        const dpr = opts.dpr ?? 1;
        this.dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    }

    /** A null store keeps metrics in CPU memory without drawable atlas pages. */
    get metricsOnly(): boolean { return this.store === null; }

    /** Number of atlas pages currently allocated. */
    get pageCount(): number { return this.pages.length; }

    /** Release all pages and cached glyphs; repeated cleanup has no effect. */
    dispose(): void {
        const pages = this.pages.splice(0);
        this.packers.length = 0;
        this.placements.length = 0;
        this.cache.clear();
        this.cpuCache.clear();
        this.missingCounts_.clear();
        this.mute_.clear();
        this.generation_++;
        const errors: unknown[] = [];
        for (const page of pages) {
            try { this.store?.releasePage?.(page); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new Error(`Failed to release glyph atlas pages: ${errors.map(String).join('; ')}`);
    }

    /** Release pages not referenced by retained layouts, at a submitted-frame boundary. */
    retainPages(live: ReadonlySet<number>): void {
        const removed = new Set<number>();
        for (let i = this.pages.length - 1; i >= 0; i--) {
            if (live.has(this.pages[i])) continue;
            removed.add(this.pages[i]);
            this.pages.splice(i, 1);
            this.packers.splice(i, 1);
            this.placements.splice(i, 1);
        }
        if (removed.size === 0) return;
        for (const [key, glyph] of this.cache) {
            if (glyph && removed.has(glyph.pageId)) this.cache.delete(key);
        }
        const errors: unknown[] = [];
        for (const page of removed) {
            try { this.store?.releasePage?.(page); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new Error(`Failed to release unused glyph pages: ${errors.map(String).join('; ')}`);
    }

    /**
     * Bumped only when a change can alter the atlas coordinates of glyphs that
     * are already placed — i.e. a bitmap density change (glyphs re-rasterize
     * at a new pixel size). Placement is append-only, so adding a *new* glyph never
     * moves an existing one; callers cache laid-out geometry against this counter.
     */
    get generation(): number { return this.generation_; }

    /** The px size glyphs are rasterized at; layout scales by displaySize/renderSize. */
    get renderSize(): number { return this.rasterizer.renderSize; }

    /** Distance units per rasterized texel, or 0 when these glyphs carry coverage
     *  rather than a distance field. What turns an outline width in text px into
     *  the edge shift the shader applies. */
    get distancePerTexel(): number {
        const spread = this.rasterizer.spread;
        return this.sdf && spread > 0 ? 0.5 / spread : 0;
    }

    /**
     * On-screen device px per design px beyond DPR (the canvas design fit).
     * Bitmap glyphs fold it into the rasterization size so they land 1:1 on
     * screen pixels, hinted at the final size; integer rounding in
     * pixelSizeFor dedupes near-equal scales.
     */
    setContentScale(scale: number): void {
        const next = Number.isFinite(scale) && scale > 0 ? scale : 1;
        if (next !== this.contentScale_) {
            this.contentScale_ = next;
            this.generation_++;
        }
    }

    /** Refresh bitmap density without retiring pages still owned by submitted layouts. */
    setDevicePixelRatio(dpr: number): void {
        if (this.sdf) return;
        const next = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
        if (next !== this.dpr) {
            this.dpr = next;
            this.generation_++;
        }
    }

    /** Rasterization size for a display size: SDF uses one fixed source;
     *  bitmap rasterizes per size at the effective on-screen density. */
    pixelSizeFor(displaySize: number, fontFamily?: string): number {
        // A bitmap font has one size: the one it was drawn at, which the layout scales from.
        const bitmap = fontFamily === undefined ? null : bitmapFontOf(fontFamily);
        if (bitmap) return bitmap.size;
        if (this.sdf) return this.renderSize;
        const wanted = Math.max(1, Math.round(displaySize * this.dpr * this.contentScale_));
        const cap = this.pageSize >> 1;
        if (wanted <= cap) return wanted;
        if (!this.warnedOversize_) {
            this.warnedOversize_ = true;
            log.warn('text', `A bitmap glyph asked for ${wanted} px, more than an atlas page holds; drawn from ${cap} px. Text this large on screen reads better with renderMode Sdf.`);
        }
        return cap;
    }

    private warnedOversize_ = false;

    /** Reported families with non-drawable glyphs still in the bounded CPU cache. */
    private readonly mute_ = new Set<string>();

    /** Widest figure advance by family, style and size: what tabular figures are spaced to. */
    private readonly figureWidths_ = new Map<string, number>();

    private key(codepoint: number, fontFamily: string, style: number, pixelSize: number, outline = 0, shadow?: GlyphShadow): string {
        const size = shadow ? `${pixelSize}s${shadow.key}` : outline > 0 ? `${pixelSize}o${outline}` : `${pixelSize}`;
        // The whole style: a weight or tabular figures are another glyph as much as bold is.
        return `${fontFamily}|${codepoint}|${style}|${size}`;
    }

    /**
     * Get a glyph's atlas entry, rasterizing + packing it on first use. Returns
     * null for glyphs the rasterizer cannot produce (caller skips / uses fallback).
     * Drawable entries follow page lifetime; page-free entries use a bounded LRU.
     */
    getGlyph(codepoint: number, fontFamily: string, style = 0, pixelSize = this.renderSize): GlyphEntry | null {
        // A bitmap font is its own atlas: the glyph is already on a page the engine holds.
        if (bitmapFontOf(fontFamily)) return bitmapGlyph(fontFamily, codepoint);
        return this.glyph_({ codepoint, fontFamily, style, pixelSize }, 0);
    }

    /**
     * @p entry's glyph grown by @p radius rasterized px — the shape its outline
     * is drawn with, in one pass, on an atlas of coverage glyphs. Placed and cached
     * like the glyph itself (one cell per glyph, size and radius), with metrics in
     * the same units: its box is the glyph's, `margin` larger on every side.
     *
     * Null on a distance-field atlas (the shader grows those, see outlineBias), for
     * a glyph this atlas did not place (a bitmap font's), and when the glyph cannot
     * be produced — the caller keeps its own fallback for all three.
     */
    outlined(entry: GlyphEntry, radius: number): GlyphEntry | null {
        if (this.sdf || !(radius > 0)) return null;
        const id = this.identity_.get(entry);
        if (!id) return null;
        return this.glyph_(id, radius);
    }

    shadowed(entry: GlyphEntry, shadow: GlyphShadow): GlyphEntry | null {
        if (shadow.taps.length === 0) return null;
        const id = this.identity_.get(entry);
        if (!id) return null;
        return this.glyph_(id, 0, shadow);
    }

    private glyph_(id: GlyphIdentity, outline: number, shadow?: GlyphShadow): GlyphEntry | null {
        const { codepoint, fontFamily, style, pixelSize } = id;
        const k = this.key(codepoint, fontFamily, style, pixelSize, outline, shadow);
        const hit = this.cache.get(k);
        if (hit !== undefined) return hit;
        const cpuHit = this.cpuCache.get(k);
        if (cpuHit !== undefined) {
            this.cpuCache.delete(k);
            this.cpuCache.set(k, cpuHit);
            return cpuHit;
        }

        const raster = this.raster_(codepoint, fontFamily, style, pixelSize, outline, shadow);
        if (!raster) {
            // Cached non-drawable glyphs own their family's diagnostic suppression.
            this.cacheCPU(k, null);
            if (!this.mute_.has(fontFamily)) {
                this.mute_.add(fontFamily);
                log.warn('text', `no glyph for U+${codepoint.toString(16).toUpperCase()} in `
                    + `"${fontFamily}" — this character has no drawable glyph`);
            }
            return null;
        }

        // Whitespace (no bitmap): cache an advance-only entry, no atlas cell.
        if (raster.width <= 0 || raster.height <= 0) {
            const entry: GlyphEntry = {
                pageId: this.pages.length > 0 ? this.pages[0] : -1,
                u0: 0, v0: 0, u1: 0, v1: 0,
                width: 0, height: 0,
                advance: raster.advance, bearingX: raster.bearingX, bearingY: raster.bearingY,
            };
            this.cacheCPU(k, entry);
            return entry;
        }

        if (!this.store) {
            if (raster.width + this.padding > this.pageSize || raster.height + this.padding > this.pageSize) {
                this.cacheCPU(k, null);
                return null;
            }
            const entry: GlyphEntry = {
                pageId: -1, u0: 0, v0: 0, u1: 0, v1: 0,
                width: raster.width, height: raster.height,
                advance: raster.advance, bearingX: raster.bearingX, bearingY: raster.bearingY,
            };
            this.cacheCPU(k, entry);
            return entry;
        }

        const placed = this.place(raster.width, raster.height);
        if (!placed) {
            // Glyph larger than a whole page — cannot atlas it. Cache null.
            this.cacheCPU(k, null);
            return null;
        }

        const pageId = this.pages[placed.page];
        this.store.uploadSubRegion(pageId, placed.x, placed.y, raster.width, raster.height, raster.pixels);
        this.placements[placed.page].push({
            codepoint, fontFamily, style, pixelSize, outline, shadow,
            x: placed.x, y: placed.y, width: raster.width, height: raster.height,
        });

        const inv = 1 / this.pageSize;
        const entry: GlyphEntry = {
            pageId,
            u0: placed.x * inv,
            v0: placed.y * inv,
            u1: (placed.x + raster.width) * inv,
            v1: (placed.y + raster.height) * inv,
            width: raster.width,
            height: raster.height,
            advance: raster.advance,
            bearingX: raster.bearingX,
            bearingY: raster.bearingY,
            ...(shadow ? { scale: Math.max(1, Math.round(shadow.downsample)) } : {}),
        };
        this.cache.set(k, entry);
        if (outline === 0 && !shadow) this.identity_.set(entry, id);
        return entry;
    }

    private raster_(codepoint: number, fontFamily: string, style: number, pixelSize: number,
                    outline: number, shadow?: GlyphShadow): RasterGlyph | null {
        // Tabular figures are a spacing, not a shape: drawn as the plain glyph, then widened to the widest figure's advance and
        // centred in it. Done here, every layout that measures advances gets it, and a rasterizer never sees the bit.
        const drawn = style & ~UI_TEXT_TABULAR;
        const plain = this.rasterizer.rasterize(codepoint, fontFamily, drawn, pixelSize);
        const raster = plain && (style & UI_TEXT_TABULAR) && codepoint >= 0x30 && codepoint <= 0x39
            ? tabularFigure(plain, this.widestFigure_(fontFamily, drawn, pixelSize))
            : plain;
        if (!raster || raster.width <= 0 || raster.height <= 0) return raster;
        if (shadow) {
            return this.sdf && this.rasterizer.spread > 0
                ? distanceShadowRaster(raster, this.rasterizer.spread, shadow.taps, shadow.strength, shadow.downsample)
                : shadowRaster(raster, shadow.taps, shadow.strength);
        }
        if (outline <= 0) return raster;
        return outlineRaster(raster, outline);
    }

    /** The advance of the widest of the ten figures at this family, style and size, measured once. */
    private widestFigure_(fontFamily: string, style: number, pixelSize: number): number {
        const key = `${fontFamily}|${style}|${pixelSize}`;
        let widest = this.figureWidths_.get(key);
        if (widest === undefined) {
            widest = 0;
            for (let cp = 0x30; cp <= 0x39; cp++) widest = Math.max(widest, this.rasterizer.rasterize(cp, fontFamily, style, pixelSize)?.advance ?? 0);
            this.figureWidths_.set(key, widest);
        }
        return widest;
    }

    /** Page-free entries can be recreated without changing any live layout or UV. */
    private cacheCPU(key: string, glyph: GlyphEntry | null): void {
        const wasMissing = this.cpuCache.get(key) === null;
        this.cpuCache.set(key, glyph);
        if (glyph === null && !wasMissing) {
            const family = familyFromKey(key);
            this.missingCounts_.set(family, (this.missingCounts_.get(family) ?? 0) + 1);
        } else if (glyph !== null && wasMissing) this.releaseMissing(key);
        if (this.cpuCache.size > 4096) {
            const retired = this.cpuCache.keys().next().value!;
            const wasMissing = this.cpuCache.get(retired) === null;
            this.cpuCache.delete(retired);
            if (wasMissing) this.releaseMissing(retired);
        }
    }

    private releaseMissing(key: string): void {
        const family = familyFromKey(key);
        const count = this.missingCounts_.get(family)! - 1;
        if (count > 0) this.missingCounts_.set(family, count);
        else {
            this.missingCounts_.delete(family);
            this.mute_.delete(family);
        }
    }

    /** Reserve a w×h cell across pages, opening a new page when the last is full. */
    private place(w: number, h: number): { page: number; x: number; y: number } | null {
        const cellW = w + this.padding;
        const cellH = h + this.padding;
        if (cellW > this.pageSize || cellH > this.pageSize) return null;

        if (this.packers.length === 0) this.addPage();

        for (let attempt = 0; attempt < 2; attempt++) {
            const pi = this.packers.length - 1;
            const pos = this.packers[pi].pack(cellW, cellH);
            if (pos) return { page: pi, x: pos.x, y: pos.y };
            // Current page full → open a fresh one and retry once.
            this.addPage();
        }
        return null;
    }

    private addPage(): void {
        if (!this.store) throw new Error('Measurement atlases cannot allocate pages.');
        const glyphs: GlyphPlacement[] = [];
        this.placements.push(glyphs);
        this.pages.push(this.store.createPage(this.pageSize, (pixels) => this.paintPage(glyphs, pixels), this.sdf));
        this.packers.push(new ShelfPacker(this.pageSize, this.pageSize));
    }

    /**
     * Rasterizes a page's glyphs again into the cells they were packed into. A
     * glyph that now comes out larger (its font finished loading) is clipped to
     * its cell rather than drawn over a neighbour's.
     */
    private paintPage(glyphs: readonly GlyphPlacement[], pixels: Uint8Array): void {
        const size = this.pageSize;
        for (const g of glyphs) {
            const raster = this.raster_(g.codepoint, g.fontFamily, g.style, g.pixelSize, g.outline, g.shadow);
            if (!raster) continue;
            const width = Math.min(raster.width, g.width);
            const height = Math.min(raster.height, g.height);
            for (let row = 0; row < height; row++) {
                const from = row * raster.width * 4;
                pixels.set(raster.pixels.subarray(from, from + width * 4), ((g.y + row) * size + g.x) * 4);
            }
        }
    }
}
