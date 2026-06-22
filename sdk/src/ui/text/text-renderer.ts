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
import { layoutLine, buildGlyphVertices, type LaidGlyph, type RGBA } from './layout';
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
}

/**
 * Lay out `text` against `atlas` and emit one quad batch per atlas page to
 * `sink`. Pure given the atlas — no engine/Canvas dependency — so the grouping
 * and geometry are unit-testable.
 */
export function drawTextWith(atlas: GlyphAtlas, sink: GlyphBatchSink, p: DrawTextParams): void {
    const layout = layoutLine(p.text, atlas, p.fontFamily, { fontSizePx: p.fontSizePx }, p.style ?? 0);
    if (layout.glyphs.length === 0) return;

    // A string can reference glyphs across several atlas pages; each page is a
    // distinct texture, so group by page and emit one batch per page.
    const byPage = new Map<number, LaidGlyph[]>();
    for (const g of layout.glyphs) {
        let arr = byPage.get(g.pageId);
        if (!arr) { arr = []; byPage.set(g.pageId, arr); }
        arr.push(g);
    }
    for (const [pageId, glyphs] of byPage) {
        const { vertices, indices } = buildGlyphVertices(glyphs, p.color, p.originX ?? 0, p.originY ?? 0);
        sink(vertices, indices, pageId);
    }
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
