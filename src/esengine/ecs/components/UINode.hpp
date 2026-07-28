// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/UITypes.hpp"     // Dimension
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"        // glm::vec2 (computed output)

namespace esengine::ecs {

/**
 * @brief Per-item cross-axis alignment override (CSS align-self). Lives on
 *        UINode since UINode carries the flex-item properties (the standalone
 *        FlexItem component was subsumed by UINode and removed).
 */
ES_ENUM()
enum class AlignSelf : u8 {
    Auto,
    Start,
    Center,
    End,
    Stretch
};

/**
 * @brief Box positioning scheme. Absolute takes the node out of flex flow and
 *        places it by `inset` against the parent's box — this is how anchor /
 *        stretch (the old RectTransform use cases) are expressed in the CSS
 *        model: e.g. inset 0 on all edges = stretch
 *        to fill; top+right set = anchor to the top-right corner.
 */
ES_ENUM()
enum class UIPositionType : u8 {
    Relative,
    Absolute
};

/**
 * @brief CSS `display`. None removes the node AND its whole subtree from
 *        layout, rendering, and hit-testing — the hierarchical show/hide
 *        primitive (a closed dialog, a collapsed panel). Contrast with
 *        UIVisual.enabled, which hides only that entity's own visual.
 */
ES_ENUM()
enum class UIDisplay : u8 {
    Flex,
    None
};

/**
 * @brief CSS `pointer-events`. None makes the node AND its whole subtree
 *        transparent to the pointer — still drawn, but hits pass straight
 *        through to whatever is behind. The hierarchical input gate (a panel
 *        mid-fade, a decorative overlay). Contrast with Interactable.enabled,
 *        which silences one entity without letting hits through it.
 */
ES_ENUM()
enum class UIPointerEvents : u8 {
    Auto,
    None
};

/**
 * @brief UINode — the CSS box-model layout input (the CSS/Flex
 *        primary layout model).
 *
 * Replaces the RectTransform anchor/offset/pivot model (UIRect) as the primary
 * way to author UI geometry: every size is a Dimension (px / percent / auto), fed
 * straight into the single-pass Yoga solver. Anchors live on the optional
 * UIAnchors component for holdouts. `unit` literals below: 0=Px, 1=Percent,
 * 2=Auto (mirrors the TS DimensionUnit enum).
 *
 * Container properties (direction/justify/align/gap) stay on FlexContainer
 * (folded into UILayout in F4). Absolute positioning (position + inset) is added
 * when the layout pass implements it.
 */
ES_COMPONENT()
struct UINode {
    // Positioning: Relative = in flex flow; Absolute = placed by `inset`.
    ES_PROPERTY()
    UIPositionType position{UIPositionType::Relative};

    ES_PROPERTY(tooltip="None removes this node and its whole subtree from layout, rendering and input.")
    UIDisplay display{UIDisplay::Flex};

    /**
     * Subtree opacity, multiplied down the tree like CSS `opacity` — the one
     * knob that fades a whole panel. It multiplies into each descendant's own
     * alpha (it does NOT composite the subtree offscreen first), so overlapping
     * children show through one another mid-fade; that is the cheap, universal
     * behaviour, and the same trade every UI toolkit's group-alpha makes.
     */
    ES_PROPERTY(min=0, max=1, tooltip="Subtree opacity, multiplied down the tree. Fades this node and everything under it.")
    f32 opacity{1.0f};

    ES_PROPERTY(tooltip="None makes this node and its subtree transparent to the pointer — hits pass through to what is behind.")
    UIPointerEvents pointerEvents{UIPointerEvents::Auto};

    // Box size; auto = content-/flex-driven.
    ES_PROPERTY()
    Dimension width{0.0f, 2};
    ES_PROPERTY()
    Dimension height{0.0f, 2};
    ES_PROPERTY()
    Dimension minWidth{0.0f, 2};
    ES_PROPERTY()
    Dimension minHeight{0.0f, 2};
    ES_PROPERTY()
    Dimension maxWidth{0.0f, 2};
    ES_PROPERTY()
    Dimension maxHeight{0.0f, 2};

    // Flex item behaviour.
    ES_PROPERTY()
    f32 flexGrow{0.0f};
    ES_PROPERTY()
    f32 flexShrink{1.0f};
    ES_PROPERTY()
    Dimension flexBasis{0.0f, 2};
    ES_PROPERTY()
    AlignSelf alignSelf{AlignSelf::Auto};

    // Outer margin (px by default).
    ES_PROPERTY()
    Dimension marginLeft{0.0f, 0};
    ES_PROPERTY()
    Dimension marginTop{0.0f, 0};
    ES_PROPERTY()
    Dimension marginRight{0.0f, 0};
    ES_PROPERTY()
    Dimension marginBottom{0.0f, 0};

    // Inset (offset from the parent's edges) for Absolute positioning;
    // auto = that edge is unconstrained (size/flow decides). Mirrors CSS
    // left/top/right/bottom.
    ES_PROPERTY()
    Dimension insetLeft{0.0f, 2};
    ES_PROPERTY()
    Dimension insetTop{0.0f, 2};
    ES_PROPERTY()
    Dimension insetRight{0.0f, 2};
    ES_PROPERTY()
    Dimension insetBottom{0.0f, 2};

    // Layout output (not serialized): resolved px size written by the Yoga pass.
    glm::vec2 computed_size_{0.0f};

    // Computed (not serialized): true when this node or any ancestor has
    // display None. Written by the layout pass; read by rendering, text and
    // hit-testing so the whole subtree disappears from all three.
    bool hidden_in_tree_{false};

    // Computed (not serialized), same pass and same contract as hidden_in_tree_:
    // the product of this node's `opacity` and every ancestor's, and whether any
    // ancestor (or this node) turned pointer events off. Rendering multiplies the
    // first in; hit-testing skips on the second. Consumers stay tree-unaware.
    f32 alpha_in_tree_{1.0f};
    bool pointer_blocked_in_tree_{false};

    // Set by the tween system for Transform fields it drives, so the layout pass
    // leaves those fields alone this frame (cleared each frame).
    u8 anim_override_{0};
    static constexpr u8 ANIM_POS_X   = 1;
    static constexpr u8 ANIM_POS_Y   = 2;
    static constexpr u8 ANIM_ROT_Z   = 4;
    static constexpr u8 ANIM_SCALE_X = 8;
    static constexpr u8 ANIM_SCALE_Y = 16;

    UINode() = default;
};

}  // namespace esengine::ecs
