/**
 * @file    ui/text/glyph-atlas.ts
 * @brief   Runtime dynamic glyph atlas (REARCH_GUI P1) — the cache + multi-page
 *          packer that turns "I need glyph X" into "here is its atlas rectangle".
 *
 * Design: the atlas is SDF-agnostic. It deals only in upload-ready bitmaps; the
 * injected {@link GlyphRasterizer} owns rasterization AND any SDF conversion, and
 * the injected {@link AtlasPageStore} owns the GPU texture pages. Both are
 * interfaces so the orchestration is unit-testable (mock both) and the real
 * Canvas2D + engine implementations stay thin and swappable (e.g. a plain-alpha
 * rasterizer fallback per REARCH_GUI §7.6).
 *
 * Because SDF is resolution-independent, each glyph is rasterized ONCE at a fixed
 * `sdfRenderSize`; the display size scales the quad at draw time. The cache key
 * therefore carries no display size — only (font, codepoint, style).
 */
import { ShelfPacker, type Packer } from './atlas-packer';

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
    /**
     * Render one glyph to an upload-ready bitmap + metrics, or null if the glyph
     * cannot be produced (unknown codepoint / no font).
     */
    rasterize(codepoint: number, fontFamily: string, style: number): RasterGlyph | null;
}

export interface AtlasPageStore {
    /** Allocate a blank `size`×`size` page; return an opaque page id (e.g. a texture handle). */
    createPage(size: number): number;
    /** Upload `pixels` into the [x,y,w,h] sub-rect of page `pageId`. */
    uploadSubRegion(pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array): void;
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
}

const STYLE_COUNT_HINT = 4;  // plain / bold / italic / bold-italic — for key spread only

/**
 * Caches glyphs into one or more atlas pages, rasterizing on first use.
 */
export class GlyphAtlas {
    private readonly pageSize: number;
    private readonly padding: number;
    private readonly cache = new Map<string, GlyphEntry | null>();
    private readonly pages: number[] = [];
    private readonly packers: Packer[] = [];

    constructor(
        private readonly rasterizer: GlyphRasterizer,
        private readonly store: AtlasPageStore,
        opts: GlyphAtlasOptions = {},
    ) {
        this.pageSize = opts.pageSize ?? 1024;
        this.padding = opts.padding ?? 1;
    }

    /** Number of atlas pages currently allocated. */
    get pageCount(): number { return this.pages.length; }

    /** The px size glyphs are rasterized at; layout scales by displaySize/renderSize. */
    get renderSize(): number { return this.rasterizer.renderSize; }

    private key(codepoint: number, fontFamily: string, style: number): string {
        return `${fontFamily}|${codepoint}|${style % STYLE_COUNT_HINT}`;
    }

    /**
     * Get a glyph's atlas entry, rasterizing + packing it on first use. Returns
     * null for glyphs the rasterizer cannot produce (caller skips / uses fallback).
     * The result is cached (including the null), so a miss is paid once.
     */
    getGlyph(codepoint: number, fontFamily: string, style = 0): GlyphEntry | null {
        const k = this.key(codepoint, fontFamily, style);
        const hit = this.cache.get(k);
        if (hit !== undefined) return hit;

        const raster = this.rasterizer.rasterize(codepoint, fontFamily, style);
        if (!raster) {
            this.cache.set(k, null);
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
            this.cache.set(k, entry);
            return entry;
        }

        const placed = this.place(raster.width, raster.height);
        if (!placed) {
            // Glyph larger than a whole page — cannot atlas it. Cache null.
            this.cache.set(k, null);
            return null;
        }

        this.store.uploadSubRegion(placed.pageId, placed.x, placed.y, raster.width, raster.height, raster.pixels);

        const inv = 1 / this.pageSize;
        const entry: GlyphEntry = {
            pageId: placed.pageId,
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

    /** Reserve a w×h cell across pages, opening a new page when the last is full. */
    private place(w: number, h: number): { pageId: number; x: number; y: number } | null {
        const cellW = w + this.padding;
        const cellH = h + this.padding;
        if (cellW > this.pageSize || cellH > this.pageSize) return null;

        if (this.packers.length === 0) this.addPage();

        for (let attempt = 0; attempt < 2; attempt++) {
            const pi = this.packers.length - 1;
            const pos = this.packers[pi].pack(cellW, cellH);
            if (pos) return { pageId: this.pages[pi], x: pos.x, y: pos.y };
            // Current page full → open a fresh one and retry once.
            this.addPage();
        }
        return null;
    }

    private addPage(): void {
        const pageId = this.store.createPage(this.pageSize);
        this.pages.push(pageId);
        this.packers.push(new ShelfPacker(this.pageSize, this.pageSize));
    }
}
