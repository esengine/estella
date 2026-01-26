/**
 * @file    Velocity.hpp
 * @brief   Velocity component for physics simulation
 * @details Provides Velocity component for linear and angular motion.
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
// Velocity Component
// =============================================================================

/**
 * @brief Velocity component for physics simulation
 *
 * @details Stores linear and angular velocity for movement and rotation.
 *          Used by physics systems to update LocalTransform components.
 *
 * @note Angular velocity is in radians per second around each axis.
 */
ES_COMPONENT()
struct Velocity {
    /** @brief Linear velocity (units per second) */
    ES_PROPERTY()
    glm::vec3 linear{0.0f};

    /** @brief Angular velocity (radians per second) */
    ES_PROPERTY()
    glm::vec3 angular{0.0f};

    /** @brief Default constructor (zero velocity) */
    Velocity() = default;

    /**
     * @brief Constructs with linear velocity only
     * @param lin Linear velocity vector
     */
    explicit Velocity(const glm::vec3& lin) : linear(lin) {}

    /**
     * @brief Constructs with both linear and angular velocity
     * @param lin Linear velocity vector
     * @param ang Angular velocity vector
     */
    Velocity(const glm::vec3& lin, const glm::vec3& ang) : linear(lin), angular(ang) {}
};

}  // namespace esengine::ecs
