// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ContentRect.hpp
 * @brief   The rectangle a piece of world content occupies: a size, and the point of it the entity's transform sits on.
 * @details A `Sprite` has a size and a pivot, a `Text` a box and a box pivot, and an entity that draws nothing — a clipping region,
 *          a scroll view's viewport, a touch area — has neither. Content laid out as nodes in the world (an imported scene, a
 *          hand-built HUD) wants ONE rectangle that all of those read: the renderer sizes its quad by it, the mask clips to it, a
 *          pointer is tested against it.
 *
 *          It is not a layout. `UINode` is the engine's box layout (flex, insets, percentages) and does not go away: this is for
 *          content positioned by its `Transform`, where the box does not depend on its siblings. When an entity has both, the
 *          layout's computed box wins for clipping, as before.
 *
 *          A `Sprite` or `Text` on the same entity takes its size and pivot from here instead of its own (`ContentRectPlugin`), so
 *          the rectangle is written in one place and the renderers follow it.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

#include <glm/glm.hpp>

namespace esengine::ecs {

/**
 * @brief The rectangle of this entity's content, in its own units.
 */
ES_COMPONENT(stability=experimental)
struct ContentRect {
    /** @brief Width and height in local units, before the transform's scale. */
    ES_PROPERTY(min=0, tooltip="Width and height of the content in local units (before scale).")
    glm::vec2 size{100.0f, 100.0f};

    /** @brief The point of the rectangle the transform sits on, as a fraction of its size. */
    ES_PROPERTY(normalized_of=size, tooltip="The point of the rectangle the entity sits on, as a fraction of its size (0.5,0.5 = centre). Rotation and scale turn about it.")
    glm::vec2 pivot{0.5f, 0.5f};
};

}  // namespace esengine::ecs
