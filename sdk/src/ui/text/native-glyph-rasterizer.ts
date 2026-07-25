// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/native-glyph-rasterizer.ts
 * @brief   The platform's own glyph source, for a device with no 2D canvas to
 *          draw text on — the embedded-Dawn native host.
 *
 * The Canvas2D rasterizer measures and draws a glyph, then converts the alpha
 * coverage to an SDF through the engine's wasm heap. A native host has neither a
 * canvas nor a wasm heap, so the whole of that runs on its side of the seam
 * (its font stack + the engine's own `sdfFromAlpha`, compiled native) and this
 * class only carries the request across: same {@link GlyphRasterizer} contract,
 * same tile format, so the atlas, the layout and the batching above it are the
 * ONE implementation both platforms run.
 *
 * Mirrors how `createNativeResourceManager` backs the shared Assets channel.
 */
import { platformRasterizeGlyph } from '../../platform';
import type { GlyphRasterizer, RasterGlyph } from './glyph-atlas';

export interface NativeGlyphRasterizerOptions {
    /** Size glyphs are rasterized at (an SDF is resolution-independent). Default 48. */
    renderSize?: number;
    /** SDF spread / padding around the glyph ink, in px. Default 6. */
    padding?: number;
    /** Produce an SDF (scalable) vs a plain-alpha bitmap (native AA). Default true. */
    sdf?: boolean;
}

export class NativeGlyphRasterizer implements GlyphRasterizer {
    readonly renderSize: number;
    private readonly pad: number;
    private readonly sdf: boolean;

    constructor(opts: NativeGlyphRasterizerOptions = {}) {
        this.renderSize = opts.renderSize ?? 48;
        this.pad = opts.padding ?? 6;
        this.sdf = opts.sdf ?? true;
    }

    rasterize(codepoint: number, fontFamily: string, style: number, pixelSize = this.renderSize): RasterGlyph | null {
        const glyph = platformRasterizeGlyph({
            codepoint, fontFamily, style, pixelSize, sdf: this.sdf, padding: this.pad,
        });
        if (!glyph) return null;
        // A host may answer a whitespace glyph with advance only (no cell) — the
        // same shape the canvas path returns, so the atlas needs no special case.
        return {
            pixels: glyph.pixels,
            width: glyph.width,
            height: glyph.height,
            advance: glyph.advance,
            bearingX: glyph.bearingX,
            bearingY: glyph.bearingY,
        };
    }
}
