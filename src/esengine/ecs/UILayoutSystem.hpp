#pragma once

#include "Registry.hpp"
#include "UITree.hpp"
#include "components/Transform.hpp"
#include "components/UIRect.hpp"
#include "components/Sprite.hpp"
#include "components/Canvas.hpp"
#include "components/FlexContainer.hpp"
#include "components/FlexItem.hpp"
#include "components/LayoutGroup.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

namespace esengine::ecs {

struct LayoutRect {
    f32 left;
    f32 bottom;
    f32 right;
    f32 top;
};

struct LayoutResult {
    f32 origin_x;
    f32 origin_y;
    LayoutRect rect;
};

inline LayoutResult computeAnchorLayout(
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

inline LayoutRect getParentLayoutRect(
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

inline void writePosition(
    Registry& registry,
    const UITree::Node& node,
    f32 originX, f32 originY,
    const LayoutRect& cameraRect
) {
    auto* transform = registry.tryGet<Transform>(node.entity);
    if (!transform) return;

    transform->position.x = originX;
    transform->position.y = originY;
}

inline void layoutNodeAnchor(
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

struct UnifiedFlexItem {
    i32 tree_index;
    Entity entity;
    f32 grow;
    f32 shrink;
    f32 basis;
    i32 order;
    f32 main_size;
    f32 cross_size;
};

inline void resolveFlexChildren(
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

    f32 padLeft = flex.padding.left;
    f32 padTop = flex.padding.top;
    f32 padRight = flex.padding.right;
    f32 padBottom = flex.padding.bottom;

    bool isRow = (flex.direction == FlexDirection::Row || flex.direction == FlexDirection::RowReverse);
    bool isReverse = (flex.direction == FlexDirection::RowReverse || flex.direction == FlexDirection::ColumnReverse);

    f32 contentW = parentW - padLeft - padRight;
    f32 contentH = parentH - padTop - padBottom;
    f32 mainSpace = isRow ? contentW : contentH;
    f32 crossSpace = isRow ? contentH : contentW;
    f32 mainGap = isRow ? flex.gap.x : flex.gap.y;

    std::vector<UnifiedFlexItem> items;
    for (i32 j = containerIndex + 1; j < static_cast<i32>(tree.nodes_.size()); j++) {
        if (tree.nodes_[j].parent != containerEntity) continue;
        if (tree.nodes_[j].depth != tree.nodes_[containerIndex].depth + 1) continue;

        Entity childEntity = tree.nodes_[j].entity;
        auto* childRect = registry.tryGet<UIRect>(childEntity);
        if (!childRect) continue;

        UnifiedFlexItem item;
        item.tree_index = j;
        item.entity = childEntity;

        auto* fi = registry.tryGet<FlexItem>(childEntity);
        if (fi) {
            item.grow = fi->flexGrow;
            item.shrink = fi->flexShrink;
            item.basis = fi->flexBasis;
            item.order = fi->order;
        } else {
            item.grow = 0.0f;
            item.shrink = 1.0f;
            item.basis = -1.0f;
            item.order = 0;
        }

        f32 cw = childRect->computed_size_.x > 0.0f ? childRect->computed_size_.x : childRect->size.x;
        f32 ch = childRect->computed_size_.y > 0.0f ? childRect->computed_size_.y : childRect->size.y;

        if (item.basis >= 0.0f) {
            item.main_size = item.basis;
        } else {
            item.main_size = isRow ? cw : ch;
        }
        item.cross_size = isRow ? ch : cw;
        items.push_back(item);
    }

    if (items.empty()) return;

    std::stable_sort(items.begin(), items.end(), [](const UnifiedFlexItem& a, const UnifiedFlexItem& b) {
        return a.order < b.order;
    });

    if (isReverse) {
        std::reverse(items.begin(), items.end());
    }

    f32 totalMainSize = 0.0f;
    for (auto& item : items) {
        totalMainSize += item.main_size;
    }
    totalMainSize += mainGap * static_cast<f32>(items.size() - 1);

    f32 freeSpace = mainSpace - totalMainSize;

    if (freeSpace > 0.0f) {
        f32 totalGrow = 0.0f;
        for (auto& item : items) {
            totalGrow += item.grow;
        }
        if (totalGrow > 0.0f) {
            for (auto& item : items) {
                item.main_size += freeSpace * (item.grow / totalGrow);
            }
            freeSpace = 0.0f;
        }
    } else if (freeSpace < 0.0f) {
        f32 totalShrinkBasis = 0.0f;
        for (auto& item : items) {
            totalShrinkBasis += item.shrink * item.main_size;
        }
        if (totalShrinkBasis > 0.0f) {
            for (auto& item : items) {
                item.main_size += freeSpace * (item.shrink * item.main_size / totalShrinkBasis);
                item.main_size = std::max(0.0f, item.main_size);
            }
            freeSpace = 0.0f;
        }
    }

    f32 cursor = 0.0f;
    f32 gap = mainGap;
    usize n = items.size();

    switch (flex.justifyContent) {
        case JustifyContent::Start:
            cursor = 0.0f;
            break;
        case JustifyContent::Center:
            cursor = freeSpace * 0.5f;
            break;
        case JustifyContent::End:
            cursor = freeSpace;
            break;
        case JustifyContent::SpaceBetween:
            cursor = 0.0f;
            if (n > 1) gap = mainGap + freeSpace / static_cast<f32>(n - 1);
            break;
        case JustifyContent::SpaceAround:
            if (n > 0) {
                f32 spacePerItem = freeSpace / static_cast<f32>(n);
                cursor = spacePerItem * 0.5f;
                gap = mainGap + spacePerItem;
            }
            break;
        case JustifyContent::SpaceEvenly:
            if (n > 0) {
                f32 spaceUnit = freeSpace / static_cast<f32>(n + 1);
                cursor = spaceUnit;
                gap = mainGap + spaceUnit;
            }
            break;
    }

    for (usize i = 0; i < n; i++) {
        auto& item = items[i];
        auto& childRect = registry.get<UIRect>(item.entity);

        f32 mainPos = cursor;
        cursor += item.main_size;
        if (i < n - 1) cursor += gap;

        f32 crossPos = 0.0f;
        f32 finalCrossSize = item.cross_size;

        switch (flex.alignItems) {
            case AlignItems::Start:
                crossPos = 0.0f;
                break;
            case AlignItems::Center:
                crossPos = (crossSpace - finalCrossSize) * 0.5f;
                break;
            case AlignItems::End:
                crossPos = crossSpace - finalCrossSize;
                break;
            case AlignItems::Stretch:
                crossPos = 0.0f;
                finalCrossSize = crossSpace;
                break;
        }

        f32 finalW, finalH;
        f32 localX, localY;

        if (isRow) {
            finalW = item.main_size;
            finalH = finalCrossSize;
            f32 cpx = childRect.pivot.x;
            f32 cpy = childRect.pivot.y;
            localX = -pivotX * parentW + padLeft + mainPos + cpx * finalW;
            localY = (1.0f - pivotY) * parentH - padTop - crossPos - (1.0f - cpy) * finalH;
        } else {
            finalW = finalCrossSize;
            finalH = item.main_size;
            f32 cpx = childRect.pivot.x;
            f32 cpy = childRect.pivot.y;
            localX = -pivotX * parentW + padLeft + crossPos + cpx * finalW;
            localY = (1.0f - pivotY) * parentH - padTop - mainPos - (1.0f - cpy) * finalH;
        }

        auto* transform = registry.tryGet<Transform>(item.entity);
        if (transform) {
            transform->position.x = localX;
            transform->position.y = localY;
        }

        childRect.computed_size_.x = finalW;
        childRect.computed_size_.y = finalH;

        auto* sprite = registry.tryGet<Sprite>(item.entity);
        if (sprite) {
            if (sprite->size.x != finalW || sprite->size.y != finalH) {
                sprite->size.x = finalW;
                sprite->size.y = finalH;
            }
        }

        tree.nodes_[item.tree_index].flags &= ~LAYOUT_DIRTY;
    }
}

inline void resolveLayoutGroupChildren(
    Registry& registry,
    UITree& tree,
    i32 containerIndex,
    const LayoutRect& cameraRect
) {
    Entity containerEntity = tree.nodes_[containerIndex].entity;
    auto& group = registry.get<LayoutGroup>(containerEntity);
    auto& parentRect = registry.get<UIRect>(containerEntity);

    f32 pw = parentRect.computed_size_.x;
    f32 ph = parentRect.computed_size_.y;
    f32 pivotX = parentRect.pivot.x;
    f32 pivotY = parentRect.pivot.y;

    f32 padLeft = group.padding.left;
    f32 padTop = group.padding.top;
    f32 padRight = group.padding.right;
    f32 padBottom = group.padding.bottom;

    bool isHorizontal = (group.direction == LayoutDirection::Horizontal);

    struct ChildInfo {
        i32 tree_index;
        Entity entity;
        f32 w;
        f32 h;
    };

    std::vector<ChildInfo> children;
    for (i32 j = containerIndex + 1; j < static_cast<i32>(tree.nodes_.size()); j++) {
        if (tree.nodes_[j].parent != containerEntity) continue;
        if (tree.nodes_[j].depth != tree.nodes_[containerIndex].depth + 1) continue;

        Entity childEntity = tree.nodes_[j].entity;
        auto* childRect = registry.tryGet<UIRect>(childEntity);
        if (!childRect || !registry.has<Transform>(childEntity)) continue;

        f32 cw = childRect->computed_size_.x > 0.0f ? childRect->computed_size_.x : childRect->size.x;
        f32 ch = childRect->computed_size_.y > 0.0f ? childRect->computed_size_.y : childRect->size.y;
        children.push_back({j, childEntity, cw, ch});
    }

    if (children.empty()) return;

    if (group.reverseOrder) {
        std::reverse(children.begin(), children.end());
    }

    f32 cursor = 0.0f;
    for (usize i = 0; i < children.size(); i++) {
        auto& child = children[i];
        auto& childRect = registry.get<UIRect>(child.entity);
        f32 cpx = childRect.pivot.x;
        f32 cpy = childRect.pivot.y;

        f32 localX, localY;

        if (isHorizontal) {
            localX = -pivotX * pw + padLeft + cursor + cpx * child.w;
            if (group.childAlignment == ChildAlignment::Start) {
                localY = (1.0f - pivotY) * ph - padTop - (1.0f - cpy) * child.h;
            } else if (group.childAlignment == ChildAlignment::End) {
                localY = -pivotY * ph + padBottom + cpy * child.h;
            } else {
                localY = (0.5f - pivotY) * ph + (padBottom - padTop) * 0.5f + (cpy - 0.5f) * child.h;
            }
            cursor += child.w;
            if (i < children.size() - 1) cursor += group.spacing;
        } else {
            if (group.childAlignment == ChildAlignment::Start) {
                localX = -pivotX * pw + padLeft + cpx * child.w;
            } else if (group.childAlignment == ChildAlignment::End) {
                localX = (1.0f - pivotX) * pw - padRight - (1.0f - cpx) * child.w;
            } else {
                localX = (0.5f - pivotX) * pw + (padLeft - padRight) * 0.5f + (cpx - 0.5f) * child.w;
            }
            localY = (1.0f - pivotY) * ph - padTop - cursor - (1.0f - cpy) * child.h;
            cursor += child.h;
            if (i < children.size() - 1) cursor += group.spacing;
        }

        auto* transform = registry.tryGet<Transform>(child.entity);
        if (transform) {
            transform->position.x = localX;
            transform->position.y = localY;
        }

        tree.nodes_[child.tree_index].flags &= ~LAYOUT_DIRTY;
    }
}

inline void unifiedLayoutPass(Registry& registry, UITree& tree, const LayoutRect& cameraRect) {
    for (i32 i = 0; i < static_cast<i32>(tree.nodes_.size()); ) {
        auto& node = tree.nodes_[i];

        if (!(node.flags & (LAYOUT_DIRTY | HAS_DIRTY_CHILD))) {
            i += node.subtree_size;
            continue;
        }

        if (node.flags & LAYOUT_DIRTY) {
            bool isFlexChild = (node.parent != INVALID_ENTITY && registry.has<FlexContainer>(node.parent));
            bool isLayoutGroupChild = (node.parent != INVALID_ENTITY && registry.has<LayoutGroup>(node.parent));

            if (!isFlexChild && !isLayoutGroupChild) {
                layoutNodeAnchor(registry, node, cameraRect);
            }

            if (registry.has<FlexContainer>(node.entity)) {
                resolveFlexChildren(registry, tree, i, cameraRect);
            } else if (registry.has<LayoutGroup>(node.entity)) {
                resolveLayoutGroupChildren(registry, tree, i, cameraRect);
            }
        }

        node.flags &= ~(LAYOUT_DIRTY | HAS_DIRTY_CHILD);
        i++;
    }
}

static UITree s_ui_tree;

inline void uiLayoutUpdate(
    Registry& registry,
    f32 camLeft, f32 camBottom, f32 camRight, f32 camTop
) {
    s_ui_tree.rebuild(registry);
    LayoutRect cameraRect{ camLeft, camBottom, camRight, camTop };
    unifiedLayoutPass(registry, s_ui_tree, cameraRect);
}

inline UITree& getUITree() {
    return s_ui_tree;
}

inline void uiTreeMarkStructureDirty() {
    s_ui_tree.structure_dirty_ = true;
}

inline void uiTreeMarkDirty(Entity entity) {
    s_ui_tree.markDirty(entity);
}

}  // namespace esengine::ecs
