// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ParticleShapes.hpp
 * @brief   Where a particle is born and which way it leaves — a pure function of
 *          the emitter's own configuration.
 * @details Header-only and free of the simulation, because it is the one part of
 *          emission that is a DISTRIBUTION rather than a frame: a rendered picture
 *          is a projection and cannot answer whether directions are isotropic, so
 *          the shapes are tested here as the distributions they are.
 *
 *          Every shape answers in the same two terms, so the integrator never
 *          learns a new kind of aim. Local +Y is the axis a directed shape points
 *          along — where a 2D cone has always pointed.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../ecs/components/ParticleEmitter.hpp"

#include <cmath>
#include <functional>

namespace esengine::particle {

/** A uniform draw in [a, b). Injected so a test can be deterministic. */
using RandomRange = std::function<f32(f32, f32)>;

/** Where the emitter stands, how it is aimed, how big its shape is — the whole
 *  of what a spawn needs from a Transform. */
struct EmitterFrame {
    glm::vec3 position{0.0f};
    glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
    glm::vec3 scale{1.0f};
};

/** A local point placed in the world: scale sizes the shape, rotation aims it. */
inline glm::vec3 worldPointOf(const glm::vec3& local, const EmitterFrame& f) {
    return f.position + f.rotation * (local * f.scale);
}

/**
 * @brief A local direction placed in the world — rotation ALONE.
 * @details Scaling an aim would skew a cone's half-angle and translating one
 *          would make it depend on where the emitter stands.
 */
inline glm::vec3 worldDirOf(const glm::vec3& local, const EmitterFrame& f) {
    return f.rotation * local;
}

/** One birth, in EMITTER LOCAL space. */
struct SpawnSample {
    glm::vec3 position{0.0f};
    glm::vec3 direction{0.0f, 1.0f, 0.0f};
};

/**
 * @brief A direction inside the cap of half-angle @p halfAngle about local +Y.
 * @details cos(theta) is what must be uniform, not theta: sampling the angle
 *          crowds the axis, the same mistake latitude/longitude makes at a
 *          sphere's poles. PI/2 is the +Y hemisphere and PI the whole sphere, so
 *          one function is Cone, Hemisphere and Sphere.
 */
inline glm::vec3 coneDirection(f32 halfAngle, const RandomRange& rand) {
    const f32 cosTheta = rand(std::cos(halfAngle), 1.0f);
    const f32 sinTheta = std::sqrt(std::max(0.0f, 1.0f - cosTheta * cosTheta));
    const f32 phi = rand(0.0f, math::TWO_PI);
    return glm::vec3(sinTheta * std::cos(phi), cosTheta, sinTheta * std::sin(phi));
}

/** One sample from @p emitter's shape, in emitter local space. */
inline SpawnSample sampleShape(const ecs::ParticleEmitter& emitter, const RandomRange& rand) {
    SpawnSample s;
    // Point and Box have no aim of their own, so they take one: an angle in the
    // emitter's local XY plane, which is what every 2D emitter has always meant.
    auto planarAim = [&] {
        const f32 a = rand(emitter.angleSpreadMin, emitter.angleSpreadMax) * math::DEG_TO_RAD;
        return glm::vec3(std::cos(a), std::sin(a), 0.0f);
    };

    switch (static_cast<ecs::EmitterShape>(emitter.shape)) {
        case ecs::EmitterShape::Circle: {
            // A disc in the emitter's LOCAL plane, not the world's — a rotated
            // emitter carries its circle with it.
            const f32 angle = rand(0.0f, math::TWO_PI);
            const f32 radius = rand(0.0f, emitter.shapeRadius);
            s.position = glm::vec3(std::cos(angle) * radius, std::sin(angle) * radius, 0.0f);
            s.direction = radius > 0.001f ? s.position / radius : planarAim();
            break;
        }
        case ecs::EmitterShape::Box: {
            // A filled VOLUME. A depthless one is the rectangle 2D always had.
            s.position = glm::vec3(
                rand(-emitter.shapeSize.x * 0.5f, emitter.shapeSize.x * 0.5f),
                rand(-emitter.shapeSize.y * 0.5f, emitter.shapeSize.y * 0.5f),
                emitter.shapeSize.z > 0.0f
                    ? rand(-emitter.shapeSize.z * 0.5f, emitter.shapeSize.z * 0.5f) : 0.0f);
            s.direction = planarAim();
            break;
        }
        case ecs::EmitterShape::Cone: {
            const f32 halfAngle = emitter.shapeAngle * 0.5f * math::DEG_TO_RAD;
            s.direction = coneDirection(halfAngle, rand);
            // Spawn spread sampled INDEPENDENTLY of the velocity, so a particle's
            // birthplace does not predict where it goes.
            s.position = coneDirection(halfAngle, rand) * rand(0.0f, emitter.shapeRadius);
            break;
        }
        case ecs::EmitterShape::Sphere:
        case ecs::EmitterShape::Hemisphere: {
            const bool full = static_cast<ecs::EmitterShape>(emitter.shape)
                              == ecs::EmitterShape::Sphere;
            const f32 half = full ? math::PI : math::HALF_PI;
            s.direction = coneDirection(half, rand);
            // Uniform through the VOLUME: a radius linear in the draw piles the
            // particles at the centre, which is a ball made of a spike.
            s.position = coneDirection(half, rand)
                       * (emitter.shapeRadius * std::cbrt(rand(0.0f, 1.0f)));
            break;
        }
        case ecs::EmitterShape::Point:
        default:
            s.direction = planarAim();
            break;
    }
    return s;
}

}  // namespace esengine::particle
