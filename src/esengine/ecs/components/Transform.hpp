/**
 * @file    Transform.hpp
 * @brief   Transform components for spatial positioning
 * @details Provides LocalTransform for relative positioning and WorldTransform
 *          for cached world-space matrices. Uses quaternions for rotation.
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
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

// =============================================================================
// Local Transform Component
// =============================================================================

/**
 * @brief Local transform relative to parent (or world if no parent)
 *
 * @details Stores spatial transformation data using quaternion for rotation
 *          to avoid gimbal lock. This component represents the transform
 *          relative to the entity's parent. If no Parent component exists,
 *          this is equivalent to world space.
 *
 * @note Rotation is stored as a quaternion. Use math::eulerToQuat() and
 *       math::quatToEuler() for conversion if needed.
 *
 * @code
 * Entity e = registry.create();
 * registry.emplace<LocalTransform>(e, glm::vec3(10.0f, 0.0f, 0.0f));
 *
 * auto& transform = registry.get<LocalTransform>(e);
 * transform.rotation = glm::angleAxis(glm::radians(45.0f), glm::vec3(0, 1, 0));
 * @endcode
 */
ES_COMPONENT()
struct LocalTransform {
    /** @brief Position relative to parent */
    ES_PROPERTY()
    glm::vec3 position{0.0f, 0.0f, 0.0f};

    /** @brief Rotation as quaternion (no gimbal lock) */
    ES_PROPERTY()
    glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};  // Identity quaternion (w, x, y, z)

    /** @brief Scale factors */
    ES_PROPERTY()
    glm::vec3 scale{1.0f, 1.0f, 1.0f};

    /** @brief Default constructor (identity transform) */
    LocalTransform() = default;

    /**
     * @brief Constructs transform with position only
     * @param pos Initial position
     */
    explicit LocalTransform(const glm::vec3& pos) : position(pos) {}

    /**
     * @brief Constructs transform with position and rotation
     * @param pos Initial position
     * @param rot Initial rotation (quaternion)
     */
    LocalTransform(const glm::vec3& pos, const glm::quat& rot)
        : position(pos), rotation(rot) {}

    /**
     * @brief Constructs transform with full parameters
     * @param pos Initial position
     * @param rot Initial rotation (quaternion)
     * @param scl Initial scale
     */
    LocalTransform(const glm::vec3& pos, const glm::quat& rot, const glm::vec3& scl)
        : position(pos), rotation(rot), scale(scl) {}
};

// =============================================================================
// World Transform Component (Cached)
// =============================================================================

/**
 * @brief Cached world-space transform matrix
 *
 * @details This component is managed by the TransformSystem. It stores
 *          the final world-space transformation matrix computed from the
 *          hierarchy of LocalTransform components.
 *
 * @note Do not modify this component directly - it will be overwritten
 *       by TransformSystem. Modify LocalTransform instead.
 */
ES_COMPONENT()
struct WorldTransform {
    /** @brief Combined world-space transformation matrix */
    ES_PROPERTY()
    glm::mat4 matrix{1.0f};

    /** @brief World-space position (extracted from matrix for convenience) */
    ES_PROPERTY()
    glm::vec3 position{0.0f, 0.0f, 0.0f};

    /** @brief World-space rotation (extracted from matrix) */
    ES_PROPERTY()
    glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};

    /** @brief World-space scale (extracted from matrix) */
    ES_PROPERTY()
    glm::vec3 scale{1.0f, 1.0f, 1.0f};

    WorldTransform() = default;
};

// =============================================================================
// Transform Dirty Flag
// =============================================================================

/**
 * @brief Tag component indicating transform needs recalculation
 *
 * @details Added when LocalTransform is modified. TransformSystem will
 *          recalculate WorldTransform for all entities with this tag
 *          and then remove the tag.
 */
struct TransformDirty {};

}  // namespace esengine::ecs
