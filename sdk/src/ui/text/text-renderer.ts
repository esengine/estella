// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/text-renderer.ts
 * @brief   High-level SDF text drawing: owns the dynamic glyph
 *          atlas and turns a string into batched glyph quads via the engine.
 *
 * `drawTextWith` is the pure orchestration (inject atlas + a submit sink → unit-
 * testable, incl. the per-page grouping that a string spanning multiple atlas
 * pages requires). `TextRenderer` wires it to the real Canvas2D rasterizer +
 * engine page store + submitTextBatch.
 */
import type { ESEngineModule } from '../../wasm';
import { platformHasGlyphRasterizer } from '../../platform';
import { GlyphAtlas } from './glyph-atlas';
import { CanvasGlyphRasterizer, type CanvasGlyphRasterizerOptions } from './glyph-rasterizer';
import { NativeGlyphRasterizer } from './native-glyph-rasterizer';
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
    /** Parse `<b>/<i>/<color>/<font size>` markup. */
    richText?: boolean;
    /** Horizontal alignment: 0 left | 1 center | 2 right. */
    align?: number;
    /** Baseline-to-baseline distance (px) for multi-line text. */
    lineHeight?: number;
    /** Extra advance between glyphs (px). */
    letterSpacing?: number;
    /** Word-wrap width in px (plain text); 0/undefined = no wrap. */
    maxWidth?: number;
    /** Box width (px) horizontal align positions the block within; 0/undefined = boxless (anchor to origin). */
    boxWidth?: number;
    /** Vertical alignment within boxHeight: 0 top | 1 middle | 2 bottom. */
    verticalAlign?: number;
    /** Box height (px) for vertical alignment; 0/undefined = boxless (anchor to origin). */
    boxHeight?: number;
    /**
     * Drop shadow: an offset, recolored copy of the glyphs drawn behind the fill.
     * `blur` (px, 0 = hard) spreads that copy into a ring so the shadow reads as
     * a soft mass rather than a second stamp of the text.
     */
    shadow?: { color: RGBA; dx: number; dy: number; blur?: number };
    /** Outline: recolored glyph copies fanned out by `width` px around the fill. */
    outline?: { color: RGBA; width: number };
}

// 8-direction offsets (unit) for the outline fan — scaled by the outline width.
// The bitmap atlas's only way to widen a glyph; see outlineBias.
const OUTLINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];

/**
 * An outline width in text px as the edge shift the SDF shader applies, or 0 when
 * these glyphs are coverage rather than distance (no edge to shift).
 *
 * A glyph is rasterized at the atlas's renderSize and drawn at fontSizePx, so one
 * atlas texel covers fontSizePx/renderSize text px; the atlas encodes `spread`
 * texels into half its range. Both conversions are in the value, which therefore
 * says the same thing at every font size and every zoom.
 *
 * Asking for more than the spread cannot dilate further — the field simply stops
 * there — so an over-wide request degrades to the widest real outline instead of
 * flooding the glyph's cell.
 */
function outlineBias(atlas: GlyphAtlas, fontSizePx: number, widthPx: number): number {
    const perTexel = atlas.distancePerTexel;
    if (perTexel <= 0 || fontSizePx <= 0) return 0;
    return widthPx * (atlas.renderSize / fontSizePx) * perTexel;
}

/**
 * A blurred shadow is the glyphs stamped around a ring, which is the same shape
 * the outline already takes — one mechanism for "spread these glyphs out", not
 * two. Two rings plus the centre approximate a Gaussian closely enough at the
 * sizes UI text uses. Unlike the outline, a blur wants a SOFTER edge rather than
 * a moved one, which the single distance the vertices carry cannot express.
 */
const SHADOW_RING: ReadonlyArray<readonly [number, number, number]> = [
    // [x, y, radius fraction] — the inner ring carries most of the mass.
    [0, 0, 0],
    [-0.55, -0.55, 1], [0, -0.78, 1], [0.55, -0.55, 1],
    [-0.78, 0, 1], [0.78, 0, 1],
    [-0.55, 0.55, 1], [0, 0.78, 1], [0.55, 0.55, 1],
];

/**
 * Per-tap alpha for `n` stacked copies that should composite to `target`.
 * Straight division under-shoots badly: eight layers of `a/8` reach
 * 1-(1-a/8)^8, not `a`. This is that inverted.
 */
export function tapAlpha(target: number, n: number): number {
    if (n <= 1) return target;
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, target)), 1 / n);
}

/**
 * How far a laid-out block sits from `originX`. `layoutText` already aligned each
 * line — within the box width when there is one, within the widest line when there
 * is not — so this only has the boxless job: anchoring the whole block against the
 * origin, left edge / centre / right edge.
 *
 * @param boxWidth the layout box's width; 0 ⇒ boxless, the origin IS the box
 */
