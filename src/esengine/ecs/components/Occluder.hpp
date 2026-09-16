// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Occluder.hpp
 * @brief   A box sight does not pass through, so what stands behind it is not drawn.
 *          ShadowCaster2D answers where LIGHT stops; this answers where sight does.
 *
 * @author  ESEngine Team
 * @date    2026
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
 * @brief Declares a solid box a camera cannot see through.
 *
 * @details AUTHORED, not taken from the geometry: bounds CONTAIN a mesh, and a box
 *          claiming more than the surface fills makes things vanish in front of the
 *          player. World units about the entity, turned by its rotation; scale is
 *          not read — what every other extent here does, and what the gizmo draws.
 */
ES_COMPONENT(stability=beta)
struct Occluder {
    /** @brief Half the box, in world units, from the entity's position. The
     *         default fills an unscaled builtin cube exactly. */
    ES_PROPERTY(min=0, tooltip="Half the solid box, in world units, from the entity's position.")
    glm::vec3 halfExtents{50.0f, 50.0f, 50.0f};

    /** @brief Disabled occluders hide nothing, which is what every scene without
     *         one gets: the test costs a comparison and no object is ever refused. */
    ES_PROPERTY(tooltip="Off: this box hides nothing.")
    bool enabled{true};

    Occluder() = default;
};

}  // namespace esengine::ecs
