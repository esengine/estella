// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"

#include <glm/glm.hpp>

#include <cmath>

namespace esengine::particle {

/**
 * @brief How a stretched particle's quad is laid along its velocity.
 *
 * @details The quad's +Y runs along the velocity and is lengthened by speed; its width stays the particle's own. A particle that is not
 *          moving keeps the rotation it was given, since a direction needs a velocity.
 */
struct StretchedQuad {
    f32 rotation;  ///< Radians, counter-clockwise, turning the quad's +Y onto the velocity.
    f32 length;    ///< The quad's extent along its Y.
};

inline StretchedQuad stretchedQuad(glm::vec2 velocity, f32 rotation, f32 size, f32 lengthScale, f32 velocityScale) {
    const f32 speed = glm::length(velocity);
    if (speed <= 1e-4f) return {rotation, size};
    constexpr f32 kHalfPi = 1.57079632679f;
    return {std::atan2(velocity.y, velocity.x) - kHalfPi, size * lengthScale + speed * velocityScale};
}

}  // namespace esengine::particle