export function textBlockOffsetX(
    align: number | undefined, boxWidth: number, blockWidth: number,
): number {
    if (boxWidth > 0 || !align) return 0;
    return -(align === 1 ? blockWidth / 2 : blockWidth); // 1 center, 2 right
}

/**
 * How far a laid-out block sits from `originY`, once vertical alignment and
 * half-leading are applied.
 *
 * Split out because the boxless case was wrong in a way only arithmetic shows:
 * `rectTextBox` hands the boxed path an origin already carrying the baseline
 * (`-0.8em`), and the boxless path started from a bare 0. Middle therefore
 * centred the block on a baseline rather than on the entity, and every world
 * label sat 0.8em high — half a square, on a chessboard.
 *
 * @param boxHeight  the layout box's height; 0 ⇒ boxless, the origin IS the box
 * @param lineHeight the laid block's height
 */
export function textBlockOriginY(
    originY: number, boxHeight: number, lineHeight: number, fontSizePx: number,
    verticalAlign: number | undefined, lineHeightPx: number | undefined,
): number {
    let y = originY;
    // Boxless: the entity origin is a zero-height box, so it gets the same
    // baseline the boxed path already receives from rectTextBox. Applied for
    // every alignment, not only the ones that then shift — otherwise Top means
    // "baseline on the origin" while Middle means "block centred on it", and the
    // three do not sit on one ladder.
    if (boxHeight <= 0) y -= fontSizePx * 0.8;
    // Shift the block down (y-up) by the slack between box and content. With a
    // zero-height box the slack is -blockHeight, which anchors the block to the origin.
    if (verticalAlign) {
        const slack = boxHeight - lineHeight;
        y -= verticalAlign === 1 ? slack / 2 : slack; // 1 middle, 2 bottom
    }
    // Half-leading. A lineHeight above 1em adds space around the text, and that
    // space belongs half above the first baseline and half below the last — the
    // caller hands us a baseline a flat 0.8em under the line top, which puts all
    // of it below. The block then rides (lineHeight - 1em)/2 too high inside its
    // own box: at the default 1.2, every centred label sits 0.1em above where it
    // should, which on a 60px label is a visible 6px.
    return y - Math.max(0, ((lineHeightPx ?? fontSizePx * 1.2) - fontSizePx) / 2);
}

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
        boxWidth: p.boxWidth,
    }, p.style ?? 0);
    if (layout.glyphs.length === 0) return;

    // Position the block within its box: [originX .. originX+boxWidth] × [originY .. -boxHeight].
    // A boxless label (box 0×0) collapses the box to the entity origin, so align/verticalAlign
    // ANCHOR the whole block to it rather than silently doing nothing — one rule, both cases.
    const boxHeight = p.boxHeight ?? 0;
    const boxWidth = p.boxWidth ?? 0;

    const originY = textBlockOriginY(
        p.originY ?? 0, boxHeight, layout.lineHeight, p.fontSizePx, p.verticalAlign, p.lineHeight,
    );

    // A string can reference glyphs across several atlas pages; each page is a
    // distinct texture, so group by page and emit one batch per page.
    const byPage = new Map<number, LaidGlyph[]>();
    for (const g of layout.glyphs) {
        let arr = byPage.get(g.pageId);
        if (!arr) { arr = []; byPage.set(g.pageId, arr); }
        arr.push(g);
    }

    const baseX = (p.originX ?? 0) + textBlockOffsetX(p.align, boxWidth, layout.width);
    // Emit the glyph set once per page, recolored + offset. All passes are SDF
    // glyphs in the same atlas/layer, so they batch and draw in submit order —
    // shadow + outline first (behind), fill last (on top).
    const emitPass = (color: RGBA, dx: number, dy: number, bias = 0): void => {
        for (const [pageId, glyphs] of byPage) {
            const { vertices, indices } = buildGlyphVertices(glyphs, color, baseX + dx, originY + dy, bias);
            sink(vertices, indices, pageId);
        }
    };

    // Shadow (offset drop copy). y-up local space: a positive screen-down offset
    // moves the copy toward -y.
    if (p.shadow && p.shadow.color[3] > 0) {
        const { color, dx, dy } = p.shadow;
        const blur = p.shadow.blur ?? 0;
        if (blur > 0) {
            const a = tapAlpha(color[3], SHADOW_RING.length);
            const tap: RGBA = [color[0], color[1], color[2], a];
            for (const [rx, ry, r] of SHADOW_RING) {
                emitPass(tap, dx + rx * blur * r, -dy + ry * blur * r);
            }
        } else {
            emitPass(color, dx, -dy);
        }
    }
    // Outline. On a distance-field atlas this is the glyph drawn once more with
    // its edge pushed out — a real dilation, so the shape survives any width. The
    // bitmap atlas has no distance to push, so it keeps the eight-way stamp, which
    // is only ever asked for hairlines there.
    if (p.outline && p.outline.width > 0 && p.outline.color[3] > 0) {
        const w = p.outline.width;
        const bias = outlineBias(atlas, p.fontSizePx, w);
        if (bias > 0) emitPass(p.outline.color, 0, 0, bias);
        else for (const [ox, oy] of OUTLINE_OFFSETS) emitPass(p.outline.color, ox * w, oy * w);
    }
    // Fill (on top).
    emitPass(p.color, 0, 0);
}

