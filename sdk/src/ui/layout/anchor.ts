// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/anchor.ts
 * @brief   Anchor presets — authoring shortcuts over a UINode's CSS box fields.
 *
 * The box model is CSS (position + inset + margin), so an anchor is NOT stored
 * state: a preset is a derived view that maps to/from the inset/margin/position
 * fields. Keeping the box fields the single source of truth (rather than a
 * redundant anchor enum, as RectTransform engines store) is what makes a preset
 * and the live layout impossible to desync.
 *
 * Each axis resolves independently to one of {@link AnchorAxis}: Start pins the
 * near edge, End the far edge, Stretch pins both edges with the size set to
 * `auto` so the insets drive it, and Center leaves both insets AND both margins
 * `auto` — the engine reads that combination as "centre this out-of-flow node in
 * the parent box", the one anchor a pivot-less CSS box can't express through
 * Yoga alone (Yoga's abspos centring keys off the parent's `justifyContent`, so
 * it can't differ per sibling).
 */
import { auto, isAuto, px, type Dimension } from '../core/dimension';
import { UIPositionType, type UINodeData } from '../core/ui-node';

/** Per-axis anchor mode (a preset is one of these per axis). */
export enum AnchorAxis {
    /** Pin the near edge (left / top). */
    Start = 0,
    /** Centre via `auto` margins on both edges. */
    Center = 1,
    /** Pin the far edge (right / bottom). */
    End = 2,
    /** Pin both edges; the size becomes `auto` so the insets drive it. */
    Stretch = 3,
}

/** A 2-D anchor: one {@link AnchorAxis} per axis. */
export interface AnchorPreset {
    h: AnchorAxis;
    v: AnchorAxis;
}

/** The four axis modes in row/column order, for building a preset grid. */
export const ANCHOR_AXES: readonly AnchorAxis[] = [
    AnchorAxis.Start,
    AnchorAxis.Center,
    AnchorAxis.End,
    AnchorAxis.Stretch,
];

/** The UINode box fields one axis of a preset writes. `size` is present only for
 *  Stretch — every other mode leaves the authored width/height untouched. */
interface AxisFields {
    near: Dimension;
    far: Dimension;
    marginNear: Dimension;
    marginFar: Dimension;
    size?: Dimension;
}

function axisFields(mode: AnchorAxis): AxisFields {
    switch (mode) {
        case AnchorAxis.Start:
            return { near: px(0), far: auto(), marginNear: px(0), marginFar: px(0) };
        case AnchorAxis.End:
            return { near: auto(), far: px(0), marginNear: px(0), marginFar: px(0) };
        case AnchorAxis.Center:
            return { near: auto(), far: auto(), marginNear: auto(), marginFar: auto() };
        case AnchorAxis.Stretch:
            return { near: px(0), far: px(0), marginNear: px(0), marginFar: px(0), size: auto() };
    }
}

/** The UINode fields a preset resolves to. Always sets `position` Absolute plus
 *  the two inset + two margin dimensions per axis; `width`/`height` appear only
 *  for a Stretch axis (so a non-stretch axis preserves the authored size). */
export interface AnchorFields {
    position: number;
    insetLeft: Dimension;
    insetRight: Dimension;
    insetTop: Dimension;
    insetBottom: Dimension;
    marginLeft: Dimension;
    marginRight: Dimension;
    marginTop: Dimension;
    marginBottom: Dimension;
    width?: Dimension;
    height?: Dimension;
}

/** Resolve a preset to the UINode box fields that express it. */
export function anchorPresetFields(preset: AnchorPreset): AnchorFields {
    const h = axisFields(preset.h);
    const v = axisFields(preset.v);
    const fields: AnchorFields = {
        position: UIPositionType.Absolute,
        insetLeft: h.near,
        insetRight: h.far,
        insetTop: v.near,
        insetBottom: v.far,
        marginLeft: h.marginNear,
        marginRight: h.marginFar,
        marginTop: v.marginNear,
        marginBottom: v.marginFar,
    };
    if (h.size) fields.width = h.size;
    if (v.size) fields.height = v.size;
    return fields;
}

/** Classify one axis back to its {@link AnchorAxis}, or null when the field
 *  combination isn't a clean preset (a hand-tuned / over-constrained box). */
function axisMode(near: Dimension, far: Dimension, mNear: Dimension, mFar: Dimension, size: Dimension): AnchorAxis | null {
    const nearAuto = isAuto(near);
    const farAuto = isAuto(far);
    if (nearAuto && farAuto) {
        return isAuto(mNear) && isAuto(mFar) ? AnchorAxis.Center : null;
    }
    if (!nearAuto && !farAuto) {
        return isAuto(size) ? AnchorAxis.Stretch : null; // pinned both + definite size = over-constrained
    }
    if (!nearAuto && !isAuto(mNear)) return AnchorAxis.Start; // near pinned, far auto
    if (!farAuto && !isAuto(mFar)) return AnchorAxis.End; // far pinned, near auto
    return null;
}

/** The preset a UINode currently matches, or null (Relative flow, or a custom
 *  box that isn't a clean preset). `detectAnchor(node with anchorPresetFields(p))`
 *  round-trips back to `p`. */
export function detectAnchor(node: UINodeData): AnchorPreset | null {
    if (node.position !== UIPositionType.Absolute) return null;
    const h = axisMode(node.insetLeft, node.insetRight, node.marginLeft, node.marginRight, node.width);
    const v = axisMode(node.insetTop, node.insetBottom, node.marginTop, node.marginBottom, node.height);
    if (h === null || v === null) return null;
    return { h, v };
}
