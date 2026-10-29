// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Registry.hpp"
#include "components/GroupOpacity.hpp"
#include "components/Hierarchy.hpp"

#include <algorithm>

namespace esengine::ecs {

/**
 * @brief The opacity a draw inherits from the GroupOpacity above it.
 *
 * @details Made once per collect. Most scenes have no group, and then `of` is a branch on a flag; with groups it walks the entity's ancestors,
 *          so the cost follows the depth of what is drawn, not the size of the scene.
 */
class GroupOpacityLookup {
public:
    explicit GroupOpacityLookup(Registry& registry) : registry_(registry) {
        auto groups = registry.view<GroupOpacity>();
        active_ = groups.begin() != groups.end();
    }

    bool active() const { return active_; }

    /// 1 when no enabled group encloses @p entity (itself included).
    f32 of(Entity entity) const {
        if (!active_) return 1.0f;
        f32 opacity = 1.0f;
        for (Entity current = entity; current != INVALID_ENTITY;) {
            if (const auto* group = registry_.tryGet<GroupOpacity>(current); group && group->enabled) {
                opacity *= std::clamp(group->opacity, 0.0f, 1.0f);
            }
            const auto* parent = registry_.tryGet<Parent>(current);
            current = parent ? parent->entity : INVALID_ENTITY;
        }
        return opacity;
    }

private:
    Registry& registry_;
    bool active_ = false;
};

}  // namespace esengine::ecs
