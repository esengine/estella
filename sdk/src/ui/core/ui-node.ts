// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/ui-node.ts
 * @brief   UINode — the CSS box-model layout primitive.
 *
 * The primary way to author UI geometry: every size is a {@link Dimension}
 * (px / percent / auto) fed straight into the single-pass Yoga solver. The
 * per-item flex properties (grow/shrink/basis/alignSelf/margin/min-max) live
 * here; container properties stay on {@link FlexContainer}. Mirrors the C++ `UINode`
 * builtin; `computed_size_` is C++-internal (not serialized). Construct lengths
 * with `px()/percent()/auto()`.
 */
import { defineBuiltin } from '../../component';
import { auto, px, type Dimension } from './dimension';

// Positioning scheme (Relative = in flex flow; Absolute = out of flow, placed by
// `inset` against the parent box — covers the old RectTransform anchor/stretch
// cases) and per-item cross-axis alignment override. Both single-sourced from
// the C++ ES_ENUMs via the generated module.
export { UIPositionType, UIDisplay, AlignSelf } from '../../wasm.generated';

export interface UINodeData {
    /** Relative (flex flow) or Absolute (placed by inset). */
    position: number;
    /** CSS `display` (UIDisplay). None removes this node AND its whole subtree
     *  from layout, rendering and hit-testing — the hierarchical show/hide.
     *  Contrast with UIVisual.enabled, which hides only this entity's visual. */
    display: number;
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
    display: 0,
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
