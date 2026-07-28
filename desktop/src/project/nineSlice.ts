// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  nineSlice.ts — the geometry behind the 9-slice border editor.
 *
 * A 9-slice border is four insets in TEXTURE pixels, one per edge. The editor
 * draws the texture letterboxed into whatever box the inspector gives it and
 * lets the user drag four guides; everything that converts between those two
 * spaces, and every rule about what a border may be, lives here as pure
 * functions so it is testable without a DOM.
 *
 * The invariant that matters: opposite borders may never cross or meet, because
 * the centre slice would collapse and the renderer would have nothing to
 * stretch. Each edge is therefore clamped against its opposite, not just
 * against the texture bounds.
 */

/** The four edge insets, in texture pixels. */
export interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export type SliceEdge = keyof SliceBorder;

export const SLICE_EDGES: readonly SliceEdge[] = ['left', 'right', 'top', 'bottom'];

/** Which axis an edge runs against: left/right are horizontal insets. */
export const isHorizontalEdge = (edge: SliceEdge): boolean => edge === 'left' || edge === 'right';

/** A texture letterboxed into `box`, centred, never upscaled past the box. */
export interface FitRect {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Box pixels per texture pixel. */
    scale: number;
}

export function fitRect(texW: number, texH: number, boxW: number, boxH: number): FitRect {
    // scale 0 marks "no mapping exists" — callers convert box↔texture through it,
    // and a fake 1:1 here would silently turn a not-yet-measured box into edits.
    if (texW <= 0 || texH <= 0 || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: 0, h: 0, scale: 0 };
    const scale = Math.min(boxW / texW, boxH / texH);
    const w = texW * scale;
    const h = texH * scale;
    return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale };
}

/** Round to whole texture pixels — a border is a pixel count, never a fraction. */
const snap = (n: number): number => Math.round(n);

/**
 * Clamp one edge against the texture bounds and its opposite edge, leaving at
 * least one pixel of centre slice. `size` is the texture extent on that edge's
 * axis (width for left/right, height for top/bottom).
 */
export function clampEdge(value: number, opposite: number, size: number): number {
    const room = Math.max(0, size - Math.max(0, opposite) - 1);
    return Math.max(0, Math.min(snap(value), room));
}

/** Clamp a whole border — used when adopting values from a hand-edited `.meta`. */
export function clampBorder(border: SliceBorder, texW: number, texH: number): SliceBorder {
    const left = Math.max(0, Math.min(snap(border.left), Math.max(0, texW - 1)));
    const top = Math.max(0, Math.min(snap(border.top), Math.max(0, texH - 1)));
    return {
        left,
        top,
        right: clampEdge(border.right, left, texW),
        bottom: clampEdge(border.bottom, top, texH),
    };
}

/**
 * The new value for `edge` when its guide is dragged to `pointer` (box-space
 * px, relative to the box origin). Converts to texture space through `fit`,
 * measures the inset from that edge, and clamps.
 */
export function edgeFromPointer(
    edge: SliceEdge,
    pointer: { x: number; y: number },
    fit: FitRect,
    border: SliceBorder,
    texW: number,
    texH: number,
): number {
    if (fit.scale <= 0) return border[edge];
    const tx = (pointer.x - fit.x) / fit.scale;
    const ty = (pointer.y - fit.y) / fit.scale;
    switch (edge) {
        case 'left': return clampEdge(tx, border.right, texW);
        case 'right': return clampEdge(texW - tx, border.left, texW);
        case 'top': return clampEdge(ty, border.bottom, texH);
        case 'bottom': return clampEdge(texH - ty, border.top, texH);
    }
}

/** Where an edge's guide sits in box space (px from the box origin). */
export function guidePosition(edge: SliceEdge, border: SliceBorder, fit: FitRect, texW: number, texH: number): number {
    switch (edge) {
        case 'left': return fit.x + border.left * fit.scale;
        case 'right': return fit.x + (texW - border.right) * fit.scale;
        case 'top': return fit.y + border.top * fit.scale;
        case 'bottom': return fit.y + (texH - border.bottom) * fit.scale;
    }
}

/**
 * The edge whose guide is within `slop` box-px of `pointer`, or null. Ties go to
 * the nearest; a click in open space grabs nothing (so the user can't nudge a
 * border by mis-clicking the middle of the image).
 */
export function pickEdge(
    pointer: { x: number; y: number },
    border: SliceBorder,
    fit: FitRect,
    texW: number,
    texH: number,
    slop = 6,
): SliceEdge | null {
    let best: SliceEdge | null = null;
    let bestD = slop;
    for (const edge of SLICE_EDGES) {
        const at = guidePosition(edge, border, fit, texW, texH);
        const d = Math.abs((isHorizontalEdge(edge) ? pointer.x : pointer.y) - at);
        if (d <= bestD) {
            bestD = d;
            best = edge;
        }
    }
    return best;
}

/** True when the border actually slices — all-zero means "no 9-slice". */
export const hasBorder = (b: SliceBorder): boolean => b.left > 0 || b.right > 0 || b.top > 0 || b.bottom > 0;

/** Read a border out of an importer block (dotted `sliceBorder.*` keys). */
export function borderFromImporter(importer: Record<string, unknown> | null | undefined): SliceBorder {
    const raw = (importer?.sliceBorder ?? {}) as Partial<Record<SliceEdge, unknown>>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return { left: num(raw.left), right: num(raw.right), top: num(raw.top), bottom: num(raw.bottom) };
}
