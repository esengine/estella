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
    createPage(size: number, paint: (pixels: Uint8Array) => void): number;
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

const STYLE_COUNT_HINT = 4;  // plain / bold / italic / bold-italic — for key spread only

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
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Caches glyphs into one or more atlas pages, rasterizing on first use.
 */
export class GlyphAtlas {
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
        return this.sdf
            ? this.renderSize
            : Math.max(1, Math.round(displaySize * this.dpr * this.contentScale_));
    }

    /** Reported families with non-drawable glyphs still in the bounded CPU cache. */
    private readonly mute_ = new Set<string>();

    private key(codepoint: number, fontFamily: string, style: number, pixelSize: number): string {
        return `${fontFamily}|${codepoint}|${style % STYLE_COUNT_HINT}|${pixelSize}`;
    }

    /**
     * Get a glyph's atlas entry, rasterizing + packing it on first use. Returns
     * null for glyphs the rasterizer cannot produce (caller skips / uses fallback).
     * Drawable entries follow page lifetime; page-free entries use a bounded LRU.
     */
    getGlyph(codepoint: number, fontFamily: string, style = 0, pixelSize = this.renderSize): GlyphEntry | null {
        // A bitmap font is its own atlas: the glyph is already on a page the engine holds.
        if (bitmapFontOf(fontFamily)) return bitmapGlyph(fontFamily, codepoint);
        const k = this.key(codepoint, fontFamily, style, pixelSize);
        const hit = this.cache.get(k);
        if (hit !== undefined) return hit;
        const cpuHit = this.cpuCache.get(k);
        if (cpuHit !== undefined) {
            this.cpuCache.delete(k);
            this.cpuCache.set(k, cpuHit);
            return cpuHit;
        }

        const raster = this.rasterizer.rasterize(codepoint, fontFamily, style, pixelSize);
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
            codepoint, fontFamily, style, pixelSize,
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
        };
        this.cache.set(k, entry);
        return entry;
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
        this.pages.push(this.store.createPage(this.pageSize, (pixels) => this.paintPage(glyphs, pixels)));
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
            const raster = this.rasterizer.rasterize(g.codepoint, g.fontFamily, g.style, g.pixelSize);
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
