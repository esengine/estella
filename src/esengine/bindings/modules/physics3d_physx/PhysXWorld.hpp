// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysXWorld.hpp
 * @brief   The one 3D world the PhysX backend steps.
 * @details The second implementation of Physics3DBindings.hpp, beside the Jolt
 *          one. The SDK cannot tell them apart by their entry points; what
 *          differs is the solver, which here is set up the way Unity sets up
 *          the same PhysX: projected Gauss-Seidel, patch friction, Average
 *          combine, a 0.01 m contact offset, a 2 m/s bounce threshold, a 0.005
 *          sleep energy, six position and one velocity iterations, and a
 *          maximum angular velocity of 50 rad/s. A scene authored against
 *          Unity's defaults lands on the same numbers.
 *
 *          Bodies are named by small integers the module hands out, the way
 *          Jolt's BodyIDs are; a PhysX actor pointer never crosses to the SDK.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <PxPhysicsAPI.h>

#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace esengine::physics3d_physx {

/// Sixteen layers, the same number the Jolt backend and the 2D world name.
constexpr uint32_t LAYER_COUNT = 16;

/// Filter data words. word0 holds the layer INDEX rather than its bit, so the
/// shader reads the live matrix, the same matrix Jolt consults per pair.
enum FilterWord : uint32_t { kLayerWord = 0, kKindWord = 1 };
/// kKindWord bits.
constexpr uint32_t KIND_CHARACTER = 1u;

/// What the module knows about a body beyond what PhysX holds.
struct Body {
    uint32_t id = 0;
    uint32_t entity = 0;
    uint32_t layer = 0;
    physx::PxRigidActor* actor = nullptr;
    bool sensor = false;
    bool character = false;
    /// PhysX has no per-body gravity factor, only on or off. A body whose scale
    /// is not 1 has gravity off and is given `g * scale` as an acceleration
    /// before every substep, which is the same integral.
    float gravityScale = 1.0f;
    /// A kinematic body moves by the velocity it was given, the way a Jolt one
    /// does; PhysX moves a kinematic body only to a target, set every substep.
    physx::PxVec3 kinematicVelocity{0.0f};
    bool hasKinematicVelocity = false;
};

struct Character {
    physx::PxController* controller = nullptr;
    uint32_t entity = 0;
    uint32_t layer = 0;
    /// The vertical speed between moves; a controller does not fall on its own.
    float verticalSpeed = 0.0f;
    bool grounded = false;
    physx::PxVec3 groundNormal{0.0f, 1.0f, 0.0f};
    float pushForce = 0.0f;
    std::unique_ptr<Body> body;  // the kinematic actor's record, so hits name the entity
};

/// Which PxJoint an entity's component made, so a motor or a reading knows what
/// it is holding without RTTI.
enum class JointKind : uint8_t { Point, Hinge, Slider, Distance, Fixed, SwingTwist, SixDOF };

struct Joint {
    physx::PxJoint* joint = nullptr;
    JointKind kind = JointKind::Fixed;
    /// A slider's motor force, kept so turning the motor back on restores it.
    float maxForce = 0.0f;
};

struct World {
    physx::PxScene* scene = nullptr;
    physx::PxDefaultCpuDispatcher* dispatcher = nullptr;
    physx::PxControllerManager* controllers = nullptr;

    uint32_t masks[LAYER_COUNT];
    std::unordered_map<uint32_t, std::unique_ptr<Body>> bodies;
    uint32_t nextBodyId = 1;

    std::unordered_map<uint32_t, std::unique_ptr<Character>> characters;
    uint32_t nextCharacterId = 1;

    std::unordered_map<uint32_t, Joint> joints;
    /// Materials keyed by (friction, restitution): a scene of a thousand crates
    /// shares one, as a Unity scene shares its default material.
    std::unordered_map<uint64_t, physx::PxMaterial*> materials;

    std::vector<float> transformBuffer;
    std::vector<float> queryBuffer;
    std::vector<float> contactEnterBuffer;
    std::vector<float> contactExitBuffer;
    std::vector<float> sensorEnterBuffer;
    std::vector<float> sensorExitBuffer;

    World() { for (uint32_t& m : masks) m = 0xFFFFFFFFu; }
    bool isValid() const { return scene != nullptr; }

    bool collide(uint32_t a, uint32_t b) const {
        if (a >= LAYER_COUNT || b >= LAYER_COUNT) return false;
        return (masks[a] & (1u << b)) != 0 && (masks[b] & (1u << a)) != 0;
    }
    Body* body(uint32_t id) {
        auto found = bodies.find(id);
        return found == bodies.end() ? nullptr : found->second.get();
    }
};

World& world();
physx::PxPhysics& physics();
/// Friction 0.6, no bounce: Unity's default physics material.
physx::PxMaterial* defaultMaterial();

/// The entity an actor speaks for, or 0.
inline uint32_t entityOf(const physx::PxActor* actor) {
    if (actor == nullptr || actor->userData == nullptr) return 0;
    return static_cast<const Body*>(actor->userData)->entity;
}

}  // namespace esengine::physics3d_physx
