// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LODMember.hpp
 * @brief   A MeshRenderer that is one level of a group whose levels are whole entities, not one mesh swapped for another.
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
#include "../../math/Math.hpp"

namespace esengine::ecs {

/**
 * @brief Draws the MeshRenderer beside it only while @ref group's LODGroup, as each view measures it, chooses @ref level.
 *
 * @details For levels that differ in more than their mesh (a groom's strands and its cards). The group entity's LODGroup gives the
 *          sizes and no stand-in meshes; the renderer chooses once per view per frame for the whole group, so members agree, a
 *          shadow follows its view, and an editor can hold a level up.
 */
ES_COMPONENT(stability=experimental)
struct LODMember {
    /** @brief The entity whose LODGroup chooses the level. */
    ES_PROPERTY(entity_ref, tooltip="The entity whose LODGroup chooses the level this draws at.")
    u32 group{0};

    /** @brief The level this draws at: 0 the finest, 1 below the group's LOD 1 screen size, and so on. */
    ES_PROPERTY(min=0, max=3, step=1, tooltip="The level of the group this draws at: 0 the finest, 1 below its LOD 1 screen size.")
    i32 level{0};

    /** @brief The centre of the sphere the group is measured by, in the group entity's space. */
    ES_PROPERTY(tooltip="Centre of the sphere the group is measured by, in the group entity's space.")
    glm::vec3 boundsCentre{0.0f};

    /** @brief The radius of that sphere. */
    ES_PROPERTY(min=0, tooltip="Radius of the sphere the group is measured by.")
    f32 boundsRadius{0.0f};

    LODMember() = default;
};

}  // namespace esengine::ecs
