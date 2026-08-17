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

    /** @brief Which collision layer this body is in (0..15). ONE layer, unlike the
     *         2D world's category bits: Jolt classifies a body by a single id. */
    ES_PROPERTY(min=0, max=15, advanced)
    u32 layer{0};

    /** @brief Checks the whole path a step covers rather than where the body ended
     *         up. What a bullet needs: discrete collision only asks where a body IS,
     *         so anything crossing more than its own thickness in one step arrives
     *         on the far side of a wall having never touched it. Costs more, which
     *         is why it is off. */
    ES_PROPERTY(advanced)
    bool continuousCollision{false};

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

/**
 * @brief Imported geometry, used as it is, for a level to collide against.
 *
 * @details What a box or a capsule cannot say: a terrain, a staircase, a room.
 *          ALWAYS STATIC whatever the RigidBody3D says — a triangle soup has no
 *          inertia tensor, so there is nothing for a solver to push. Its triangles
 *          are also ONE-SIDED: reversed winding stops nothing.
 */
ES_COMPONENT()
struct MeshCollider3D {
    /** @brief The geometry to collide against. Its triangles are used directly. */
    ES_PROPERTY(asset = mesh, tooltip="Geometry (.esmesh) to collide against.")
    resource::MeshHandle mesh;

    ES_PROPERTY(min=0)
    f32 friction{0.3f};

    ES_PROPERTY(min=0, max=1)
    f32 restitution{0.0f};

    /** @brief Which collision layer the geometry is in (0..15). */
    ES_PROPERTY(min=0, max=15, advanced)
    u32 layer{0};

    ES_PROPERTY()
    bool enabled{true};
};

/**
 * @brief A kinematic mover for a 3D player or NPC.
 *
 * @details Swept against the world rather than solved in it, which is what lets it
 *          climb a step without inheriting the momentum of what it stands on. Set
 *          @ref velocity each step; the vertical component is carried for you, so a
 *          zero there means "walk". REPLACES a RigidBody3D rather than joining one.
 */
ES_COMPONENT()
struct CharacterController3D {
    /** @brief Desired velocity in world units/second. A positive y is a jump. */
    ES_PROPERTY()
    glm::vec3 velocity{0.0f, 0.0f, 0.0f};

    ES_PROPERTY(min=0)
    f32 radius{0.3f};

    /** @brief Half the cylinder; total height is `2*(halfHeight + radius)`. */
    ES_PROPERTY(min=0)
    f32 halfHeight{0.5f};

    /** @brief Steepest ground it can stand on. Beyond this it slides. */
    ES_PROPERTY(min=0, max=1.5708, unit="rad")
    f32 maxSlope{0.87f};

    /** @brief Tallest step it climbs instead of stopping at. 0 = climbs nothing. */
    ES_PROPERTY(min=0, advanced)
    f32 stepHeight{0.4f};

    /** @brief How far it reaches down to stay on the floor over a crest. 0 = off. */
    ES_PROPERTY(min=0, advanced)
    f32 snapDown{0.5f};

    /** @brief Mass used when it pushes dynamic bodies. */
    ES_PROPERTY(min=0, advanced)
    f32 mass{70.0f};

    /** @brief How hard it can shove what it walks into, in newtons. A character is
     *         swept rather than solved, so nothing moves out of its way unless it
     *         is given the strength to move it — and the force a solver needs to
     *         get a crate going is well above the one that would hold it there.
     *         0 pushes nothing at all. */
    ES_PROPERTY(min=0, advanced)
    f32 pushForce{5000.0f};

    ES_PROPERTY()
    bool enabled{true};

    /** @brief Which collision layer it is in (0..15). */
    ES_PROPERTY(min=0, max=15, advanced)
    u32 layer{0};

    /** @brief Output: standing on ground it can walk on. */
    ES_PROPERTY(advanced)
    bool isOnFloor{false};

    /** @brief Output: the floor's normal; zero while airborne. */
    ES_PROPERTY(advanced)
    glm::vec3 floorNormal{0.0f, 0.0f, 0.0f};

    /** @brief Output: what it actually moved, per second, after collisions. */
    ES_PROPERTY(advanced)
    glm::vec3 realVelocity{0.0f, 0.0f, 0.0f};
};

}  // namespace esengine::ecs
