// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "UILayoutSystem.hpp"
#include "UISystem.hpp"

#include "components/Transform.hpp"
#include "components/Canvas.hpp"
#include "components/FlexContainer.hpp"
#include "components/UINode.hpp"   // UINode + AlignSelf

#include <yoga/Yoga.h>
#include <unordered_map>
#include <vector>

namespace esengine::ecs {

namespace {

// =============================================================================
// Flex enum → Yoga mappers (shared by the UINode container + item styling)
// =============================================================================

YGFlexDirection toYGFlexDirection(FlexDirection dir) {
    switch (dir) {
        case FlexDirection::Row:            return YGFlexDirectionRow;
        case FlexDirection::Column:         return YGFlexDirectionColumn;
        case FlexDirection::RowReverse:     return YGFlexDirectionRowReverse;
        case FlexDirection::ColumnReverse:  return YGFlexDirectionColumnReverse;
    }
    return YGFlexDirectionRow;
}

YGWrap toYGWrap(FlexWrap wrap) {
    switch (wrap) {
        case FlexWrap::NoWrap: return YGWrapNoWrap;
        case FlexWrap::Wrap:   return YGWrapWrap;
    }
    return YGWrapNoWrap;
}

YGJustify toYGJustify(JustifyContent jc) {
    switch (jc) {
        case JustifyContent::Start:        return YGJustifyFlexStart;
        case JustifyContent::Center:       return YGJustifyCenter;
        case JustifyContent::End:          return YGJustifyFlexEnd;
        case JustifyContent::SpaceBetween: return YGJustifySpaceBetween;
        case JustifyContent::SpaceAround:  return YGJustifySpaceAround;
        case JustifyContent::SpaceEvenly:  return YGJustifySpaceEvenly;
    }
    return YGJustifyFlexStart;
}

YGAlign toYGAlign(AlignItems ai) {
    switch (ai) {
        case AlignItems::Start:   return YGAlignFlexStart;
        case AlignItems::Center:  return YGAlignCenter;
        case AlignItems::End:     return YGAlignFlexEnd;
        case AlignItems::Stretch: return YGAlignStretch;
    }
    return YGAlignStretch;
}

YGAlign toYGAlignContent(AlignContent ac) {
    switch (ac) {
        case AlignContent::Start:        return YGAlignFlexStart;
        case AlignContent::Center:       return YGAlignCenter;
        case AlignContent::End:          return YGAlignFlexEnd;
        case AlignContent::Stretch:      return YGAlignStretch;
        case AlignContent::SpaceBetween: return YGAlignSpaceBetween;
        case AlignContent::SpaceAround:  return YGAlignSpaceAround;
    }
    return YGAlignFlexStart;
}

YGAlign toYGAlignSelf(AlignSelf as) {
    switch (as) {
        case AlignSelf::Auto:    return YGAlignAuto;
        case AlignSelf::Start:   return YGAlignFlexStart;
        case AlignSelf::Center:  return YGAlignCenter;
        case AlignSelf::End:     return YGAlignFlexEnd;
        case AlignSelf::Stretch: return YGAlignStretch;
    }
    return YGAlignAuto;
}

// =============================================================================
// UINode (CSS box) → single-pass Yoga (the single layout model)
// =============================================================================
//
// A UINode subtree is laid out by ONE Yoga solve: each entity becomes a YGNode,
// the hierarchy is mirrored, the root is sized to its available box, and one
// YGNodeCalculateLayout resolves the whole subtree. Output is written as the
// engine's center-based, y-up local Transform (implicit pivot 0.5, matching
// UIElementPlugin) plus UINode.computed_size_ (read by the renderer/hit-test).

// Dimension.unit codes — mirror the TS DimensionUnit enum.
constexpr u8 DIM_PX = 0, DIM_PERCENT = 1, DIM_AUTO = 2;

void applyWidth(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetWidthPercent(n, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetWidthAuto(n);
    else YGNodeStyleSetWidth(n, d.value);
}
void applyHeight(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetHeightPercent(n, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetHeightAuto(n);
    else YGNodeStyleSetHeight(n, d.value);
}
// min/max have no Yoga "auto"; Auto means "no constraint" → leave unset.
void applyMinWidth(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMinWidthPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMinWidth(n, d.value);
}
void applyMinHeight(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMinHeightPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMinHeight(n, d.value);
}
void applyMaxWidth(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMaxWidthPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMaxWidth(n, d.value);
}
void applyMaxHeight(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMaxHeightPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMaxHeight(n, d.value);
}
void applyFlexBasis(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetFlexBasisPercent(n, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetFlexBasisAuto(n);
    else YGNodeStyleSetFlexBasis(n, d.value);
}
void applyMargin(YGNodeRef n, YGEdge edge, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMarginPercent(n, edge, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetMarginAuto(n, edge);
    else YGNodeStyleSetMargin(n, edge, d.value);
}
void applyInset(YGNodeRef n, YGEdge edge, const Dimension& d) {
    // Auto = that edge is unconstrained; leave it unset so size/flow decides.
    if (d.unit == DIM_PERCENT) YGNodeStyleSetPositionPercent(n, edge, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetPosition(n, edge, d.value);
}

void applyUINodeStyle(Registry& registry, Entity entity, YGNodeRef yg) {
    auto& n = registry.get<UINode>(entity);
    YGNodeStyleSetPositionType(yg, n.position == UIPositionType::Absolute
        ? YGPositionTypeAbsolute : YGPositionTypeRelative);
    applyInset(yg, YGEdgeLeft, n.insetLeft);
    applyInset(yg, YGEdgeTop, n.insetTop);
    applyInset(yg, YGEdgeRight, n.insetRight);
    applyInset(yg, YGEdgeBottom, n.insetBottom);
    applyWidth(yg, n.width);
    applyHeight(yg, n.height);
    applyMinWidth(yg, n.minWidth);
    applyMinHeight(yg, n.minHeight);
    applyMaxWidth(yg, n.maxWidth);
    applyMaxHeight(yg, n.maxHeight);
    YGNodeStyleSetFlexGrow(yg, n.flexGrow);
    YGNodeStyleSetFlexShrink(yg, n.flexShrink);
    applyFlexBasis(yg, n.flexBasis);
    YGNodeStyleSetAlignSelf(yg, toYGAlignSelf(n.alignSelf));
    applyMargin(yg, YGEdgeLeft, n.marginLeft);
    applyMargin(yg, YGEdgeTop, n.marginTop);
    applyMargin(yg, YGEdgeRight, n.marginRight);
    applyMargin(yg, YGEdgeBottom, n.marginBottom);

    // Container properties still come from FlexContainer (folded into UILayout in F4).
    if (auto* fc = registry.tryGet<FlexContainer>(entity)) {
        YGNodeStyleSetFlexDirection(yg, toYGFlexDirection(fc->direction));
        YGNodeStyleSetFlexWrap(yg, toYGWrap(fc->wrap));
        YGNodeStyleSetJustifyContent(yg, toYGJustify(fc->justifyContent));
        YGNodeStyleSetAlignItems(yg, toYGAlign(fc->alignItems));
        YGNodeStyleSetAlignContent(yg, toYGAlignContent(fc->alignContent));
        YGNodeStyleSetGap(yg, YGGutterColumn, fc->gap.x);
        YGNodeStyleSetGap(yg, YGGutterRow, fc->gap.y);
        YGNodeStyleSetPadding(yg, YGEdgeLeft, fc->padding.left);
        YGNodeStyleSetPadding(yg, YGEdgeTop, fc->padding.top);
        YGNodeStyleSetPadding(yg, YGEdgeRight, fc->padding.right);
        YGNodeStyleSetPadding(yg, YGEdgeBottom, fc->padding.bottom);
    }
}

// Lay out the UINode subtree rooted at tree index `rootIdx` in one Yoga solve.
// `availW/H` + `parentPivot*` describe the available box the root sits in.
void layoutUINodeSubtree(
    Registry& registry, UITree& tree, i32 rootIdx,
    f32 availW, f32 availH, f32 parentPivotX, f32 parentPivotY
) {
    i32 begin = rootIdx;
    i32 end = rootIdx + tree.nodes_[rootIdx].subtree_size;

    std::vector<YGNodeRef> yg(static_cast<usize>(end - begin), nullptr);
    std::unordered_map<Entity, i32> slotOf;  // entity → local slot index
    for (i32 k = begin; k < end; ++k) {
        Entity e = tree.nodes_[k].entity;
        if (!registry.has<UINode>(e)) continue;  // tree is homogeneously UINode
        YGNodeRef node = YGNodeNew();
        applyUINodeStyle(registry, e, node);
        yg[static_cast<usize>(k - begin)] = node;
        slotOf[e] = k - begin;
    }
    YGNodeRef rootYG = yg[0];
    if (!rootYG) return;

    for (i32 k = begin + 1; k < end; ++k) {
        YGNodeRef child = yg[static_cast<usize>(k - begin)];
        if (!child) continue;
        auto it = slotOf.find(tree.nodes_[k].parent);
        if (it == slotOf.end()) continue;
        YGNodeRef parentYG = yg[static_cast<usize>(it->second)];
        YGNodeInsertChild(parentYG, child, YGNodeGetChildCount(parentYG));
    }

    // The root fills the available box on axes it leaves auto.
    auto& rootNode = registry.get<UINode>(tree.nodes_[begin].entity);
    if (rootNode.width.unit == DIM_AUTO) YGNodeStyleSetWidth(rootYG, availW);
    if (rootNode.height.unit == DIM_AUTO) YGNodeStyleSetHeight(rootYG, availH);

    YGNodeCalculateLayout(rootYG, availW, availH, YGDirectionLTR);

    for (i32 k = begin; k < end; ++k) {
        YGNodeRef node = yg[static_cast<usize>(k - begin)];
        if (!node) continue;
        Entity e = tree.nodes_[k].entity;
        auto& un = registry.get<UINode>(e);
        f32 fw = YGNodeLayoutGetWidth(node);
        f32 fh = YGNodeLayoutGetHeight(node);
        un.computed_size_.x = fw;
        un.computed_size_.y = fh;

        // Position frame = the parent box (root's available box, else the parent
        // UINode whose computed_size_ is already set — DFS order guarantees it).
        f32 pw, ph, ppx, ppy;
        if (k == begin) {
            pw = availW; ph = availH; ppx = parentPivotX; ppy = parentPivotY;
        } else {
            auto& pn = registry.get<UINode>(tree.nodes_[k].parent);
            pw = pn.computed_size_.x; ph = pn.computed_size_.y; ppx = 0.5f; ppy = 0.5f;
        }
        f32 yl = YGNodeLayoutGetLeft(node);
        f32 yt = YGNodeLayoutGetTop(node);
        // Center-based, y-up local position (implicit pivot 0.5).
        f32 localX = -ppx * pw + yl + 0.5f * fw;
        f32 localY = (1.0f - ppy) * ph - yt - 0.5f * fh;

        if (auto* t = registry.tryGet<Transform>(e)) {
            // Leave tween-driven position axes alone (see TweenSystem anim_override_).
            if (!(un.anim_override_ & UINode::ANIM_POS_X)) t->position.x = localX;
            if (!(un.anim_override_ & UINode::ANIM_POS_Y)) t->position.y = localY;
        }
        tree.nodes_[k].flags &= ~(LAYOUT_DIRTY | HAS_DIRTY_CHILD);
    }

    YGNodeFreeRecursive(rootYG);
}

void unifiedLayoutPass(Registry& registry, UITree& tree, const LayoutRect& cameraRect) {
    for (i32 i = 0; i < static_cast<i32>(tree.nodes_.size()); ) {
        auto& node = tree.nodes_[i];

        if (!(node.flags & (LAYOUT_DIRTY | HAS_DIRTY_CHILD))) {
            i += node.subtree_size;
            continue;
        }

        // Every node is a UINode. A subtree root (its parent is not a UINode —
        // a top-level UI element / Canvas) is resolved in one Yoga solve over its
        // whole subtree; skip past it. The available box is the camera rect.
        bool parentIsUINode = node.parent != INVALID_ENTITY && registry.has<UINode>(node.parent);
        if (!parentIsUINode) {
            f32 availW = cameraRect.right - cameraRect.left;
            f32 availH = cameraRect.top - cameraRect.bottom;
            layoutUINodeSubtree(registry, tree, i, availW, availH, 0.5f, 0.5f);
        }
        i += node.subtree_size;
    }
}

}  // anonymous namespace

// =============================================================================
// UISystem layout entry (defined here to share the anon-namespace helpers)
// =============================================================================

void UISystem::layoutUpdate(
    Registry& registry,
    f32 camLeft, f32 camBottom, f32 camRight, f32 camTop
) {
    tree.rebuild(registry);
    LayoutRect cameraRect{ camLeft, camBottom, camRight, camTop };
    unifiedLayoutPass(registry, tree, cameraRect);
}

void UISystem::treeMarkStructureDirty() {
    tree.structure_dirty_ = true;
}

void UISystem::treeMarkDirty(Entity entity) {
    tree.markDirty(entity);
}

}  // namespace esengine::ecs
