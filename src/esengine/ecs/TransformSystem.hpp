/**
 * @file    TransformSystem.hpp
 * @brief   System for computing hierarchical world transforms
 * @details Manages the computation of WorldTransform matrices from
 *          LocalTransform components, respecting parent-child hierarchy.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "System.hpp"
#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "../math/Math.hpp"

// Standard library
#include <algorithm>

namespace esengine::ecs {

// =============================================================================
// TransformSystem
// =============================================================================

/**
 * @brief System that computes world-space transforms from local transforms
 *
 * @details This system processes entities with LocalTransform and computes
 *          their WorldTransform matrices. It handles hierarchical transforms
 *          by processing parents before children.
 *
 * Features:
 * - Respects Parent/Children hierarchy
 * - Uses dirty flags for optimization
 * - Caches world-space position/rotation/scale for convenience
 *
 * @code
 * SystemGroup systems;
 * systems.createSystem<TransformSystem>();
 *
 * // In game loop:
 * systems.update(registry, deltaTime);
 * // WorldTransform is now up-to-date for all entities
 * @endcode
 */
class TransformSystem : public System {
public:
    TransformSystem() {
        setPriority(-100);  // Run early, before other systems need transforms
    }

    void init(Registry& registry) override {
        (void)registry;
    }

    void update(Registry& registry, f32 deltaTime) override {
        (void)deltaTime;
        updateDirtyTransforms(registry);
    }

private:
    void updateDirtyTransforms(Registry& registry) {
        registry.each<LocalTransform>([&registry, this](Entity entity, LocalTransform& local) {
            registry.getOrEmplace<WorldTransform>(entity);

            if (!registry.has<Parent>(entity)) {
                bool isStatic = registry.has<TransformStatic>(entity);
                bool isDirty = registry.has<TransformDirty>(entity);

                if (isStatic && !isDirty) {
                    return;
                }

                updateEntityTransform(registry, entity, local, glm::mat4(1.0f), true);
            }
        });
    }

    void updateEntityTransform(Registry& registry, Entity entity,
                                const LocalTransform& local,
                                const glm::mat4& parentWorldMatrix,
                                bool parentDirty) {
        bool isDirty = parentDirty || registry.has<TransformDirty>(entity);

        if (registry.has<TransformStatic>(entity) && !isDirty) {
            auto* children = registry.tryGet<Children>(entity);
            if (children) {
                const auto& world = registry.get<WorldTransform>(entity);
                for (Entity child : children->entities) {
                    if (registry.valid(child)) {
                        auto* childLocal = registry.tryGet<LocalTransform>(child);
                        if (childLocal) {
                            updateEntityTransform(registry, child, *childLocal, world.matrix, false);
                        }
                    }
                }
            }
            return;
        }

        glm::mat4 localMatrix = math::compose(local.position, local.rotation, local.scale);
        glm::mat4 worldMatrix = parentWorldMatrix * localMatrix;

        auto& world = registry.get<WorldTransform>(entity);
        world.matrix = worldMatrix;
        math::decompose(worldMatrix, world.position, world.rotation, world.scale);

        if (isDirty && !parentDirty) {
            registry.remove<TransformDirty>(entity);
        }

        auto* children = registry.tryGet<Children>(entity);
        if (children) {
            for (Entity child : children->entities) {
                if (registry.valid(child)) {
                    auto* childLocal = registry.tryGet<LocalTransform>(child);
                    if (childLocal) {
                        updateEntityTransform(registry, child, *childLocal, worldMatrix, isDirty);
                    }
                }
            }
        }
    }
};

// =============================================================================
// Hierarchy Utilities
// =============================================================================

/**
 * @brief Sets the parent of an entity, updating both Parent and Children components
 *
 * @param registry The ECS registry
 * @param child The child entity
 * @param newParent The new parent entity (INVALID_ENTITY to unparent)
 *
 * @code
 * Entity parent = registry.create();
 * Entity child = registry.create();
 * setParent(registry, child, parent);
 * @endcode
 */
inline void setParent(Registry& registry, Entity child, Entity newParent) {
    // Remove from old parent if exists
    if (registry.has<Parent>(child)) {
        Entity oldParent = registry.get<Parent>(child).entity;
        if (registry.valid(oldParent) && registry.has<Children>(oldParent)) {
            auto& oldChildren = registry.get<Children>(oldParent);
            auto it = std::find(oldChildren.entities.begin(),
                               oldChildren.entities.end(), child);
            if (it != oldChildren.entities.end()) {
                oldChildren.entities.erase(it);
            }
        }

        if (newParent == INVALID_ENTITY) {
            registry.remove<Parent>(child);
        }
    }

    // Set new parent
    if (newParent != INVALID_ENTITY && registry.valid(newParent)) {
        if (registry.has<Parent>(child)) {
            registry.get<Parent>(child).entity = newParent;
        } else {
            registry.emplace<Parent>(child, newParent);
        }

        // Add to new parent's children list
        if (!registry.has<Children>(newParent)) {
            registry.emplace<Children>(newParent);
        }
        registry.get<Children>(newParent).entities.push_back(child);

        // Update hierarchy depth
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

    // Mark transform as dirty
    if (!registry.has<TransformDirty>(child)) {
        registry.emplace<TransformDirty>(child);
    }
}

/**
 * @brief Gets the root ancestor of an entity
 *
 * @param registry The ECS registry
 * @param entity The entity to find root for
 * @return The root entity (entity itself if no parent)
 */
inline Entity getRoot(Registry& registry, Entity entity) {
    while (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return entity;
}

/**
 * @brief Checks if an entity is a descendant of another
 *
 * @param registry The ECS registry
 * @param entity The potential descendant
 * @param ancestor The potential ancestor
 * @return true if entity is a descendant of ancestor
 */
inline bool isDescendantOf(Registry& registry, Entity entity, Entity ancestor) {
    while (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (parent == ancestor) return true;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return false;
}

/**
 * @brief Destroys an entity and all its descendants
 *
 * @param registry The ECS registry
 * @param entity The entity to destroy with its children
 */
inline void destroyWithChildren(Registry& registry, Entity entity) {
    // Recursively destroy children first
    if (registry.has<Children>(entity)) {
        auto children = registry.get<Children>(entity).entities;  // Copy to avoid iteration issues
        for (Entity child : children) {
            if (registry.valid(child)) {
                destroyWithChildren(registry, child);
            }
        }
    }

    // Remove from parent's children list
    if (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (registry.valid(parent) && registry.has<Children>(parent)) {
            auto& parentChildren = registry.get<Children>(parent);
            auto it = std::find(parentChildren.entities.begin(),
                               parentChildren.entities.end(), entity);
            if (it != parentChildren.entities.end()) {
                parentChildren.entities.erase(it);
            }
        }
    }

    // Destroy the entity
    registry.destroy(entity);
}

}  // namespace esengine::ecs
