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

// Layout and tree operations are methods on UISystem (see UISystem.hpp).
// Previously free functions (uiLayoutUpdate, getUITree, uiTreeMarkStructureDirty,
// uiTreeMarkDirty) lived here but held state in a file-level static; that
// state now lives on UISystem registered via EstellaContext.

}  // namespace esengine::ecs
