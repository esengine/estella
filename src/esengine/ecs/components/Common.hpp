/**
 * @file    Common.hpp
 * @brief   Common tag and identifier components
 * @details Provides Name, UUID, and various tag components for entity metadata.
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

#include <string>

namespace esengine::ecs {

// =============================================================================
// Tag Components
// =============================================================================

/**
 * @brief Tag component marking an entity as active
 *
 * @details Empty component used for filtering. Entities without this
 *          tag may be skipped by certain systems.
 */
struct Active {};

/**
 * @brief Tag component marking an entity as visible
 *
 * @details Empty component used for filtering. Rendering systems
 *          typically only process entities with this tag.
 */
struct Visible {};

/**
 * @brief Tag component marking an entity as static (non-moving)
 *
 * @details Empty component used for optimization. Physics and transform
 *          systems may skip entities with this tag.
 */
struct Static {};

/**
 * @brief Tag component marking an entity as the main/primary entity
 *
 * @details Used for singleton-like entities (main camera, player, etc.)
 */
struct MainEntity {};

// =============================================================================
// Name Component
// =============================================================================

/**
 * @brief Name component for debugging and identification
 *
 * @details Attaches a human-readable name to an entity for debugging,
 *          editor display, or lookup purposes.
 *
 * @code
 * Entity player = registry.create();
 * registry.emplace<Name>(player, "Player");
 * @endcode
 */
struct Name {
    /** @brief The entity's name */
    std::string value;

    /** @brief Default constructor (empty name) */
    Name() = default;

    /**
     * @brief Constructs with name (copy)
     * @param name The name string
     */
    explicit Name(const std::string& name) : value(name) {}

    /**
     * @brief Constructs with name (move)
     * @param name The name string (moved)
     */
    explicit Name(std::string&& name) : value(std::move(name)) {}

    /**
     * @brief Constructs with C-string
     * @param name The name string
     */
    explicit Name(const char* name) : value(name) {}
};

// =============================================================================
// UUID Component
// =============================================================================

/**
 * @brief Universally Unique Identifier component
 *
 * @details Provides a stable identifier for entities that persists across
 *          save/load cycles. Useful for serialization and cross-references.
 */
struct UUID {
    /** @brief The unique identifier */
    u64 value{0};

    UUID() = default;
    explicit UUID(u64 id) : value(id) {}

    bool operator==(const UUID& other) const { return value == other.value; }
    bool operator!=(const UUID& other) const { return value != other.value; }
};

}  // namespace esengine::ecs

// =============================================================================
// Std Hash Support for UUID
// =============================================================================

namespace std {

template<>
struct hash<esengine::ecs::UUID> {
    size_t operator()(const esengine::ecs::UUID& uuid) const noexcept {
        return hash<esengine::u64>{}(uuid.value);
    }
};

}  // namespace std
