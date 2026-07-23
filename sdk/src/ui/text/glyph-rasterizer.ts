// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/glyph-rasterizer.ts
 * @brief   Canvas2D glyph rasterizer → SDF, the real GlyphRasterizer for the
 *          dynamic atlas. Works on web AND WeChat (both expose
 *          a 2D canvas + getImageData; the legacy text path already relied on
 *          this). Any font / CJK / emoji, since glyphs are drawn on demand.
 *
 * Testability: the Canvas2D draw/measure is a platform stub under happy-dom, so
 * rasterize() is verified at render time. The pure pixel transforms
 * (extractAlpha, sdfToAtlasRgba) + the C++ sdfFromAlpha are unit-tested.
 */
import type { ESEngineModule } from '../../wasm';
import { platformCreateCanvas } from '../../platform';
import type { PlatformCanvas, PlatformCanvas2DContext } from '../../platform/types';
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

/**
 * Box-downsample a byte grid by an integer factor. Folds a supersampled SDF
 * back to the stored resolution; averaging the linearly encoded field keeps
 * the sub-texel edge accuracy. Pure.
 */
export function downsampleBytes(src: Uint8Array, width: number, height: number, factor: number): Uint8Array {
    if (factor <= 1) return src;
    const w = Math.floor(width / factor);
    const h = Math.floor(height / factor);
    const out = new Uint8Array(w * h);
    const area = factor * factor;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            const sy0 = y * factor;
            const sx0 = x * factor;
            for (let sy = 0; sy < factor; sy++) {
                const row = (sy0 + sy) * width + sx0;
                for (let sx = 0; sx < factor; sx++) sum += src[row + sx];
            }
            out[y * w + x] = Math.round(sum / area);
        }
    }
    return out;
}

export interface CanvasGlyphRasterizerOptions {
    /** Size glyphs are rasterized at (SDF is resolution-independent). Default 48. */
    renderSize?: number;
    /** SDF spread / padding around the glyph ink, in px. Default 6. */
    padding?: number;
    /** Produce an SDF (scalable) vs a plain-alpha bitmap (native AA). Default true. */
    sdf?: boolean;
}

type Canvas2D = PlatformCanvas;
type Ctx2D = PlatformCanvas2DContext;

// SDF supersampling: rasterize + distance-transform at 4× the stored
// resolution, then box-downsample — magnified glyphs stop showing the source
// grid as edge wobble. One-time per glyph; atlas memory is unchanged.
const SDF_SUPERSAMPLE = 4;

export class CanvasGlyphRasterizer implements GlyphRasterizer {
    readonly renderSize: number;
    private readonly module: ESEngineModule;
    private readonly pad: number;
    private readonly sdf: boolean;
    private readonly canvas: Canvas2D;
    private readonly ctx: Ctx2D | null;

    constructor(module: ESEngineModule, opts: CanvasGlyphRasterizerOptions = {}) {
        this.module = module;
        this.renderSize = opts.renderSize ?? 48;
        this.pad = opts.padding ?? 6;
        this.sdf = opts.sdf ?? true;
        // Scratch canvas sized for the largest glyph (em + ascenders + padding),
        // at supersampled resolution on the SDF path.
        const ss = this.sdf ? SDF_SUPERSAMPLE : 1;
        const dim = Math.ceil((this.renderSize * 2 + this.pad * 2) * ss);
        this.canvas = platformCreateCanvas(dim, dim);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    rasterize(codepoint: number, fontFamily: string, style: number, pixelSize = this.renderSize): RasterGlyph | null {
        const ctx = this.ctx;
        if (!ctx) return null;
        const ch = String.fromCodePoint(codepoint);

        // All drawing happens at ss× the requested size; metrics divide back
        // down, gaining sub-px accuracy from the larger measurement.
        const ss = this.sdf ? SDF_SUPERSAMPLE : 1;
        const weight = (style & FONT_STYLE_BOLD) ? 'bold ' : '';
        const italic = (style & FONT_STYLE_ITALIC) ? 'italic ' : '';
        ctx.font = `${italic}${weight}${pixelSize * ss}px ${fontFamily}`;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';

        const m = ctx.measureText(ch);
        const advanceSS = m.width;
        const leftSS = m.actualBoundingBoxLeft ?? 0;
        const rightSS = m.actualBoundingBoxRight ?? advanceSS;
        const ascentSS = m.actualBoundingBoxAscent ?? pixelSize * ss * 0.8;
        const descentSS = m.actualBoundingBoxDescent ?? pixelSize * ss * 0.2;

        // Ink box in *stored* texels (rounded up so the ss grid tiles exactly).
        const inkW = Math.ceil((leftSS + rightSS) / ss);
        const inkH = Math.ceil((ascentSS + descentSS) / ss);
        if (inkW <= 0 || inkH <= 0) {
            // Whitespace: advance only, no atlas cell.
            return { pixels: new Uint8Array(0), width: 0, height: 0, advance: advanceSS / ss, bearingX: 0, bearingY: 0 };
        }

        const pad = this.pad;
        const w = inkW + pad * 2;
        const h = inkH + pad * 2;
        const wSS = w * ss;
        const hSS = h * ss;
        if (wSS > this.canvas.width || hSS > this.canvas.height) return null; // glyph too large for scratch

        ctx.clearRect(0, 0, wSS, hSS);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(ch, pad * ss + leftSS, pad * ss + ascentSS);

        const img = ctx.getImageData(0, 0, wSS, hSS);
        const alpha = extractAlpha(img.data, wSS, hSS);
        // SDF: distance-transform at ss× (spread scales with ss, so the folded
        // encoding matches spread = pad exactly). Bitmap: native-AA coverage as-is.
        let coverage = alpha;
        if (this.sdf) {
            const sdf = sdfFromAlpha(this.module, alpha, wSS, hSS, pad * ss);
            if (!sdf) return null;
            coverage = downsampleBytes(sdf, wSS, hSS, ss);
        }

        return {
            pixels: sdfToAtlasRgba(coverage, w, h),
            width: w,
            height: h,
            advance: advanceSS / ss,
            // Drawn at pen x = (pad + left) (ink lands at tile x = pad), so the
            // pen origin maps back to tile x = 0 at -(left + pad).
            bearingX: -(leftSS / ss + pad),
            bearingY: ascentSS / ss + pad,
        };
    }
}
