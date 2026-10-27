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
import { createTextCullGeometry, textClipPlanes, clipTextGeometry, type TextCullGeometry } from './text-culling';
import type { ESEngineModule } from '../../wasm';
import { platformHasGlyphRasterizer } from '../../platform';
import { GlyphAtlas } from './glyph-atlas';
import { CanvasGlyphRasterizer, type CanvasGlyphRasterizerOptions } from './glyph-rasterizer';
import { NativeGlyphRasterizer } from './native-glyph-rasterizer';
import { EngineAtlasPageStore } from './atlas-page-store';
import { TextAlign, TextVerticalAlign, TextOverflow } from '../core/text';
import { layoutText, buildGlyphVertices, MAX_TEXT_BATCH_GLYPHS, type LaidGlyph, type RGBA } from './layout';
import { submitTextBatch, TEXT_VERTEX_FLOATS } from './submit';
import { withScratch } from '../../wasm/wasmScratch';
import type { EngineApi } from '../../ecs/bridge/engineApi';

/** Receives index-safe glyph batches, each bound to one atlas page. */
export type GlyphBatchSink = (vertices: Float32Array, indices: Uint16Array, pageId: number) => void;

export interface DrawTextParams {
    text: string;
    fontFamily: string;
    fontSizePx: number;
    color: RGBA;
    /** Inherited opacity applied to every fill, rich-color, shadow and outline vertex. */
    opacity?: number;
    originX?: number;
    originY?: number;
    style?: number;
    /** Parse `<b>/<i>/<color>/<font size>` markup. */
    richText?: boolean;
    /** Horizontal alignment. The component's own spelling, so the mapping from
     *  number to meaning is written once. */
    align?: TextAlign;
    /** Baseline-to-baseline distance (px) for multi-line text. */
    lineHeight?: number;
    /** Extra advance between glyphs (px). */
    letterSpacing?: number;
    /** Word-wrap width in px (plain text); 0/undefined = no wrap. */
    maxWidth?: number;
    /** Box width (px) horizontal align positions the block within; 0/undefined = boxless (anchor to origin). */
    boxWidth?: number;
    /** Vertical alignment within boxHeight. */
    verticalAlign?: TextVerticalAlign;
    /** Box height (px) for vertical alignment; 0/undefined = boxless (anchor to origin). */
    boxHeight?: number;
    /** What a run too big for the box does. */
    overflow?: TextOverflow;
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
 * Lay out text against the atlas and emit index-safe quad batches to the sink.
 * Pure given the atlas, so grouping and geometry are unit-testable.
 */
export function drawTextWith(atlas: GlyphAtlas, sink: GlyphBatchSink, p: DrawTextParams): void {
    if (atlas.metricsOnly) throw new Error('Measurement atlases cannot submit text.');
    const opacity = p.opacity ?? 1;
    if (opacity <= 0) return;
    const layout = layoutText(p.text, atlas, p.fontFamily, {
        fontSizePx: p.fontSizePx,
        letterSpacing: p.letterSpacing,
        lineHeight: p.lineHeight,
        align: p.align,
        rich: p.richText,
        color: p.color,
        maxWidth: p.maxWidth,
        boxWidth: p.boxWidth,
        boxHeight: p.boxHeight,
        overflow: p.overflow,
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
    // distinct texture. Split oversized pages once, before emitting effects.
    const byPage = new Map<number, LaidGlyph[]>();
    for (const g of layout.glyphs) {
        let arr = byPage.get(g.pageId);
        if (!arr) { arr = []; byPage.set(g.pageId, arr); }
        arr.push(g);
    }
    const chunks: Array<[number, readonly LaidGlyph[]]> = [];
    for (const [pageId, glyphs] of byPage) {
        for (let start = 0; start < glyphs.length; start += MAX_TEXT_BATCH_GLYPHS) {
            chunks.push([pageId, glyphs.length <= MAX_TEXT_BATCH_GLYPHS
                ? glyphs : glyphs.slice(start, start + MAX_TEXT_BATCH_GLYPHS)]);
        }
    }

    const baseX = (p.originX ?? 0) + textBlockOffsetX(p.align, boxWidth, layout.width);
    // Emit the glyph set once per page, recolored + offset. All passes are SDF
    // glyphs in the same atlas/layer, so they batch and draw in submit order —
    // shadow + outline first (behind), fill last (on top).
    const emitPass = (color: RGBA, dx: number, dy: number, bias = 0, useGlyphColors = false): void => {
        for (const [pageId, glyphs] of chunks) {
            const { vertices, indices } = buildGlyphVertices(glyphs, color, baseX + dx, originY + dy, bias, useGlyphColors);
            if (opacity !== 1) {
                for (let i = 7; i < vertices.length; i += TEXT_VERTEX_FLOATS) vertices[i] *= opacity;
            }
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
    emitPass(p.color, 0, 0, 0, true);
}

export interface TextRendererOptions extends CanvasGlyphRasterizerOptions {
    /** Cache glyph metrics without creating or uploading GPU pages. */
    metricsOnly?: boolean;
    /** Atlas page size in texels. Default 1024. */
    pageSize?: number;
    /** Device pixel ratio for bitmap-mode per-size rasterization. Default 1. */
    dpr?: number;
}

/** One laid-out, tessellated page batch in the entity's local (untransformed) space. */
interface CachedTextBatch extends TextCullGeometry {
    vertices: Float32Array;
    indices: Uint16Array;
    pageId: number;
    /** Original vertex alphas, retained lazily so repeated fades never compound. */
    alphas?: Float32Array;
}

interface TextCacheEntry {
    sig: string;
    /** Atlas generation the geometry was built against (bitmap content-scale). */
    gen: number;
    batches: CachedTextBatch[];
    opacity: number;
}

export class SdfTextRenderer {
    readonly atlas: GlyphAtlas;
    private readonly sdf: boolean;
    private readonly cache_ = new Map<number, TextCacheEntry>();
    private readonly clipPlanes_ = new Float64Array(36);
    private readonly drawn_ = new Set<number>();
    /** The atlas pages the retained labels of this renderer draw from, so the pages outlive the frames the labels are not rebuilt in. */
    private readonly retainedPages_ = new Map<number, number[]>();

    /** `module` is null on the native core (no wasm heap); the glyph source is
     *  then the platform's own rasterizer, since there is no 2D canvas to draw
     *  glyphs on. Everything above the rasterizer — atlas, layout, batching — is
     *  the same code either way. */
    constructor(private readonly module: ESEngineModule | null, opts: TextRendererOptions = {}) {
        this.sdf = opts.sdf ?? true;
        const rasterizer = platformHasGlyphRasterizer()
            ? new NativeGlyphRasterizer({ renderSize: opts.renderSize, padding: opts.padding, sdf: this.sdf })
            : new CanvasGlyphRasterizer(module, { ...opts, maxGlyphSize: Math.min(opts.maxGlyphSize ?? Infinity, opts.pageSize ?? 1024) });
        this.atlas = new GlyphAtlas(
            rasterizer,
            opts.metricsOnly ? null : new EngineAtlasPageStore(module),
            { pageSize: opts.pageSize, sdf: this.sdf, dpr: opts.dpr },
        );
    }

    /** See {@link GlyphAtlas.setContentScale} — no-op for the SDF atlas. */
    setContentScale(scale: number): void {
        this.atlas.setContentScale(scale);
    }

    setDevicePixelRatio(dpr: number): void {
        this.atlas.setDevicePixelRatio(dpr);
    }

    /** Previous frame has submitted; remove unused layouts and their GPU pages. */
    beginFrame(): void {
        if (this.atlas.metricsOnly) return;
        for (const entity of this.cache_.keys()) {
            if (!this.drawn_.has(entity)) this.cache_.delete(entity);
        }
        const pages = new Set<number>();
        for (const entry of this.cache_.values()) {
            for (const batch of entry.batches) pages.add(batch.pageId);
        }
        for (const list of this.retainedPages_.values()) for (const pageId of list) pages.add(pageId);
        this.drawn_.clear();
        this.atlas.retainPages(pages);
    }

    dispose(): void {
        this.drawn_.clear();
        this.cache_.clear();
        this.retainedPages_.clear();
        this.atlas.dispose();
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
        viewProjection?: Float32Array,
    ): void {
        if (this.atlas.metricsOnly) throw new Error('Measurement atlases cannot submit text.');
        const opacity = p.opacity ?? 1;
        if (opacity <= 0) return;
        this.drawn_.add(entity);
        const gen = this.atlas.generation;
        const sig = textSignature(p, 1);
        let entry = this.cache_.get(entity);
        if (!entry || entry.gen !== gen || entry.sig !== sig) {
            const batches: CachedTextBatch[] = [];
            drawTextWith(this.atlas, (vertices, indices, pageId) => {
                batches.push({ ...createTextCullGeometry(vertices, indices), pageId });
            }, { ...p, opacity: 1 });
            entry = { sig, gen, batches, opacity: 1 };
            this.cache_.set(entity, entry);
        }
        const planes = viewProjection && textClipPlanes(this.clipPlanes_, viewProjection, transform) ? this.clipPlanes_ : null;
        for (const b of entry.batches) {
            if (entry.opacity !== opacity) {
                if (!b.alphas) {
                    b.alphas = new Float32Array(b.vertices.length / TEXT_VERTEX_FLOATS);
                    for (let i = 0; i < b.alphas.length; i++) b.alphas[i] = b.vertices[i * TEXT_VERTEX_FLOATS + 7];
                }
                for (let i = 0; i < b.alphas.length; i++) {
                    b.vertices[i * TEXT_VERTEX_FLOATS + 7] = b.alphas[i] * opacity;
                }
            }
            const visible = clipTextGeometry(b, planes);
            if (visible) submitTextBatch(this.module, visible.vertices, visible.indices, b.pageId, transform, entity, layer, depth, this.sdf, cullBit);
        }
        entry.opacity = opacity;
    }

    /** Drop cached geometry for entities not drawn this frame (despawned / hidden / no longer text). */
    /**
     * Lay a label out and hand its glyph quads to the engine, which keeps them and submits them every frame (see RetainedText.hpp). Called when the
     * label is new or changed; an unchanged label costs the engine's own loop and nothing here beyond {@link markDrawn}.
     */
    retain(
        api: EngineApi, p: DrawTextParams, entity: number,
        screen: boolean, hasBox: boolean, layer: number, boxWidth: number, boxHeight: number,
    ): void {
        if (this.atlas.metricsOnly) throw new Error('Measurement atlases cannot submit text.');
        const batches: Array<{ vertices: Float32Array; indices: Uint16Array; pageId: number }> = [];
        drawTextWith(this.atlas, (vertices, indices, pageId) => { batches.push({ vertices, indices, pageId }); }, { ...p, opacity: 1 });
        api.renderer_retainedTextBegin!(entity, this.sdf ? 1 : 0, screen ? 1 : 0, hasBox ? 1 : 0, layer, boxWidth, boxHeight);
        for (const b of batches) {
            const vertexCount = (b.vertices.length / TEXT_VERTEX_FLOATS) | 0;
            if (vertexCount <= 0 || b.indices.length <= 0) continue;
            const vBytes = new Uint8Array(b.vertices.buffer, b.vertices.byteOffset, b.vertices.byteLength);
            const iBytes = new Uint8Array(b.indices.buffer, b.indices.byteOffset, b.indices.byteLength);
            withScratch({ _malloc: size => api._malloc!(size), _free: ptr => api._free!(ptr) }, alloc => {
                const vPtr = alloc(vBytes.byteLength);
                const iPtr = alloc(iBytes.byteLength);
                api.HEAPU8!.set(vBytes, vPtr);
                api.HEAPU8!.set(iBytes, iPtr);
                api.renderer_retainedTextBatch!(entity, vPtr, vertexCount, iPtr, b.indices.length, b.pageId);
            });
        }
        this.retainedPages_.set(entity, batches.map(b => b.pageId));
        this.drawn_.add(entity);
        this.cache_.delete(entity);
    }

    /** A retained label that is not rebuilt this frame is still on screen: its atlas pages must stay. */
    markDrawn(entity: number): void {
        this.drawn_.add(entity);
    }

    /** Release what a retained label held here (the engine's copy is cleared by the caller). */
    forget(entity: number): void {
        this.retainedPages_.delete(entity);
        this.drawn_.delete(entity);
    }

    retainOnly(live: Set<number>): void {
        if (this.cache_.size === 0) return;
        for (const e of this.cache_.keys()) {
            if (!live.has(e)) this.cache_.delete(e);
        }
    }
}

/** Serialize every DrawTextParams field that affects the laid-out, colored geometry. */
export function signatureOf(p: DrawTextParams): string {
    return textSignature(p, p.opacity ?? 1);
}

function textSignature(p: DrawTextParams, opacity: number): string {
    const shadow = p.shadow
        ? `${p.shadow.color.join(',')}:${p.shadow.dx}:${p.shadow.dy}:${p.shadow.blur ?? 0}`
        : '';
    const outline = p.outline ? `${p.outline.color.join(',')}:${p.outline.width}` : '';
    return JSON.stringify([
        p.text, p.fontFamily, p.fontSizePx, p.style ?? 0,
        p.richText ? 1 : 0, p.align ?? 0, p.verticalAlign ?? 0,
        p.lineHeight ?? 0, p.letterSpacing ?? 0,
        p.maxWidth ?? 0, p.boxWidth ?? 0, p.boxHeight ?? 0,
        p.overflow ?? TextOverflow.Visible,
        p.originX ?? 0, p.originY ?? 0,
        p.color.join(','), opacity, shadow, outline,
    ]);
}
