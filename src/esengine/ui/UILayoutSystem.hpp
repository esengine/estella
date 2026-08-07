// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../ecs/Registry.hpp"
#include "./UITree.hpp"

#include <glm/glm.hpp>

namespace esengine::ecs {

/**
 * The world-space box a UI subtree is laid out within — the "screen".
 *
 * Its SIZE is the available box Yoga solves against; its CENTER is where that
 * box sits in the world, which is what places a screen root (see
 * UILayoutSystem.cpp). Both matter: a box that only resized needs a new solve,
 * a box that only moved needs the roots repositioned and nothing else.
 */
struct LayoutRect {
    f32 left;
    f32 bottom;
    f32 right;
    f32 top;

    [[nodiscard]] f32 width() const { return right - left; }
    [[nodiscard]] f32 height() const { return top - bottom; }
    [[nodiscard]] f32 centerX() const { return 0.5f * (left + right); }
    [[nodiscard]] f32 centerY() const { return 0.5f * (bottom + top); }
};

// Layout and tree operations are methods on UISystem (see UISystem.hpp).
// Previously free functions (uiLayoutUpdate, getUITree, uiTreeMarkStructureDirty,
// uiTreeMarkDirty) lived here but held state in a file-level static; that
// state now lives on UISystem registered via EstellaContext.

}  // namespace esengine::ecs
