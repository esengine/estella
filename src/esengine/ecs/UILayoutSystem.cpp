// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "UILayoutSystem.hpp"
#include "UISystem.hpp"

#include "components/Transform.hpp"
#include "components/Sprite.hpp"
#include "components/Canvas.hpp"
#include "components/FlexContainer.hpp"
#include "components/FlexItem.hpp"
#include "components/GridLayout.hpp"
#include "components/UINode.hpp"

#include <yoga/Yoga.h>
#include <algorithm>
#include <cmath>
#include <unordered_map>
#include <vector>

namespace esengine::ecs {

LayoutResult computeAnchorLayout(
    const glm::vec2& anchorMin, const glm::vec2& anchorMax,
    const glm::vec2& offsetMin, const glm::vec2& offsetMax,
    const glm::vec2& size, const LayoutRect& parentRect,
    const glm::vec2& pivot
) {
    f32 parentW = parentRect.right - parentRect.left;
    f32 parentH = parentRect.top - parentRect.bottom;

    f32 aLeft = parentRect.left + anchorMin.x * parentW;
    f32 aRight = parentRect.left + anchorMax.x * parentW;
    f32 aBottom = parentRect.bottom + anchorMin.y * parentH;
    f32 aTop = parentRect.bottom + anchorMax.y * parentH;

    f32 myLeft, myBottom, myRight, myTop;

    if (anchorMin.x == anchorMax.x) {
        myLeft = aLeft + offsetMin.x - size.x * pivot.x;
        myRight = myLeft + size.x;
    } else {
        myLeft = aLeft + offsetMin.x;
        myRight = aRight + offsetMax.x;
    }

    if (anchorMin.y == anchorMax.y) {
        myBottom = aBottom + offsetMin.y - size.y * pivot.y;
        myTop = myBottom + size.y;
    } else {
        myBottom = aBottom + offsetMin.y;
        myTop = aTop + offsetMax.y;
    }

    f32 width = std::max(0.0f, myRight - myLeft);
    f32 height = std::max(0.0f, myTop - myBottom);
    f32 originX = myLeft + pivot.x * width;
    f32 originY = myBottom + pivot.y * height;

    return {
        originX,
        originY,
        { myLeft, myBottom, myLeft + width, myBottom + height },
    };
}

namespace {

LayoutRect getParentLayoutRect(
    Registry& registry,
    const UITree::Node& node,
    const LayoutRect& cameraRect
) {
    if (node.parent == INVALID_ENTITY) {
        return cameraRect;
    }
    auto& parentRect = registry.get<UIRect>(node.parent);
    f32 pw = parentRect.computed_size_.x;
    f32 ph = parentRect.computed_size_.y;
    return { -pw * parentRect.pivot.x, -ph * parentRect.pivot.y,
             pw * (1.0f - parentRect.pivot.x), ph * (1.0f - parentRect.pivot.y) };
}

void setLayoutPosition(Transform& t, UIRect* rect, f32 x, f32 y) {
    if (rect && rect->anim_override_) {
        if (!(rect->anim_override_ & UIRect::ANIM_POS_X)) t.position.x = x;
        if (!(rect->anim_override_ & UIRect::ANIM_POS_Y)) t.position.y = y;
    } else {
        t.position.x = x;
        t.position.y = y;
    }
}

void writePosition(
    Registry& registry,
    const UITree::Node& node,
    f32 originX, f32 originY,
    const LayoutRect& cameraRect
) {
    auto* transform = registry.tryGet<Transform>(node.entity);
    if (!transform) return;
    setLayoutPosition(*transform, registry.tryGet<UIRect>(node.entity), originX, originY);
}

void layoutNodeAnchor(
    Registry& registry,
    UITree::Node& node,
    const LayoutRect& cameraRect
) {
    auto& rect = registry.get<UIRect>(node.entity);
    LayoutRect parentRect = getParentLayoutRect(registry, node, cameraRect);

    auto result = computeAnchorLayout(
        rect.anchorMin, rect.anchorMax,
        rect.offsetMin, rect.offsetMax,
        rect.size, parentRect, rect.pivot
    );

    f32 width = result.rect.right - result.rect.left;
    f32 height = result.rect.top - result.rect.bottom;
    rect.computed_size_.x = width;
    rect.computed_size_.y = height;

    auto* sprite = registry.tryGet<Sprite>(node.entity);
    if (sprite) {
        if (sprite->size.x != width || sprite->size.y != height) {
            sprite->size.x = width;
            sprite->size.y = height;
        }
    }

    writePosition(registry, node, result.origin_x, result.origin_y, cameraRect);
}

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

struct FlexChildInfo {
    i32 tree_index;
    Entity entity;
};

void resolveFlexChildren(
    Registry& registry,
    UITree& tree,
    i32 containerIndex,
    const LayoutRect& cameraRect
) {
    Entity containerEntity = tree.nodes_[containerIndex].entity;
    auto& flex = registry.get<FlexContainer>(containerEntity);
    auto& parentRect = registry.get<UIRect>(containerEntity);

    f32 parentW = parentRect.computed_size_.x;
    f32 parentH = parentRect.computed_size_.y;
    f32 pivotX = parentRect.pivot.x;
    f32 pivotY = parentRect.pivot.y;

    std::vector<FlexChildInfo> children;
    for (i32 j = containerIndex + 1; j < static_cast<i32>(tree.nodes_.size()); j++) {
        if (tree.nodes_[j].parent != containerEntity) continue;
        if (tree.nodes_[j].depth != tree.nodes_[containerIndex].depth + 1) continue;
        Entity childEntity = tree.nodes_[j].entity;
        if (!registry.has<UIRect>(childEntity)) continue;
        children.push_back({j, childEntity});
    }

    if (children.empty()) return;

    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetFlexDirection(root, toYGFlexDirection(flex.direction));
    YGNodeStyleSetFlexWrap(root, toYGWrap(flex.wrap));
    YGNodeStyleSetJustifyContent(root, toYGJustify(flex.justifyContent));
    YGNodeStyleSetAlignItems(root, toYGAlign(flex.alignItems));
    YGNodeStyleSetWidth(root, parentW);
    YGNodeStyleSetHeight(root, parentH);
    YGNodeStyleSetPadding(root, YGEdgeLeft, flex.padding.left);
    YGNodeStyleSetPadding(root, YGEdgeTop, flex.padding.top);
    YGNodeStyleSetPadding(root, YGEdgeRight, flex.padding.right);
    YGNodeStyleSetPadding(root, YGEdgeBottom, flex.padding.bottom);
    YGNodeStyleSetAlignContent(root, toYGAlignContent(flex.alignContent));
    YGNodeStyleSetGap(root, YGGutterColumn, flex.gap.x);
    YGNodeStyleSetGap(root, YGGutterRow, flex.gap.y);

    std::vector<YGNodeRef> childNodes;
    childNodes.reserve(children.size());

    for (usize i = 0; i < children.size(); i++) {
        auto& childRect = registry.get<UIRect>(children[i].entity);
        f32 cw = childRect.computed_size_.x > 0.0f ? childRect.computed_size_.x : childRect.size.x;
        f32 ch = childRect.computed_size_.y > 0.0f ? childRect.computed_size_.y : childRect.size.y;

        YGNodeRef child = YGNodeNew();

        auto* fi = registry.tryGet<FlexItem>(children[i].entity);
        if (fi) {
            YGNodeStyleSetFlexGrow(child, fi->flexGrow);
            YGNodeStyleSetFlexShrink(child, fi->flexShrink);
            if (fi->flexBasis >= 0.0f) {
                YGNodeStyleSetFlexBasis(child, fi->flexBasis);
            } else {
                YGNodeStyleSetFlexBasisAuto(child);
            }
            YGNodeStyleSetAlignSelf(child, toYGAlignSelf(fi->alignSelf));
            YGNodeStyleSetMargin(child, YGEdgeLeft, fi->margin.left);
            YGNodeStyleSetMargin(child, YGEdgeTop, fi->margin.top);
            YGNodeStyleSetMargin(child, YGEdgeRight, fi->margin.right);
            YGNodeStyleSetMargin(child, YGEdgeBottom, fi->margin.bottom);
            if (fi->minWidth >= 0.0f) YGNodeStyleSetMinWidth(child, fi->minWidth);
            if (fi->minHeight >= 0.0f) YGNodeStyleSetMinHeight(child, fi->minHeight);
            if (fi->maxWidth >= 0.0f) YGNodeStyleSetMaxWidth(child, fi->maxWidth);
            if (fi->maxHeight >= 0.0f) YGNodeStyleSetMaxHeight(child, fi->maxHeight);
            if (fi->widthPercent >= 0.0f) {
                YGNodeStyleSetWidthPercent(child, fi->widthPercent);
            } else {
                YGNodeStyleSetWidth(child, cw);
            }
            if (fi->heightPercent >= 0.0f) {
                YGNodeStyleSetHeightPercent(child, fi->heightPercent);
            } else {
                YGNodeStyleSetHeight(child, ch);
            }
        } else {
            YGNodeStyleSetFlexGrow(child, 0.0f);
            YGNodeStyleSetFlexShrink(child, 1.0f);
            YGNodeStyleSetFlexBasisAuto(child);
            YGNodeStyleSetWidth(child, cw);
            YGNodeStyleSetHeight(child, ch);
        }

        YGNodeInsertChild(root, child, i);
        childNodes.push_back(child);
    }

    YGNodeCalculateLayout(root, parentW, parentH, YGDirectionLTR);

    for (usize i = 0; i < children.size(); i++) {
        auto& info = children[i];
        auto& childRect = registry.get<UIRect>(info.entity);

        f32 yogaLeft = YGNodeLayoutGetLeft(childNodes[i]);
        f32 yogaTop = YGNodeLayoutGetTop(childNodes[i]);
        f32 finalW = YGNodeLayoutGetWidth(childNodes[i]);
        f32 finalH = YGNodeLayoutGetHeight(childNodes[i]);

        f32 cpx = childRect.pivot.x;
        f32 cpy = childRect.pivot.y;
        f32 localX = -pivotX * parentW + yogaLeft + cpx * finalW;
        f32 localY = (1.0f - pivotY) * parentH - yogaTop - (1.0f - cpy) * finalH;

        auto* transform = registry.tryGet<Transform>(info.entity);
        if (transform) {
            setLayoutPosition(*transform, &childRect, localX, localY);
        }

        childRect.computed_size_.x = finalW;
        childRect.computed_size_.y = finalH;

        auto* sprite = registry.tryGet<Sprite>(info.entity);
        if (sprite) {
            if (sprite->size.x != finalW || sprite->size.y != finalH) {
                sprite->size.x = finalW;
                sprite->size.y = finalH;
            }
        }

        if (registry.has<FlexContainer>(info.entity)) {
            tree.nodes_[info.tree_index].flags |= LAYOUT_DIRTY;
        } else {
            tree.nodes_[info.tree_index].flags &= ~LAYOUT_DIRTY;
        }
    }

    YGNodeFreeRecursive(root);
}

void resolveGridLayoutChildren(
    Registry& registry,
    UITree& tree,
    i32 containerIndex,
    const LayoutRect& cameraRect
) {
    (void)cameraRect;
    Entity containerEntity = tree.nodes_[containerIndex].entity;
    auto& grid = registry.get<GridLayout>(containerEntity);
    auto& parentRect = registry.get<UIRect>(containerEntity);

    f32 pw = parentRect.computed_size_.x;
    f32 ph = parentRect.computed_size_.y;
    f32 pivotX = parentRect.pivot.x;
    f32 pivotY = parentRect.pivot.y;

    i32 cols = grid.crossAxisCount;
    if (cols < 1) cols = 1;
    f32 strideX = grid.itemSize.x + grid.spacing.x;
    f32 strideY = grid.itemSize.y + grid.spacing.y;
    bool isVertical = (grid.direction == GridDirection::Vertical);

    i32 childIdx = 0;
    for (i32 j = containerIndex + 1; j < static_cast<i32>(tree.nodes_.size()); j++) {
        if (tree.nodes_[j].parent != containerEntity) continue;
        if (tree.nodes_[j].depth != tree.nodes_[containerIndex].depth + 1) continue;

        Entity childEntity = tree.nodes_[j].entity;
        auto* childRect = registry.tryGet<UIRect>(childEntity);
        auto* transform = registry.tryGet<Transform>(childEntity);
        if (!childRect || !transform) continue;

        i32 col = isVertical ? childIdx % cols : childIdx / cols;
        i32 row = isVertical ? childIdx / cols : childIdx % cols;

        childRect->size = grid.itemSize;
        childRect->computed_size_ = grid.itemSize;

        f32 localX = -pivotX * pw + col * strideX + childRect->pivot.x * grid.itemSize.x;
        f32 localY = (1.0f - pivotY) * ph - row * strideY - (1.0f - childRect->pivot.y) * grid.itemSize.y;

        setLayoutPosition(*transform, childRect, localX, localY);

        tree.nodes_[j].flags &= ~LAYOUT_DIRTY;
        childIdx++;
    }
}

// =============================================================================
// UINode (CSS box) → single-pass Yoga (REARCH_GUI F3)
// =============================================================================
//
// A UINode subtree is laid out by ONE Yoga solve (unlike the legacy per-flex-
// container ephemeral trees): each entity becomes a YGNode, the hierarchy is
// mirrored, the root is sized to its parent's box, and one YGNodeCalculateLayout
// resolves the whole subtree. Output is written as the engine's center-based,
// y-up local Transform (implicit pivot 0.5, matching UIElementPlugin) plus
// UINode.computed_size_ (read by the renderer/hit-test).

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
// `availW/H` + `parentPivot*` describe the parent box the root is positioned in.
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
        if (!registry.has<UINode>(e)) continue;  // subtrees are homogeneously UINode
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

