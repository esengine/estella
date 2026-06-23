// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/ui-node.ts
 * @brief   UINode — the CSS box-model layout primitive (REARCH_GUI F3).
 *
 * The primary way to author UI geometry: every size is a {@link Dimension}
 * (px / percent / auto) fed straight into the single-pass Yoga solver, replacing
 * the RectTransform anchor/offset/pivot model. The per-item flex properties
 * (grow/shrink/basis/alignSelf/margin/min-max) live here — the standalone
 * FlexItem component was subsumed by UINode and removed (REARCH_GUI F4).
 * Container properties stay on {@link FlexContainer}. Mirrors the C++ `UINode`
 * builtin; `computed_size_` is C++-internal (not serialized). Construct lengths
 * with `px()/percent()/auto()`.
 */
import { defineBuiltin } from '../../component';
import { auto, px, type Dimension } from './dimension';

/** Positioning scheme (mirrors the C++ UIPositionType enum). */
export const UIPositionType = {
    /** In flex flow (default). */
    Relative: 0,
    /** Out of flow; placed by `inset` against the parent box — covers
     *  anchor/stretch (the old RectTransform cases). */
    Absolute: 1,
} as const;
export type UIPositionType = (typeof UIPositionType)[keyof typeof UIPositionType];

/** Per-item cross-axis alignment override (mirrors the C++ AlignSelf enum). */
export const AlignSelf = {
    Auto: 0,
    Start: 1,
    Center: 2,
    End: 3,
    Stretch: 4,
} as const;
export type AlignSelf = (typeof AlignSelf)[keyof typeof AlignSelf];

export interface UINodeData {
    /** Relative (flex flow) or Absolute (placed by inset). */
    position: number;
    /** Box size; `auto()` = content-/flex-driven. */
    width: Dimension;
    height: Dimension;
    minWidth: Dimension;
    minHeight: Dimension;
    maxWidth: Dimension;
    maxHeight: Dimension;
    /** Flex grow factor (share of free space; 0 = don't grow). */
    flexGrow: number;
    /** Flex shrink factor (1 = shrink to fit). */
    flexShrink: number;
    /** Base size before grow/shrink; `auto()` = use width/height or content. */
    flexBasis: Dimension;
    /** Per-item cross-axis alignment override (AlignSelf: 0 Auto…4 Stretch). */
    alignSelf: number;
    marginLeft: Dimension;
    marginTop: Dimension;
    marginRight: Dimension;
    marginBottom: Dimension;
    /** Offset from the parent's edges when `position` is Absolute; `auto()` =
     *  that edge is unconstrained. Mirrors CSS left/top/right/bottom. */
    insetLeft: Dimension;
    insetTop: Dimension;
    insetRight: Dimension;
    insetBottom: Dimension;
}

export const UINode = defineBuiltin<UINodeData>('UINode', {
    position: 0,
    width: auto(),
    height: auto(),
    minWidth: auto(),
    minHeight: auto(),
    maxWidth: auto(),
    maxHeight: auto(),
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: auto(),
    alignSelf: 0,
    marginLeft: px(0),
    marginTop: px(0),
    marginRight: px(0),
    marginBottom: px(0),
    insetLeft: auto(),
    insetTop: auto(),
    insetRight: auto(),
    insetBottom: auto(),
});
