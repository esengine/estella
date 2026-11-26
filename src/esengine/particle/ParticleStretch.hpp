// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../ecs/components/ParticleEmitter.hpp"

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

inline glm::vec2 velocityOnScreen(const glm::vec3& velocity, const glm::vec3& towardViewer) {
    const f32 reach = glm::length(towardViewer);
    if (reach <= 1e-6f) return {velocity.x, velocity.y};
    const glm::vec3 fwd = towardViewer / reach;
    const glm::vec3 refUp = std::abs(fwd.y) > 0.999f ? glm::vec3(0.0f, 0.0f, 1.0f) : glm::vec3(0.0f, 1.0f, 0.0f);
    const glm::vec3 right = glm::normalize(glm::cross(refUp, fwd));
    const glm::vec3 up = glm::cross(fwd, right);
    return {glm::dot(velocity, right), glm::dot(velocity, up)};
}

inline StretchedQuad stretchedQuad(glm::vec2 velocity, f32 rotation, f32 size, f32 lengthScale, f32 velocityScale) {
    const f32 speed = glm::length(velocity);
    if (speed <= 1e-4f) return {rotation, size};
    constexpr f32 kHalfPi = 1.57079632679f;
    return {std::atan2(velocity.y, velocity.x) - kHalfPi, size * lengthScale + speed * velocityScale};
}

/**
 * @brief How the particle vertex stage orients an emitter's quads: 0 faces the view (Billboard, and Stretched, whose
 *        turn is worked out before the draw), 1 lies in the ground plane facing up (Horizontal), 2 stands upright and
 *        turns about the world's up axis (Vertical). Carried on each instance beside its rotation, as `a_inst_turn.y`.
 */
inline u32 renderAlignment(const ecs::ParticleEmitter& emitter) {
    switch (static_cast<ecs::ParticleRenderMode>(emitter.renderMode)) {
        case ecs::ParticleRenderMode::Horizontal: return 1u;
        case ecs::ParticleRenderMode::Vertical: return 2u;
        default: return 0u;
    }
}

}  // namespace esengine::particle
