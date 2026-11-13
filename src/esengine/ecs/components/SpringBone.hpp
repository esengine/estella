// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpringBone.hpp
 * @brief   Secondary motion for a chain of bones: hair, tails, cords, cloth edges.
 * @details A SpringBone on the ROOT of a chain makes every entity below it a spring: the
 *          animation still says where each bone would be, and the chain lags behind that pose
 *          by inertia, falls with gravity, and is pulled back toward it. The root itself is
 *          not simulated (it is what the animation or the body drives). The simulation lives
 *          in SpringBoneSystem, keyed by the root entity, so this component stays pure
 *          configuration and scene serialization never sees the transient state.
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

#include <vector>

namespace esengine::ecs {

/** @brief What a @ref SpringBoneCollider is shaped like. */
ES_ENUM()
enum class SpringBoneShape : i32 {
    Sphere = 0,
    Capsule = 1,
};

ES_COMPONENT()
struct SpringBone {
    /** @brief Simulated this frame. Off leaves the chain exactly as the animation poses it. */
    ES_PROPERTY(tooltip="Off leaves the chain exactly as the animation poses it.")
    bool enabled{true};

    /** @brief How hard each bone is pulled back toward the pose the animation gives it, 0 to 1. */
    ES_PROPERTY(category=Motion, min=0, max=1, step=0.01, slider, tooltip="How hard each bone is pulled back toward its animated pose. 0 hangs free, 1 follows the animation exactly.")
    f32 stiffness{0.1f};

    /** @brief How much of its velocity a bone loses each frame, 0 to 1. */
    ES_PROPERTY(category=Motion, min=0, max=1, step=0.01, slider, tooltip="How much of its speed a bone loses each frame. Higher settles sooner.")
    f32 drag{0.5f};

    /** @brief Gravity on the chain, in world units a second squared. */
    ES_PROPERTY(category=Motion, tooltip="Gravity on the chain, in world units a second squared (world y is up).")
    glm::vec3 gravity{0.0f, -980.0f, 0.0f};

    /** @brief A steady wind on the chain, in world units a second squared. */
    ES_PROPERTY(category=Wind, tooltip="A steady wind on the chain, in world units a second squared. Zero is still air.")
    glm::vec3 wind{0.0f, 0.0f, 0.0f};

    /** @brief How far gusts swing the wind's strength, 0 to 1. */
    ES_PROPERTY(category=Wind, min=0, max=1, step=0.01, slider, tooltip="How far gusts swing the wind's strength. 0 is a steady wind, 1 takes it from calm to twice its strength.")
    f32 windGust{0.0f};

    /** @brief Gusts a second. */
    ES_PROPERTY(category=Wind, min=0, step=0.05, tooltip="Gusts a second.")
    f32 windFrequency{0.5f};

    /** @brief How far the last bones of a chain reach past themselves, in world units: a leaf has no child to aim at, so this gives it a tip. 0 leaves leaves unsimulated. */
    ES_PROPERTY(category=Chain, min=0, step=0.1, tooltip="Length of the tip past each end bone, in world units. 0 leaves the end bones unsimulated.")
    f32 endLength{0.0f};

    /** @brief The thickness of the strand, in world units, kept clear of every collider. */
    ES_PROPERTY(category=Chain, min=0, step=0.1, tooltip="Thickness of the strand, in world units, kept clear of the colliders.")
    f32 radius{0.0f};

    /** @brief How much of the simulated pose is used, 0 to 1: 0 is the animation alone. */
    ES_PROPERTY(category=Chain, min=0, max=1, step=0.01, slider, tooltip="How much of the simulation is used. 0 is the animation alone.")
    f32 weight{1.0f};

    /** @brief Entities with a SpringBoneCollider this chain keeps out of. */
    ES_PROPERTY(category=Collision, entity_ref, tooltip="Entities with a SpringBoneCollider that this chain is kept out of (the head, the shoulders).")
    std::vector<Entity> colliders;

    SpringBone() = default;

    /// Compared member by member: what the change audit checks a write of this component against (Registry::auditChanges).
    bool operator==(const SpringBone&) const = default;
};

/**
 * @brief A sphere or capsule a spring chain is kept out of, placed by its entity's transform.
 */
ES_COMPONENT()
struct SpringBoneCollider {
    ES_PROPERTY(category=Shape, enum=SpringBoneShape, tooltip="Sphere, or a capsule along the entity's own Y axis.")
    SpringBoneShape shape{SpringBoneShape::Sphere};

    /** @brief Radius, in world units before the entity's scale. */
    ES_PROPERTY(category=Shape, min=0, step=0.1, tooltip="Radius in world units, before the entity's scale.")
    f32 radius{10.0f};

    /** @brief A capsule's length between its two end spheres' centres, in world units before scale. */
    ES_PROPERTY(category=Shape, min=0, step=0.1, shown_when=shape:Capsule, tooltip="A capsule's length between the centres of its end spheres, in world units before scale.")
    f32 height{20.0f};

    /** @brief Where the shape's centre is, in the entity's own space. */
    ES_PROPERTY(category=Shape, tooltip="Where the centre of the shape is, in the entity's own space.")
    glm::vec3 offset{0.0f, 0.0f, 0.0f};

    SpringBoneCollider() = default;
};

}  // namespace esengine::ecs
