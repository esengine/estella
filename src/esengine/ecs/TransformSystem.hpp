/**
 * @file    TransformSystem.hpp
 * @brief   System for computing hierarchical world transforms
 * @details Computes world-space position/rotation/scale from local transform
 *          fields, respecting parent-child hierarchy.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "System.hpp"
#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "../math/Math.hpp"

#include <algorithm>

namespace esengine::ecs {

class TransformSystem : public System {
public:
    static constexpr u32 MAX_HIERARCHY_DEPTH = 256;

    TransformSystem() {
        setPriority(-100);
    }

    void init(Registry& registry) override {
        (void)registry;
    }

    void update(World& world) override {
        updateDirtyTransforms(world.registry);
    }

private:
    std::vector<Entity> dirty_to_clear_;

    void updateDirtyTransforms(Registry& registry) {
        dirty_to_clear_.clear();

        registry.each<Transform>([&registry, this](Entity entity, Transform& transform) {
            if (!registry.has<Parent>(entity)) {
                bool isStatic = registry.has<TransformStatic>(entity);
                bool isDirty = registry.has<TransformDirty>(entity);

                if (isStatic && !isDirty) {
                    auto* children = registry.tryGet<Children>(entity);
                    if (children) {
                        for (Entity child : children->entities) {
                            if (registry.valid(child)) {
                                auto* childTransform = registry.tryGet<Transform>(child);
                                if (childTransform) {
                                    updateEntityTransform(registry, child, *childTransform, transform.cachedMatrix_, false, 1);
                                }
                            }
                        }
                    }
                    return;
                }

                updateRootTransform(registry, entity, transform);
            }
        });

        for (Entity e : dirty_to_clear_) {
            if (registry.has<TransformDirty>(e)) {
                registry.remove<TransformDirty>(e);
            }
        }
    }

    void updateRootTransform(Registry& registry, Entity entity, Transform& transform) {
        transform.worldPosition = transform.position;
        transform.worldRotation = transform.rotation;
        transform.worldScale = transform.scale;
        transform.cachedMatrix_ = math::compose(transform.worldPosition, transform.worldRotation, transform.worldScale);
        transform.decomposed_ = true;

        if (registry.has<TransformDirty>(entity)) {
            dirty_to_clear_.push_back(entity);
        }

        auto* children = registry.tryGet<Children>(entity);
        if (children) {
            for (Entity child : children->entities) {
                if (registry.valid(child)) {
                    auto* childTransform = registry.tryGet<Transform>(child);
                    if (childTransform) {
                        updateEntityTransform(registry, child, *childTransform, transform.cachedMatrix_, true, 1);
                    }
                }
            }
        }
    }

    void updateEntityTransform(Registry& registry, Entity entity,
                                Transform& transform,
                                const glm::mat4& parentWorldMatrix,
                                bool parentDirty, u32 depth) {
        if (depth >= MAX_HIERARCHY_DEPTH) {
            return;
        }

        bool isDirty = parentDirty || registry.has<TransformDirty>(entity);

        if (registry.has<TransformStatic>(entity) && !isDirty) {
            auto* children = registry.tryGet<Children>(entity);
            if (children) {
                for (Entity child : children->entities) {
                    if (registry.valid(child)) {
                        auto* childTransform = registry.tryGet<Transform>(child);
                        if (childTransform) {
                            updateEntityTransform(registry, child, *childTransform, transform.cachedMatrix_, false, depth + 1);
                        }
                    }
                }
            }
            return;
        }

        glm::mat4 localMatrix = math::compose(transform.position, transform.rotation, transform.scale);
        glm::mat4 worldMatrix = parentWorldMatrix * localMatrix;

        transform.cachedMatrix_ = worldMatrix;
        transform.decomposed_ = false;

        if (isDirty && !parentDirty) {
            dirty_to_clear_.push_back(entity);
        }

        auto* children = registry.tryGet<Children>(entity);
        if (children) {
            for (Entity child : children->entities) {
                if (registry.valid(child)) {
                    auto* childTransform = registry.tryGet<Transform>(child);
                    if (childTransform) {
                        updateEntityTransform(registry, child, *childTransform, worldMatrix, isDirty, depth + 1);
                    }
                }
            }
        }
    }
};

inline bool isDescendantOf(Registry& registry, Entity entity, Entity ancestor) {
    while (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (parent == ancestor) return true;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return false;
}

inline void setParent(Registry& registry, Entity child, Entity newParent) {
    if (registry.has<Parent>(child)) {
        Entity oldParent = registry.get<Parent>(child).entity;
        if (registry.valid(oldParent) && registry.has<Children>(oldParent)) {
            auto& oldChildren = registry.get<Children>(oldParent);
            auto& vec = oldChildren.entities;
            auto it = std::find(vec.begin(), vec.end(), child);
            if (it != vec.end()) {
                *it = vec.back();
                vec.pop_back();
            }
        }

        if (newParent == INVALID_ENTITY) {
            registry.remove<Parent>(child);
        }
    }

    if (newParent != INVALID_ENTITY && registry.valid(newParent)) {
        if (child == newParent || isDescendantOf(registry, newParent, child)) {
            return;
        }

        if (registry.has<Parent>(child)) {
            registry.get<Parent>(child).entity = newParent;
        } else {
            registry.emplace<Parent>(child, newParent);
        }

        if (!registry.has<Children>(newParent)) {
            registry.emplace<Children>(newParent);
        }
        registry.get<Children>(newParent).entities.push_back(child);

        u32 parentDepth = 0;
        if (registry.has<HierarchyDepth>(newParent)) {
            parentDepth = registry.get<HierarchyDepth>(newParent).depth;
        }
        if (registry.has<HierarchyDepth>(child)) {
            registry.get<HierarchyDepth>(child).depth = parentDepth + 1;
        } else {
            registry.emplace<HierarchyDepth>(child, parentDepth + 1);
        }
    }

    if (!registry.has<TransformDirty>(child)) {
        registry.emplace<TransformDirty>(child);
    }
}

inline Entity getRoot(Registry& registry, Entity entity) {
    while (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return entity;
}

inline void destroyWithChildren(Registry& registry, Entity entity) {
    if (registry.has<Children>(entity)) {
        auto children = registry.get<Children>(entity).entities;
        for (Entity child : children) {
            if (registry.valid(child)) {
                destroyWithChildren(registry, child);
            }
        }
    }

    if (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (registry.valid(parent) && registry.has<Children>(parent)) {
            auto& parentChildren = registry.get<Children>(parent);
            auto& vec = parentChildren.entities;
            auto it = std::find(vec.begin(), vec.end(), entity);
            if (it != vec.end()) {
                *it = vec.back();
                vec.pop_back();
            }
        }
    }

    registry.destroy(entity);
}

}  // namespace esengine::ecs
