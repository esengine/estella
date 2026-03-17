#pragma once

#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "components/UIRect.hpp"
#include "components/Sprite.hpp"
#include "components/FlexContainer.hpp"
#include "components/FlexItem.hpp"

#include <algorithm>
#include <vector>
#include <cmath>

namespace esengine::ecs {

struct FlexChildItem {
    Entity entity;
    f32 grow;
    f32 shrink;
    f32 basis;
    i32 order;
    f32 main_size;
    f32 cross_size;
};

inline void uiFlexLayoutUpdate(Registry& registry) {
    registry.each<FlexContainer>([&](Entity entity, FlexContainer& flex) {
        if (!registry.has<UIRect>(entity) || !registry.has<Children>(entity)) return;

        auto& parentRect = registry.get<UIRect>(entity);
        auto& children = registry.get<Children>(entity);
        if (children.entities.empty()) return;

        f32 parentW = parentRect.computed_size_.x > 0.0f ? parentRect.computed_size_.x : parentRect.size.x;
        f32 parentH = parentRect.computed_size_.y > 0.0f ? parentRect.computed_size_.y : parentRect.size.y;
        f32 pivotX = parentRect.pivot.x;
        f32 pivotY = parentRect.pivot.y;

        // padding: x=left, y=top, z=right, w=bottom
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

        std::vector<FlexChildItem> items;
        items.reserve(children.entities.size());

        for (Entity child : children.entities) {
            if (!registry.valid(child)) continue;
            auto* childRect = registry.tryGet<UIRect>(child);
            if (!childRect) continue;
            if (!registry.has<Transform>(child)) continue;

            FlexChildItem item;
            item.entity = child;

            auto* fi = registry.tryGet<FlexItem>(child);
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

        std::stable_sort(items.begin(), items.end(), [](const FlexChildItem& a, const FlexChildItem& b) {
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

        // justify-content positioning
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
            auto& transform = registry.get<Transform>(item.entity);

            f32 mainPos = cursor;
            cursor += item.main_size;
            if (i < n - 1) cursor += gap;

            // align-items positioning on cross axis
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

            transform.position.x = localX;
            transform.position.y = localY;

            childRect.computed_size_.x = finalW;
            childRect.computed_size_.y = finalH;
            auto* sprite = registry.tryGet<Sprite>(item.entity);
            if (sprite) {
                if (sprite->size.x != finalW || sprite->size.y != finalH) {
                    sprite->size.x = finalW;
                    sprite->size.y = finalH;
                }
            }
        }
    });
}

}  // namespace esengine::ecs
