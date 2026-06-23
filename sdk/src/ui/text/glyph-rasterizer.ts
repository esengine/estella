// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/glyph-rasterizer.ts
 * @brief   Canvas2D glyph rasterizer → SDF, the real GlyphRasterizer for the
 *          dynamic atlas (REARCH_GUI P1.3). Works on web AND WeChat (both expose
 *          a 2D canvas + getImageData; the legacy text path already relied on
 *          this). Any font / CJK / emoji, since glyphs are drawn on demand.
 *
 * Testability: the Canvas2D draw/measure is a platform stub under happy-dom, so
 * rasterize() is verified at render time. The pure pixel transforms
 * (extractAlpha, sdfToAtlasRgba) + the C++ sdfFromAlpha are unit-tested.
 */
import type { ESEngineModule } from '../../wasm';
import { platformCreateCanvas } from '../../platform';
import { sdfFromAlpha } from './sdf';
import type { GlyphRasterizer, RasterGlyph } from './glyph-atlas';

/** Style bit flags (match the atlas cache-key style argument). */
export const FONT_STYLE_BOLD = 1;
export const FONT_STYLE_ITALIC = 2;

/** Extract the alpha channel from an RGBA buffer into a tight width*height buffer. Pure. */
export function extractAlpha(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
    const n = width * height;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rgba[i * 4 + 3];
    return out;
}

/** Expand a single-channel SDF into an RGBA atlas tile (RGB = 255, A = sdf). Pure. */
export function sdfToAtlasRgba(sdf: Uint8Array, width: number, height: number): Uint8Array {
    const n = width * height;
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = sdf[i];
    }
    return out;
}

export interface CanvasGlyphRasterizerOptions {
    /** Size glyphs are rasterized at (SDF is resolution-independent). Default 48. */
    renderSize?: number;
    /** SDF spread / padding around the glyph ink, in px. Default 6. */
    padding?: number;
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class CanvasGlyphRasterizer implements GlyphRasterizer {
    readonly renderSize: number;
    private readonly module: ESEngineModule;
    private readonly pad: number;
    private readonly canvas: Canvas2D;
    private readonly ctx: Ctx2D | null;

    constructor(module: ESEngineModule, opts: CanvasGlyphRasterizerOptions = {}) {
        this.module = module;
        this.renderSize = opts.renderSize ?? 48;
        this.pad = opts.padding ?? 6;
        // Scratch canvas sized for the largest glyph (em + ascenders + padding).
        const dim = Math.ceil(this.renderSize * 2 + this.pad * 2);
        this.canvas = platformCreateCanvas(dim, dim);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as Ctx2D | null;
    }

    rasterize(codepoint: number, fontFamily: string, style: number): RasterGlyph | null {
        const ctx = this.ctx;
        if (!ctx) return null;
        const ch = String.fromCodePoint(codepoint);

        const weight = (style & FONT_STYLE_BOLD) ? 'bold ' : '';
        const italic = (style & FONT_STYLE_ITALIC) ? 'italic ' : '';
        ctx.font = `${italic}${weight}${this.renderSize}px ${fontFamily}`;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';

        const m = ctx.measureText(ch);
        const advance = m.width;
        const left = m.actualBoundingBoxLeft ?? 0;
        const right = m.actualBoundingBoxRight ?? advance;
        const ascent = m.actualBoundingBoxAscent ?? this.renderSize * 0.8;
        const descent = m.actualBoundingBoxDescent ?? this.renderSize * 0.2;

        const inkW = Math.ceil(left + right);
        const inkH = Math.ceil(ascent + descent);
        if (inkW <= 0 || inkH <= 0) {
            // Whitespace: advance only, no atlas cell.
            return { pixels: new Uint8Array(0), width: 0, height: 0, advance, bearingX: 0, bearingY: 0 };
        }

        const pad = this.pad;
        const w = inkW + pad * 2;
        const h = inkH + pad * 2;
        if (w > this.canvas.width || h > this.canvas.height) return null; // glyph too large for scratch

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(ch, pad + left, pad + ascent);

        const img = ctx.getImageData(0, 0, w, h);
        const alpha = extractAlpha(img.data, w, h);
        const sdf = sdfFromAlpha(this.module, alpha, w, h, pad);
        if (!sdf) return null;

        return {
            pixels: sdfToAtlasRgba(sdf, w, h),
            width: w,
            height: h,
            advance,
            bearingX: left - pad,    // bitmap left relative to the pen origin
            bearingY: ascent + pad,  // bitmap top above the baseline
        };
    }
}
