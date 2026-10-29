// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"

#include <glm/glm.hpp>

#include <cmath>

namespace esengine::particle {

/**
 * @brief A particle's velocity after its speed limit has pulled it back.
 *
 * @details The excess over the limit shrinks by `dampen` for every 1/60 s that passes, so the braking does not change with the frame rate:
 *          1 removes the whole excess at once, a small value eases a fast particle down over several frames. A particle within the limit is
 *          left as it is.
 */
inline glm::vec3 limitedVelocity(glm::vec3 velocity, f32 limit, f32 dampen, f32 dt) {
    const f32 speed = glm::length(velocity);
    if (limit <= 0.0f || speed <= limit) return velocity;
    const f32 keep = std::pow(1.0f - glm::clamp(dampen, 0.0f, 1.0f), dt * 60.0f);   // the part of the excess left after dt
    const f32 target = limit + (speed - limit) * keep;
    return velocity * (target / speed);
}

}  // namespace esengine::particle
