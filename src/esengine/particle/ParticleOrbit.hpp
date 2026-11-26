// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <cmath>

namespace esengine::particle {

/**
 * @brief Where a particle is after one step of orbital and radial velocity.
 *
 * @details Turns about @p centre by @p degreesPerSecond (about @p axes), then moves @p radial a second along the line from
 *          it. The POSITION moves and velocity is left alone, so gravity and damping cannot bend the orbit. Drawing in
 *          stops at the centre rather than passing through. The GPU kernel in GpuParticles.cpp does the same arithmetic.
 */
inline glm::vec3 orbitStep(glm::vec3 position, glm::vec3 centre, const glm::quat& axes,
                           glm::vec3 degreesPerSecond, f32 radial, f32 dt) {
    glm::vec3 rel = position - centre;
    const glm::vec3 turn = degreesPerSecond * (math::DEG_TO_RAD * dt);
    const f32 angle = glm::length(turn);
    if (angle > 1e-7f) rel = glm::angleAxis(angle, axes * (turn / angle)) * rel;
    if (radial != 0.0f) {
        const f32 distance = glm::length(rel);
        if (distance > 1e-5f) rel *= std::max(distance + radial * dt, 0.0f) / distance;
    }
    return centre + rel;
}

}  // namespace esengine::particle
