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

#include <algorithm>
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
inline glm::vec3 coneDirection(f32 halfAngle, const RandomRange& rand, f32 arc = math::TWO_PI) {
    const f32 cosTheta = rand(std::cos(halfAngle), 1.0f);
    const f32 sinTheta = std::sqrt(std::max(0.0f, 1.0f - cosTheta * cosTheta));
    const f32 phi = rand(0.0f, arc);
    return glm::vec3(sinTheta * std::cos(phi), cosTheta, sinTheta * std::sin(phi));
}

/** The part of a full turn @p emitter's shape is born over, in radians: shapeArc, held to one turn. */
inline f32 shapeArcRadians(const ecs::ParticleEmitter& emitter) {
    const f32 arc = std::isfinite(emitter.shapeArc) ? emitter.shapeArc : 360.0f;
    return std::clamp(arc, 0.0f, 360.0f) * math::DEG_TO_RAD;
}

/** Where in from the rim births begin, as a fraction of the radius: 0 at a full shapeThickness, 1 at a rim-only one. */
inline f32 shapeInner(const ecs::ParticleEmitter& emitter) {
    const f32 thickness = std::isfinite(emitter.shapeThickness) ? emitter.shapeThickness : 1.0f;
    return 1.0f - std::clamp(thickness, 0.0f, 1.0f);
}

/**
 * @brief One sample from @p emitter's shape, in emitter local space.
 * @details shapeArc and shapeThickness narrow the draws without adding any: at 360 and 1 every shape takes the same
 *          numbers in the same order as before they existed, so a seeded effect still plays the same.
 */
inline SpawnSample sampleShape(const ecs::ParticleEmitter& emitter, const RandomRange& rand) {
    SpawnSample s;
    const f32 arc = shapeArcRadians(emitter);
    const f32 inner = shapeInner(emitter);
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
            const f32 angle = rand(0.0f, arc);
            const f32 radius = rand(inner * emitter.shapeRadius, emitter.shapeRadius);
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
            s.direction = coneDirection(halfAngle, rand, arc);
            // Spawn spread sampled INDEPENDENTLY of the velocity, so a particle's
            // birthplace does not predict where it goes.
            s.position = coneDirection(halfAngle, rand, arc) * rand(inner * emitter.shapeRadius, emitter.shapeRadius);
            break;
        }
        case ecs::EmitterShape::Sphere:
        case ecs::EmitterShape::Hemisphere: {
            const bool full = static_cast<ecs::EmitterShape>(emitter.shape)
                              == ecs::EmitterShape::Sphere;
            const f32 half = full ? math::PI : math::HALF_PI;
            s.direction = coneDirection(half, rand, arc);
            // Uniform through the VOLUME: a radius linear in the draw piles the
            // particles at the centre, which is a ball made of a spike. A shell is the
            // same draw from the inner radius's share of the volume up.
            s.position = coneDirection(half, rand, arc)
                       * (emitter.shapeRadius * std::cbrt(rand(inner * inner * inner, 1.0f)));
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
