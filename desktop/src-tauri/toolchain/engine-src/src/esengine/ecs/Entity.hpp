/**
 * @file    Entity.hpp
 * @brief   Entity types and utilities for the ECS system
 * @details Provides entity versioning, handle encoding/decoding,
 *          and entity traits. The core Entity type is defined in Types.hpp.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"

namespace esengine::ecs {

// =============================================================================
// Entity Versioning
// =============================================================================

/**
 * @brief Entity with version information for safe recycling
 *
 * @details When entities are destroyed and recycled, the version
 *          is incremented. This allows detecting stale entity references.
 */
struct EntityVersion {
    /** @brief The entity ID */
    Entity id;
    /** @brief Version number (incremented on recycle) */
    u32 version;
};

// =============================================================================
// Entity Handle Functions
// =============================================================================

/**
 * @brief Combines entity ID and version into a single 64-bit handle
 * @param id The entity ID (lower 32 bits)
 * @param version The version number (upper 32 bits)
 * @return A packed 64-bit handle
 *
 * @see getEntityId(), getEntityVersion()
 */
inline constexpr u64 makeEntityHandle(Entity id, u32 version) {
    return (static_cast<u64>(version) << 32) | static_cast<u64>(id);
}

/**
 * @brief Extracts the entity ID from a packed handle
 * @param handle The 64-bit entity handle
 * @return The entity ID
 */
inline constexpr Entity getEntityId(u64 handle) {
    return static_cast<Entity>(handle & 0xFFFFFFFF);
}

/**
 * @brief Extracts the version from a packed handle
 * @param handle The 64-bit entity handle
 * @return The version number
 */
inline constexpr u32 getEntityVersion(u64 handle) {
    return static_cast<u32>(handle >> 32);
}

// =============================================================================
// Entity Traits
// =============================================================================

/**
 * @brief Utility traits for working with entities
 *
 * @details Provides static helper functions for common entity operations.
 *
 * @code
 * Entity e = registry.create();
 * if (EntityTraits::isValid(e)) {
 *     // Use entity
 * }
 * @endcode
 */
struct EntityTraits {
    /**
     * @brief Returns the null/invalid entity value
     * @return INVALID_ENTITY constant
     */
    static constexpr Entity null() { return INVALID_ENTITY; }

    /**
     * @brief Checks if an entity ID is valid (not null)
     * @param entity The entity to check
     * @return True if entity != INVALID_ENTITY
     * @note This only checks the ID value, not registry validity
     */
    static constexpr bool isValid(Entity entity) { return entity != INVALID_ENTITY; }
};

}  // namespace esengine::ecs
