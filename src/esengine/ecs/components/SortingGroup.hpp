// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SortingGroup.hpp
 * @brief   Makes a subtree sort as ONE unit against the rest of the scene.
 * @details A character assembled from sprites — body, arm, weapon, cape — has an internal
 *          front-to-back order that must hold, and an external position among everything else.
 *          Without a group those are the same number: raising the weapon above another
 *          character's sprite raises it above its own body too, and the only fix is to hand out
 *          globally-unique orders across every entity that might ever overlap.
 *
 *          The group states the external promise, so its members no longer have to. Inside it
 *          each member's own `order` means "where in THIS group", and the group's `layer`/`order`
 *          is what the whole subtree presents outward. Nothing outside can land between two
 *          members, which is the property a per-sprite order cannot offer at all.
 *
 *          Nesting takes the NEAREST enclosing group: an inner group is itself a member of the
 *          outer one, so a weapon's own sub-assembly travels with the arm holding it.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

/**
 * @brief One sorting identity for an entity and everything under it.
 */
ES_COMPONENT(stability=beta)
struct SortingGroup {
    /** @brief The sorting layer the whole group presents outward. */
    ES_PROPERTY(step=1, enum_source=sortingLayers,
                tooltip="Sorting layer for the entire group — members no longer state their own.")
    i32 layer{0};

    /** @brief Where the group sits inside that layer; higher draws on top. */
    ES_PROPERTY(step=1, min=-128, max=127,
                tooltip="Draw order of the whole group inside its sorting layer — higher draws on top.")
    i32 order{0};

    /** @brief A disabled group is not a group: members sort on their own again. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs
