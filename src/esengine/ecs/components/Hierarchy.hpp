/**
 * @file    Hierarchy.hpp
 * @brief   Hierarchy components for parent-child relationships
 * @details Provides Parent and Children components for building scene graphs.
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

#include "../../core/Types.hpp"

#include <vector>

namespace esengine::ecs {

// =============================================================================
// Parent Component
// =============================================================================

/**
 * @brief Parent reference component
 *
 * @details Links an entity to its parent in the scene hierarchy.
 *          Used together with Children component to form a tree structure.
 *
 * @code
 * Entity parent = registry.create();
 * Entity child = registry.create();
 *
 * registry.emplace<Parent>(child, parent);
 * registry.get<Children>(parent).entities.push_back(child);
 * @endcode
 */
struct Parent {
    /** @brief Parent entity ID */
    Entity entity = INVALID_ENTITY;

    Parent() = default;
    explicit Parent(Entity e) : entity(e) {}
};

// =============================================================================
// Children Component
// =============================================================================

/**
 * @brief Children list component
 *
 * @details Stores references to all child entities. Maintained in sync
 *          with Parent components by the hierarchy management system.
 */
struct Children {
    /** @brief List of child entity IDs */
    std::vector<Entity> entities;

    Children() = default;

    /**
     * @brief Check if entity has any children
     * @return true if has children
     */
    [[nodiscard]] bool empty() const { return entities.empty(); }

    /**
     * @brief Get number of children
     * @return Child count
     */
    [[nodiscard]] usize count() const { return entities.size(); }
};

// =============================================================================
// Hierarchy Depth Component
// =============================================================================

/**
 * @brief Cached hierarchy depth for sorting
 *
 * @details Used by TransformSystem to process transforms in correct order
 *          (parents before children). Updated when hierarchy changes.
 */
struct HierarchyDepth {
    /** @brief Depth level (0 = root, 1 = first level child, etc.) */
    u32 depth = 0;

    HierarchyDepth() = default;
    explicit HierarchyDepth(u32 d) : depth(d) {}
};

}  // namespace esengine::ecs
