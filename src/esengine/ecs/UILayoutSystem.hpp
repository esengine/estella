// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Registry.hpp"
#include "UITree.hpp"

#include <glm/glm.hpp>

namespace esengine::ecs {

// The available box (camera rect) the UI subtree is laid out within.
struct LayoutRect {
    f32 left;
    f32 bottom;
    f32 right;
    f32 top;
};

// Layout and tree operations are methods on UISystem (see UISystem.hpp).
// Previously free functions (uiLayoutUpdate, getUITree, uiTreeMarkStructureDirty,
// uiTreeMarkDirty) lived here but held state in a file-level static; that
// state now lives on UISystem registered via EstellaContext.

}  // namespace esengine::ecs
