/**
 * @file    Component.hpp
 * @brief   Built-in ECS components for ESEngine
 * @details Provides common components used in game development including
 *          Transform, Velocity, Sprite, and tag components. Components
 *          are plain data structures that contain no logic.
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
#include "../math/Math.hpp"

namespace esengine::ecs {

// =============================================================================
// Transform Component
// =============================================================================

/**
 * @brief 3D transform component for position, rotation, and scale
 *
 * @details Stores spatial transformation data for an entity.
 *          Rotation is stored as Euler angles in radians (XYZ order).
 *
 * @code
 * Entity e = registry.create();
 * registry.emplace<Transform>(e, glm::vec3(10.0f, 0.0f, 0.0f));
 *
 * auto& transform = registry.get<Transform>(e);
 * transform.rotation.y = glm::radians(45.0f);
 * glm::mat4 model = transform.getMatrix();
 * @endcode
 */
struct Transform {
    /** @brief World position */
    glm::vec3 position{0.0f, 0.0f, 0.0f};
    /** @brief Rotation as Euler angles in radians (pitch, yaw, roll) */
    glm::vec3 rotation{0.0f, 0.0f, 0.0f};
    /** @brief Scale factors */
    glm::vec3 scale{1.0f, 1.0f, 1.0f};

    /** @brief Default constructor (identity transform) */
    Transform() = default;

    /**
     * @brief Constructs transform with position only
     * @param pos Initial position
     */
    Transform(const glm::vec3& pos) : position(pos) {}

    /**
     * @brief Constructs transform with full parameters
     * @param pos Initial position
     * @param rot Initial rotation (Euler angles in radians)
     * @param scl Initial scale
     */
    Transform(const glm::vec3& pos, const glm::vec3& rot, const glm::vec3& scl)
        : position(pos), rotation(rot), scale(scl) {}

    /**
     * @brief Computes the 4x4 model matrix
     * @return Combined translation * rotation * scale matrix
     *
     * @details Rotation order is X (pitch), Y (yaw), Z (roll).
     */
    glm::mat4 getMatrix() const {
        glm::mat4 model = glm::mat4(1.0f);
        model = glm::translate(model, position);
        model = glm::rotate(model, rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
        model = glm::rotate(model, rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
        model = glm::rotate(model, rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));
        model = glm::scale(model, scale);
        return model;
    }
};

// =============================================================================
// Velocity Component
// =============================================================================

/**
 * @brief Velocity component for physics simulation
 *
 * @details Stores linear and angular velocity for movement and rotation.
 *          Used by physics systems to update Transform components.
 */
struct Velocity {
    /** @brief Linear velocity (units per second) */
    glm::vec3 linear{0.0f};
    /** @brief Angular velocity (radians per second) */
    glm::vec3 angular{0.0f};

    /** @brief Default constructor (zero velocity) */
    Velocity() = default;

    /**
     * @brief Constructs with linear velocity only
     * @param lin Linear velocity vector
     */
    Velocity(const glm::vec3& lin) : linear(lin) {}

    /**
     * @brief Constructs with both linear and angular velocity
     * @param lin Linear velocity vector
     * @param ang Angular velocity vector
     */
    Velocity(const glm::vec3& lin, const glm::vec3& ang) : linear(lin), angular(ang) {}
};

// =============================================================================
// Sprite Component
// =============================================================================

/**
 * @brief 2D sprite component for rendering
 *
 * @details Contains all data needed to render a 2D sprite including
 *          texture reference, color tint, size, UV coordinates, and
 *          sorting layer.
 *
 * @code
 * Entity e = registry.create();
 * auto& sprite = registry.emplace<Sprite>(e, textureId);
 * sprite.color = glm::vec4(1.0f, 0.5f, 0.5f, 1.0f); // Red tint
 * sprite.layer = 10; // Render on top
 * @endcode
 */
struct Sprite {
    /** @brief GPU texture handle (0 for no texture) */
    u32 textureId{0};
    /** @brief Color tint (RGBA, 0-1 range) */
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};
    /** @brief Sprite size in world units */
    glm::vec2 size{1.0f, 1.0f};
    /** @brief UV coordinate offset for sprite sheets */
    glm::vec2 uvOffset{0.0f, 0.0f};
    /** @brief UV coordinate scale for sprite sheets */
    glm::vec2 uvScale{1.0f, 1.0f};
    /** @brief Sorting layer (higher = rendered on top) */
    i32 layer{0};

    /** @brief Default constructor (white, no texture) */
    Sprite() = default;

    /**
     * @brief Constructs sprite with texture
     * @param texId GPU texture handle
     */
    Sprite(u32 texId) : textureId(texId) {}

    /**
     * @brief Constructs sprite with texture and color tint
     * @param texId GPU texture handle
     * @param col Color tint
     */
    Sprite(u32 texId, const glm::vec4& col) : textureId(texId), color(col) {}
};

// =============================================================================
// Tag Components
// =============================================================================

/**
 * @brief Tag component marking an entity as active
 * @details Empty component used for filtering. Entities without this
 *          tag may be skipped by certain systems.
 */
struct Active {};

/**
 * @brief Tag component marking an entity as visible
 * @details Empty component used for filtering. Rendering systems
 *          typically only process entities with this tag.
 */
struct Visible {};

/**
 * @brief Tag component marking an entity as static (non-moving)
 * @details Empty component used for filtering. Physics and transform
 *          systems may skip entities with this tag for optimization.
 */
struct Static {};

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
    Name(const std::string& name) : value(name) {}

    /**
     * @brief Constructs with name (move)
     * @param name The name string (moved)
     */
    Name(std::string&& name) : value(std::move(name)) {}
};

}  // namespace esengine::ecs