export interface TextRendererOptions extends CanvasGlyphRasterizerOptions {
    /** Atlas page size in texels. Default 1024. */
    pageSize?: number;
    /** Device pixel ratio for bitmap-mode per-size rasterization. Default 1. */
    dpr?: number;
}

/** One laid-out, tessellated page batch in the entity's local (untransformed) space. */
interface CachedTextBatch {
    vertices: Float32Array;
    indices: Uint16Array;
    pageId: number;
}

interface TextCacheEntry {
    sig: string;
    /** Atlas generation the geometry was built against (bitmap content-scale). */
    gen: number;
    batches: CachedTextBatch[];
}

export class SdfTextRenderer {
    readonly atlas: GlyphAtlas;
    private readonly sdf: boolean;
    private readonly cache_ = new Map<number, TextCacheEntry>();

    /** `module` is null on the native core (no wasm heap); the glyph source is
     *  then the platform's own rasterizer, since there is no 2D canvas to draw
     *  glyphs on. Everything above the rasterizer — atlas, layout, batching — is
     *  the same code either way. */
    constructor(private readonly module: ESEngineModule | null, opts: TextRendererOptions = {}) {
        this.sdf = opts.sdf ?? true;
        const rasterizer = platformHasGlyphRasterizer()
            ? new NativeGlyphRasterizer({ renderSize: opts.renderSize, padding: opts.padding, sdf: this.sdf })
            : new CanvasGlyphRasterizer(module, opts);
        this.atlas = new GlyphAtlas(
            rasterizer,
            new EngineAtlasPageStore(module),
            { pageSize: opts.pageSize, sdf: this.sdf, dpr: opts.dpr },
        );
    }

    /** See {@link GlyphAtlas.setContentScale} — no-op for the SDF atlas. */
    setContentScale(scale: number): void {
        this.atlas.setContentScale(scale);
    }

    /**
     * Draw a line of text. `transform` is the entity's column-major world mat4;
     * glyph local positions (baseline y=0, y-up) are transformed at submit.
     *
     * The tessellated geometry is local-space (transform-independent), so it is
     * cached per entity keyed by the layout signature + atlas generation: a static
     * label re-submits its cached quads with the current transform each frame
     * instead of re-laying-out and re-tessellating every glyph.
     */
    drawText(
        p: DrawTextParams,
        transform: Float32Array,
        entity: number,
        layer: number,
        depth: number,
        cullBit = 0,
    ): void {
        const gen = this.atlas.generation;
        const sig = signatureOf(p);
        let entry = this.cache_.get(entity);
        if (!entry || entry.gen !== gen || entry.sig !== sig) {
            const batches: CachedTextBatch[] = [];
            drawTextWith(this.atlas, (vertices, indices, pageId) => {
                batches.push({ vertices, indices, pageId });
            }, p);
            entry = { sig, gen, batches };
            this.cache_.set(entity, entry);
        }
        for (const b of entry.batches) {
            submitTextBatch(this.module, b.vertices, b.indices, b.pageId, transform, entity, layer, depth, this.sdf, cullBit);
        }
    }

    /** Drop cached geometry for entities not drawn this frame (despawned / hidden / no longer text). */
    retainOnly(live: Set<number>): void {
        if (this.cache_.size === 0) return;
        for (const e of this.cache_.keys()) {
            if (!live.has(e)) this.cache_.delete(e);
        }
    }
}

/** Serialize every DrawTextParams field that affects the laid-out, colored geometry. */
export function signatureOf(p: DrawTextParams): string {
    const shadow = p.shadow
        ? `${p.shadow.color.join(',')}:${p.shadow.dx}:${p.shadow.dy}:${p.shadow.blur ?? 0}`
        : '';
    const outline = p.outline ? `${p.outline.color.join(',')}:${p.outline.width}` : '';
    return [
        p.text, p.fontFamily, p.fontSizePx, p.style ?? 0,
        p.richText ? 1 : 0, p.align ?? 0, p.verticalAlign ?? 0,
        p.lineHeight ?? 0, p.letterSpacing ?? 0,
        p.maxWidth ?? 0, p.boxWidth ?? 0, p.boxHeight ?? 0,
        p.originX ?? 0, p.originY ?? 0,
        p.color.join(','), shadow, outline,
    ].join('|');
}
