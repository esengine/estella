// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ShadowCaster2D.hpp
 * @brief   Marks an entity as a 2D shadow occluder for the Lit lighting path.
 * @details The render collect path turns each enabled caster into the four world-space edges
 *          of a box placed by its Transform, and the 2D shadow pass DRAWS what those edges
 *          hide from each casting light into a screen-space mask. A Lit fragment then reads
 *          its light's channel of that mask. Drawn rather than solved per pixel, which is what
 *          lets a scene hold as many occluders as it has walls.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

/**
 * @brief A 2D shadow occluder. The box is centred on the entity's world position and
 *        turns with it; its size is its own, which is how a collider is placed too.
 */
ES_COMPONENT(renderable=enabled)
struct ShadowCaster2D {
    /** @brief Occluder box size in world units (full width/height; centered on the Transform). */
    ES_PROPERTY(animatable, min=0, tooltip="Occluder box size in world units (centred on the entity, turning with it).")
    glm::vec2 size{32.0f, 32.0f};

    /** @brief Disabled casters are skipped during collection. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs
