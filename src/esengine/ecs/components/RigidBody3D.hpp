// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RigidBody3D.hpp
 * @brief   A body the 3D world simulates, and the shapes that give it extent.
 * @details Its own components rather than a third dimension bolted onto the 2D
 *          ones: a 2D scene keeps the solver, the units and the feel it already
 *          has, and pays nothing for a world it never asks for. A scene picks one
 *          of the two — an entity carrying both is served by the 2D one, which was
 *          there first.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "./RigidBody.hpp"

namespace esengine::ecs {

/**
 * @brief A body in the 3D world.
 *
 * @code
 * auto& body = registry.emplace<RigidBody3D>(e);
 * body.bodyType = BodyType::Dynamic;
 * @endcode
 */
ES_COMPONENT()
struct RigidBody3D {
    /** @brief Static never moves, Kinematic is moved by hand, Dynamic is solved. */
    ES_PROPERTY(enum=BodyType)
    BodyType bodyType{BodyType::Dynamic};

    /** @brief Scales this body's share of the world's gravity. 0 = weightless. */
    ES_PROPERTY(min=0)
    f32 gravityScale{1.0f};

    ES_PROPERTY(min=0)
    f32 linearDamping{0.05f};

    ES_PROPERTY(min=0)
    f32 angularDamping{0.05f};

    /** @brief Keeps the body upright: the solver may move it, never turn it. What a
     *         character on legs wants, and what a crate does not. */
    ES_PROPERTY()
    bool fixedRotation{false};

    /** @brief Disabled bodies are left out of the world entirely. */
    ES_PROPERTY()
    bool enabled{true};
};

/** @brief An axis-aligned box, sized in world units around the entity's origin. */
ES_COMPONENT()
struct BoxCollider3D {
    ES_PROPERTY()
    glm::vec3 halfExtents{0.5f, 0.5f, 0.5f};

    ES_PROPERTY(min=0)
    f32 friction{0.3f};

    ES_PROPERTY(min=0, max=1)
    f32 restitution{0.0f};

    /** @brief A sensor reports overlaps and stops nothing. */
    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};
};

ES_COMPONENT()
struct SphereCollider3D {
    ES_PROPERTY(min=0)
    f32 radius{0.5f};

    ES_PROPERTY(min=0)
    f32 friction{0.3f};

    ES_PROPERTY(min=0, max=1)
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};
};

/**
 * @brief An upright capsule — the shape a character is.
 * @details Total height is `2*(halfHeight + radius)`: @ref halfHeight is the
 *          cylinder's half, and a cap of @ref radius sits on each end. Stated
 *          because the two are easy to swap and their SUM still holds a body at
 *          the same height, so a swap shows up only in how wide it is.
 */
ES_COMPONENT()
struct CapsuleCollider3D {
    ES_PROPERTY(min=0)
    f32 radius{0.3f};

    ES_PROPERTY(min=0)
    f32 halfHeight{0.5f};

    ES_PROPERTY(min=0)
    f32 friction{0.3f};

    ES_PROPERTY(min=0, max=1)
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs
