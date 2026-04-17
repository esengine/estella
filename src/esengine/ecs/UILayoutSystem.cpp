#include "UILayoutSystem.hpp"
#include "UISystem.hpp"

#include "components/Transform.hpp"
#include "components/Sprite.hpp"
#include "components/Canvas.hpp"
#include "components/FlexContainer.hpp"
#include "components/FlexItem.hpp"
#include "components/GridLayout.hpp"

#include <yoga/Yoga.h>
#include <algorithm>
#include <cmath>
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

void unifiedLayoutPass(Registry& registry, UITree& tree, const LayoutRect& cameraRect) {
    for (i32 i = 0; i < static_cast<i32>(tree.nodes_.size()); ) {
        auto& node = tree.nodes_[i];

        if (!(node.flags & (LAYOUT_DIRTY | HAS_DIRTY_CHILD))) {
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
