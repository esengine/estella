// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/text-renderer.ts
 * @brief   High-level SDF text drawing (REARCH_GUI P1.3): owns the dynamic glyph
 *          atlas and turns a string into batched glyph quads via the engine.
 *
 * `drawTextWith` is the pure orchestration (inject atlas + a submit sink → unit-
 * testable, incl. the per-page grouping that a string spanning multiple atlas
 * pages requires). `TextRenderer` wires it to the real Canvas2D rasterizer +
 * engine page store + submitTextBatch.
 */
import type { ESEngineModule } from '../../wasm';
import { GlyphAtlas } from './glyph-atlas';
import { CanvasGlyphRasterizer, type CanvasGlyphRasterizerOptions } from './glyph-rasterizer';
import { EngineAtlasPageStore } from './atlas-page-store';
import { layoutText, buildGlyphVertices, type LaidGlyph, type RGBA } from './layout';
import { submitTextBatch } from './submit';

/** Receives one (vertices, indices) batch per atlas page used by the text. */
export type GlyphBatchSink = (vertices: Float32Array, indices: Uint16Array, pageId: number) => void;

export interface DrawTextParams {
    text: string;
    fontFamily: string;
    fontSizePx: number;
    color: RGBA;
    originX?: number;
    originY?: number;
    style?: number;
    /** Parse `<b>/<i>/<color>/<font size>` markup (REARCH_GUI P1.4). */
    richText?: boolean;
    /** Horizontal alignment: 0 left | 1 center | 2 right. */
    align?: number;
    /** Baseline-to-baseline distance (px) for multi-line text. */
    lineHeight?: number;
    /** Extra advance between glyphs (px). */
    letterSpacing?: number;
    /** Word-wrap width in px (plain text); 0/undefined = no wrap. */
    maxWidth?: number;
    /** Vertical alignment within boxHeight: 0 top | 1 middle | 2 bottom. */
    verticalAlign?: number;
    /** Box height (px) for vertical alignment; omit for top-anchored. */
    boxHeight?: number;
    /** Drop shadow: an offset, recolored copy of the glyphs drawn behind the fill. */
    shadow?: { color: RGBA; dx: number; dy: number };
    /** Outline: recolored glyph copies fanned out by `width` px around the fill. */
    outline?: { color: RGBA; width: number };
}

// 8-direction offsets (unit) for the outline fan — scaled by the outline width.
const OUTLINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];

/**
 * Lay out `text` against `atlas` and emit one quad batch per atlas page to
 * `sink`. Pure given the atlas — no engine/Canvas dependency — so the grouping
 * and geometry are unit-testable.
 */
export function drawTextWith(atlas: GlyphAtlas, sink: GlyphBatchSink, p: DrawTextParams): void {
    const layout = layoutText(p.text, atlas, p.fontFamily, {
        fontSizePx: p.fontSizePx,
        letterSpacing: p.letterSpacing,
        lineHeight: p.lineHeight,
        align: p.align,
        rich: p.richText,
        color: p.color,
        maxWidth: p.maxWidth,
    }, p.style ?? 0);
    if (layout.glyphs.length === 0) return;

    // Vertical alignment within the box: shift the whole block down (y-up) by the
    // slack between the box and the content. layout.lineHeight is total block height.
    let originY = p.originY ?? 0;
    if (p.boxHeight && p.boxHeight > 0 && p.verticalAlign) {
        const slack = p.boxHeight - layout.lineHeight;
        originY -= p.verticalAlign === 1 ? slack / 2 : slack; // 1 middle, 2 bottom
    }

    // A string can reference glyphs across several atlas pages; each page is a
    // distinct texture, so group by page and emit one batch per page.
    const byPage = new Map<number, LaidGlyph[]>();
    for (const g of layout.glyphs) {
        let arr = byPage.get(g.pageId);
        if (!arr) { arr = []; byPage.set(g.pageId, arr); }
        arr.push(g);
    }

    const baseX = p.originX ?? 0;
    // Emit the glyph set once per page, recolored + offset. All passes are SDF
    // glyphs in the same atlas/layer, so they batch and draw in submit order —
    // shadow + outline first (behind), fill last (on top).
    const emitPass = (color: RGBA, dx: number, dy: number): void => {
        for (const [pageId, glyphs] of byPage) {
            const { vertices, indices } = buildGlyphVertices(glyphs, color, baseX + dx, originY + dy);
            sink(vertices, indices, pageId);
        }
    };

    // Shadow (offset drop copy). y-up local space: a positive screen-down offset
    // moves the copy toward -y.
    if (p.shadow && p.shadow.color[3] > 0) {
        emitPass(p.shadow.color, p.shadow.dx, -p.shadow.dy);
    }
    // Outline (8-direction fan around the glyph).
    if (p.outline && p.outline.width > 0 && p.outline.color[3] > 0) {
        const w = p.outline.width;
        for (const [ox, oy] of OUTLINE_OFFSETS) emitPass(p.outline.color, ox * w, oy * w);
    }
    // Fill (on top).
    emitPass(p.color, 0, 0);
}

export interface TextRendererOptions extends CanvasGlyphRasterizerOptions {
    /** Atlas page size in texels. Default 1024. */
    pageSize?: number;
}

export class SdfTextRenderer {
    readonly atlas: GlyphAtlas;

    constructor(private readonly module: ESEngineModule, opts: TextRendererOptions = {}) {
        this.atlas = new GlyphAtlas(
            new CanvasGlyphRasterizer(module, opts),
            new EngineAtlasPageStore(module),
            { pageSize: opts.pageSize },
        );
    }

    /**
     * Draw a line of text. `transform` is the entity's column-major world mat4;
     * glyph local positions (baseline y=0, y-up) are transformed at submit.
     */
    drawText(
        p: DrawTextParams,
        transform: Float32Array,
        entity: number,
        layer: number,
        depth: number,
    ): void {
        drawTextWith(this.atlas, (vertices, indices, pageId) => {
            submitTextBatch(this.module, vertices, indices, pageId, transform, entity, layer, depth);
        }, p);
    }
}