        // Position frame = parent box (the root's parent box, else the parent
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
            t->position.x = localX;
            t->position.y = localY;
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

        // UINode subtree (CSS box, REARCH_GUI F3): one Yoga solve at the subtree
        // root resolves the whole subtree, so skip past it afterward. The legacy
        // UIRect/anchor path below is untouched.
        if (registry.has<UINode>(node.entity)) {
            bool parentIsUINode = node.parent != INVALID_ENTITY && registry.has<UINode>(node.parent);
            if (!parentIsUINode) {
                f32 availW, availH, ppx, ppy;
                if (node.parent != INVALID_ENTITY && registry.has<UIRect>(node.parent)) {
                    auto& pr = registry.get<UIRect>(node.parent);
                    availW = pr.computed_size_.x; availH = pr.computed_size_.y;
                    ppx = pr.pivot.x; ppy = pr.pivot.y;
                } else {
                    availW = cameraRect.right - cameraRect.left;
                    availH = cameraRect.top - cameraRect.bottom;
                    ppx = 0.5f; ppy = 0.5f;
                }
                layoutUINodeSubtree(registry, tree, i, availW, availH, ppx, ppy);
            }
            i += node.subtree_size;
            continue;
        }

        if (node.flags & LAYOUT_DIRTY) {
            bool parentManaged = node.parent != INVALID_ENTITY && (
                registry.has<FlexContainer>(node.parent) ||
                registry.has<GridLayout>(node.parent)
            );

            if (!parentManaged) {
                layoutNodeAnchor(registry, node, cameraRect);
            }

            if (registry.has<FlexContainer>(node.entity)) {
                resolveFlexChildren(registry, tree, i, cameraRect);
            } else if (registry.has<GridLayout>(node.entity)) {
                resolveGridLayoutChildren(registry, tree, i, cameraRect);
            }
        }

        node.flags &= ~(LAYOUT_DIRTY | HAS_DIRTY_CHILD);
        i++;
    }
}

}  // anonymous namespace

// =============================================================================
// UISystem method impls that need the anonymous-namespace helpers above
// (hitTestUpdate lives in UISystem.cpp since it only needs UIHitTestSystem.hpp)
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
