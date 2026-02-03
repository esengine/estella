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

#include <glm/glm.hpp>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

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

/**
 * @brief Tag component marking an entity as a folder for organization
 *
 * @details Folders are containers for organizing entities in the hierarchy.
 *          They have no transform or visual representation, just grouping.
 */
struct Folder {};

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

// =============================================================================
// Script Components
// =============================================================================

/** @brief Value type for script component fields */
using ScriptFieldValue = std::variant<
    f32,
    i32,
    bool,
    std::string,
    glm::vec2,
    glm::vec3,
    glm::vec4,
    u32  // Entity reference
>;

/**
 * @brief Instance of a script component attached to an entity
 */
struct ScriptInstance {
    std::string componentName;
    std::unordered_map<std::string, ScriptFieldValue> values;
};

/**
 * @brief Component storing all script instances for an entity
 */
struct Scripts {
    std::vector<ScriptInstance> instances;

    /** @brief Check if entity has a specific script component */
    bool has(const std::string& name) const {
        for (const auto& inst : instances) {
            if (inst.componentName == name) return true;
        }
        return false;
    }

    /** @brief Get script instance by name (nullptr if not found) */
    ScriptInstance* get(const std::string& name) {
        for (auto& inst : instances) {
            if (inst.componentName == name) return &inst;
        }
        return nullptr;
    }

    const ScriptInstance* get(const std::string& name) const {
        for (const auto& inst : instances) {
            if (inst.componentName == name) return &inst;
        }
        return nullptr;
    }

    /** @brief Add a script instance */
    void add(ScriptInstance&& instance) {
        instances.push_back(std::move(instance));
    }

    /** @brief Remove script instance by name */
    void remove(const std::string& name) {
        instances.erase(
            std::remove_if(instances.begin(), instances.end(),
                [&name](const ScriptInstance& inst) { return inst.componentName == name; }),
            instances.end());
    }
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
