/**
 * @file    ui/text/layout.ts
 * @brief   Pure text layout + glyph-quad vertex building for the SDF text path
 *          (REARCH_GUI P1.3, TS-centric). Given the glyph atlas (which supplies
 *          per-glyph atlas UVs + metrics), turn a string into positioned quads
 *          and then into the interleaved vertex/index buffers `submitTextBatch`
 *          expects. No Canvas/GL here, so it is fully unit-testable.
 *
 * Conventions: local space, baseline at y = 0, y-up (glyph tops are positive y);
 * positions are pre-transform (the entity world matrix is applied at submit).
 * Glyph metrics from the atlas are in renderSize px; everything scales by
 * displaySize / atlas.renderSize (SDF is resolution-independent).
 */
import type { GlyphAtlas } from './glyph-atlas';
import { TEXT_VERTEX_FLOATS } from './submit';

export interface TextLayoutOptions {
    /** Display font size in px. */
    fontSizePx: number;
    /** Extra advance between glyphs, in display px. */
    letterSpacing?: number;
}

/** One positioned glyph quad: atlas UVs + local-space corners (y-up). */
export interface LaidGlyph {
    u0: number; v0: number; u1: number; v1: number;
    x0: number; y0: number; // bottom-left
    x1: number; y1: number; // top-right
    pageId: number;
}

export interface TextLayout {
    glyphs: LaidGlyph[];
    /** Total pen advance (display px). */
    width: number;
    /** Line height (display px). */
    lineHeight: number;
}

/**
 * Lay out a single line of text against the atlas. Glyphs missing from the
 * atlas (unproducible) are skipped; whitespace advances the pen without a quad.
 */
export function layoutLine(
    text: string,
    atlas: GlyphAtlas,
    fontFamily: string,
    opts: TextLayoutOptions,
    style = 0,
): TextLayout {
    const scale = opts.fontSizePx / atlas.renderSize;
    const spacing = opts.letterSpacing ?? 0;
    const glyphs: LaidGlyph[] = [];
    let penX = 0;

    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        const g = atlas.getGlyph(cp, fontFamily, style);
        if (!g) continue;

        if (g.width > 0 && g.height > 0) {
            const x0 = penX + g.bearingX * scale;
            const y1 = g.bearingY * scale;            // top, above baseline
            const x1 = x0 + g.width * scale;
            const y0 = y1 - g.height * scale;          // bottom
            glyphs.push({ u0: g.u0, v0: g.v0, u1: g.u1, v1: g.v1, x0, y0, x1, y1, pageId: g.pageId });
        }
        penX += g.advance * scale + spacing;
    }

    return { glyphs, width: penX, lineHeight: opts.fontSizePx };
}

/** RGBA color, channels in [0,1]. */
export type RGBA = readonly [number, number, number, number];

export interface GlyphVertexData {
    vertices: Float32Array; // TEXT_VERTEX_FLOATS per vertex, 4 verts/glyph
    indices: Uint16Array;   // 6 per glyph
}

/**
 * Build interleaved vertices (x,y,u,v,r,g,b,a) + indices for laid-out glyphs.
 * Atlas v0 (top) maps to the screen-top corner, v1 (bottom) to screen-bottom,
 * so the quad samples the glyph upright. `originX/Y` offsets all glyphs (e.g. to
 * place the text by its UIRect-resolved anchor).
 */
export function buildGlyphVertices(
    layout: TextLayout,
    color: RGBA,
    originX = 0,
    originY = 0,
): GlyphVertexData {
    const n = layout.glyphs.length;
    const vertices = new Float32Array(n * 4 * TEXT_VERTEX_FLOATS);
    const indices = new Uint16Array(n * 6);
    const [r, g, b, a] = color;

    for (let i = 0; i < n; i++) {
        const gl = layout.glyphs[i];
        const x0 = gl.x0 + originX, x1 = gl.x1 + originX;
        const y0 = gl.y0 + originY, y1 = gl.y1 + originY;
        const vo = i * 4 * TEXT_VERTEX_FLOATS;
        // BL, BR, TR, TL — UV V uses v1 at the bottom, v0 at the top.
        writeVertex(vertices, vo + 0 * TEXT_VERTEX_FLOATS, x0, y0, gl.u0, gl.v1, r, g, b, a);
        writeVertex(vertices, vo + 1 * TEXT_VERTEX_FLOATS, x1, y0, gl.u1, gl.v1, r, g, b, a);
        writeVertex(vertices, vo + 2 * TEXT_VERTEX_FLOATS, x1, y1, gl.u1, gl.v0, r, g, b, a);
        writeVertex(vertices, vo + 3 * TEXT_VERTEX_FLOATS, x0, y1, gl.u0, gl.v0, r, g, b, a);

        const io = i * 6, vb = i * 4;
        indices[io] = vb; indices[io + 1] = vb + 1; indices[io + 2] = vb + 2;
        indices[io + 3] = vb; indices[io + 4] = vb + 2; indices[io + 5] = vb + 3;
    }

    return { vertices, indices };
}

function writeVertex(
    out: Float32Array, o: number,
    x: number, y: number, u: number, v: number,
    r: number, g: number, b: number, a: number,
): void {
    out[o] = x; out[o + 1] = y; out[o + 2] = u; out[o + 3] = v;
    out[o + 4] = r; out[o + 5] = g; out[o + 6] = b; out[o + 7] = a;
}
