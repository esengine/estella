#pragma once

#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "components/UIRect.hpp"
#include "components/Sprite.hpp"
#include "components/Canvas.hpp"

#include <algorithm>
#include <cmath>

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

inline void layoutEntity(
    Registry& registry,
    Entity entity,
    const LayoutRect& parentRect,
    f32 parentOriginX,
    f32 parentOriginY,
    bool isRoot
) {
    auto* uiRect = registry.tryGet<UIRect>(entity);
    if (!uiRect) return;

    auto result = computeAnchorLayout(
        uiRect->anchorMin, uiRect->anchorMax,
        uiRect->offsetMin, uiRect->offsetMax,
        uiRect->size, parentRect, uiRect->pivot
    );

    f32 width = result.rect.right - result.rect.left;
    f32 height = result.rect.top - result.rect.bottom;
    uiRect->computed_width_ = width;
    uiRect->computed_height_ = height;

    auto* sprite = registry.tryGet<Sprite>(entity);
    if (sprite) {
        if (sprite->size.x != width || sprite->size.y != height) {
            sprite->size.x = width;
            sprite->size.y = height;
        }
    }

    if (!uiRect->layout_managed_) {
        auto* transform = registry.tryGet<Transform>(entity);
        if (transform) {
            if (isRoot) {
                transform->position.x = result.origin_x;
                transform->position.y = result.origin_y;
            } else {
                transform->position.x = result.origin_x - parentOriginX;
                transform->position.y = result.origin_y - parentOriginY;
            }
        }
    }

    auto* children = registry.tryGet<Children>(entity);
    if (!children) return;

    for (Entity child : children->entities) {
        if (registry.valid(child)) {
            layoutEntity(registry, child, result.rect, result.origin_x, result.origin_y, false);
        }
    }
}

inline void uiLayoutUpdate(
    Registry& registry,
    f32 camLeft, f32 camBottom, f32 camRight, f32 camTop
) {
    registry.each<UIRect>([](Entity, UIRect& rect) {
        rect.layout_managed_ = false;
    });

    LayoutRect cameraRect{ camLeft, camBottom, camRight, camTop };
    f32 cameraOriginX = (camLeft + camRight) * 0.5f;
    f32 cameraOriginY = (camBottom + camTop) * 0.5f;

    registry.each<Canvas>([&](Entity entity, Canvas&) {
        if (!registry.has<UIRect>(entity) || !registry.has<Transform>(entity)) return;
        layoutEntity(registry, entity, cameraRect, cameraOriginX, cameraOriginY, true);
    });
}

}  // namespace esengine::ecs
