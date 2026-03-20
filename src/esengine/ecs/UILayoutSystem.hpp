#pragma once

#include "Registry.hpp"
#include "UITree.hpp"
#include "components/UIRect.hpp"

#include <glm/glm.hpp>

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

LayoutResult computeAnchorLayout(
    const glm::vec2& anchorMin, const glm::vec2& anchorMax,
    const glm::vec2& offsetMin, const glm::vec2& offsetMax,
    const glm::vec2& size, const LayoutRect& parentRect,
    const glm::vec2& pivot
);

void uiLayoutUpdate(
    Registry& registry,
    f32 camLeft, f32 camBottom, f32 camRight, f32 camTop
);

UITree& getUITree();
void uiTreeMarkStructureDirty();
void uiTreeMarkDirty(Entity entity);

}  // namespace esengine::ecs
