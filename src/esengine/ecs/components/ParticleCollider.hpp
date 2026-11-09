// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ParticleCollider.hpp
 * @brief   A shape particles bounce off without any physics: a signed distance a compute kernel can answer per particle.
 * @details A scene query per particle is not something a million particles can afford, and nothing on the GPU can ask one. A distance
 *          function can be asked of every particle, so an emitter whose `collisionMode` is `Sdf` bounces off every one of these near
 *          it. The CPU simulation answers the same functions, so the look survives a device with no compute.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_ENUM(stability=beta)
enum class ParticleColliderShape : i32 {
    Sphere = 0,
    Box = 1,
    Capsule = 2,
};

ES_COMPONENT(stability=beta)
struct ParticleCollider {
    ES_PROPERTY(enum=ParticleColliderShape, category=Shape)
    i32 shape{static_cast<i32>(ParticleColliderShape::Sphere)};

    // A sphere's radius, and a capsule's round its axis.
    ES_PROPERTY(min=0, category=Shape)
    f32 radius{50.0f};

    // A capsule's axis runs along the entity's up, this far each way from its centre.
    ES_PROPERTY(min=0, category=Shape)
    f32 halfHeight{50.0f};

    ES_PROPERTY(category=Shape)
    glm::vec3 halfExtents{50.0f, 50.0f, 50.0f};

    // Keeps particles in rather than out: a dome round a spell, the inside of a jar.
    ES_PROPERTY(category=Shape)
    bool inverted{false};

    // Which emitters it stops: one that shares a bit with this in its collisionMask.
    ES_PROPERTY(bitmask_source=collisionLayers, min=0, max=65535, step=1, category=Shape)
    u32 mask{65535};

    ES_PROPERTY()
    bool enabled{true};

    ParticleCollider() = default;
};

}  // namespace esengine::ecs
