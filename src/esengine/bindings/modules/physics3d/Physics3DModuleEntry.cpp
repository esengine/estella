// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DModuleEntry.cpp
 * @brief   The 3D physics side module's entry points.
 * @details One world, built on demand and stepped by the SDK — the same shape as
 *          the 2D module beside it, because the SDK drives both the same way. What
 *          differs is only what a body is: a shape in space with an orientation,
 *          rather than a shape in a plane with an angle.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "./Physics3DContext.hpp"

#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/RegisterTypes.h>

#include <cstddef>

using namespace JPH;
using esengine::physics3d::Context;
namespace Layers = esengine::physics3d::Layers;

namespace esengine::physics3d {
Context& ctx() {
    static Context instance;
    return instance;
}
}  // namespace esengine::physics3d

namespace {

Context& g() { return esengine::physics3d::ctx(); }

/// The temp allocator's arena. A step borrows from it and gives it all back, so
/// this is a ceiling on one step's working set rather than a running cost.
constexpr JPH::uint TEMP_ARENA_BYTES = 8 * 1024 * 1024;

EMotionType motionTypeOf(int value) {
    switch (value) {
        case 1: return EMotionType::Kinematic;
        case 2: return EMotionType::Dynamic;
        default: return EMotionType::Static;
    }
}

ObjectLayer layerOf(EMotionType motion) {
    return motion == EMotionType::Static ? Layers::STATIC : Layers::MOVING;
}

/// What a body is beyond its shape: how it answers to gravity, how it slows, and
/// whether the solver may turn it. Passed as one record because every add takes
/// the same set and a fourth positional float each would be unreadable.
struct BodyMotion {
    int motion = 0;
    float gravityScale = 1.0f;
    float linearDamping = 0.0f;
    float angularDamping = 0.0f;
    int fixedRotation = 0;
};

/// Register a shape as a body, and remember which entity it speaks for.
uint32_t addBody(uint32_t entity, Shape* shape, float px, float py, float pz,
                 float qx, float qy, float qz, float qw, const BodyMotion& how,
                 float friction, float restitution, int isSensor) {
    if (!g().isValid()) return 0;
    const EMotionType motionType = motionTypeOf(how.motion);
    BodyCreationSettings settings(shape, RVec3(px, py, pz), Quat(qx, qy, qz, qw).Normalized(),
                                  motionType, layerOf(motionType));
    settings.mFriction = friction;
    settings.mRestitution = restitution;
    settings.mIsSensor = isSensor != 0;
    settings.mGravityFactor = how.gravityScale;
    settings.mLinearDamping = how.linearDamping;
    settings.mAngularDamping = how.angularDamping;
    // What keeps a character upright: the solver may move it and never turn it.
    if (how.fixedRotation != 0) {
        settings.mAllowedDOFs = EAllowedDOFs::TranslationX | EAllowedDOFs::TranslationY
                              | EAllowedDOFs::TranslationZ;
    }
    BodyInterface& bodies = g().system->GetBodyInterface();
    const BodyID id = bodies.CreateAndAddBody(
        settings, motionType == EMotionType::Static ? EActivation::DontActivate
                                                    : EActivation::Activate);
    if (id.IsInvalid()) return 0;
    g().entityOf[id.GetIndexAndSequenceNumber()] = entity;
    return id.GetIndexAndSequenceNumber();
}

}  // namespace

extern "C" {

// World lifecycle

EMSCRIPTEN_KEEPALIVE
void physics3d_init(float gx, float gy, float gz, uint32_t maxBodies) {
    if (g().isValid()) return;
    RegisterDefaultAllocator();
    // Factory and type registry are process-wide, so a world built after a
    // shutdown must not register them twice.
    if (Factory::sInstance == nullptr) {
        Factory::sInstance = new Factory();
        RegisterTypes();
    }
    g().factory = Factory::sInstance;
    g().temp = new TempAllocatorImpl(TEMP_ARENA_BYTES);
    g().jobs = new JobSystemSingleThreaded(cMaxPhysicsJobs);
    g().system = new PhysicsSystem();
    const uint32_t bodies = maxBodies > 0 ? maxBodies : 1024;
    g().system->Init(bodies, 0, bodies * 2, bodies * 2, g().broadPhaseLayers,
                     g().objectVsBroadPhase, g().objectPairs);
    g().system->SetGravity(Vec3(gx, gy, gz));
}

EMSCRIPTEN_KEEPALIVE
void physics3d_shutdown() {
    if (!g().isValid()) return;
    delete g().system;
    delete g().jobs;
    delete g().temp;
    g().system = nullptr;
    g().jobs = nullptr;
    g().temp = nullptr;
    g().entityOf.clear();
    g().transformBuffer.clear();
    g().queryBuffer.clear();
    // Factory/RegisterTypes are deliberately left standing: they are process-wide
    // and a second world would only re-register the same types.
}

EMSCRIPTEN_KEEPALIVE
int physics3d_isReady() { return g().isValid() ? 1 : 0; }

/// Advance the world, then refill the transform buffer with every active body.
EMSCRIPTEN_KEEPALIVE
void physics3d_step(float dt, int collisionSteps) {
    if (!g().isValid() || dt <= 0.0f) return;
    g().system->Update(dt, collisionSteps > 0 ? collisionSteps : 1, g().temp, g().jobs);

    BodyIDVector active;
    g().system->GetActiveBodies(EBodyType::RigidBody, active);
    const BodyInterface& bodies = g().system->GetBodyInterfaceNoLock();
    std::vector<float>& out = g().transformBuffer;
    out.clear();
    out.reserve(active.size() * 8);
    for (const BodyID& id : active) {
        auto owner = g().entityOf.find(id.GetIndexAndSequenceNumber());
        if (owner == g().entityOf.end()) continue;
        RVec3 position;
        Quat rotation;
        bodies.GetPositionAndRotation(id, position, rotation);
        out.push_back(static_cast<float>(owner->second));
        out.push_back(static_cast<float>(position.GetX()));
        out.push_back(static_cast<float>(position.GetY()));
        out.push_back(static_cast<float>(position.GetZ()));
        out.push_back(rotation.GetX());
        out.push_back(rotation.GetY());
        out.push_back(rotation.GetZ());
        out.push_back(rotation.GetW());
    }
}

/// Rebuild the broad-phase tree. Worth calling once after the static geometry of a
/// level is in, and never per frame.
EMSCRIPTEN_KEEPALIVE
void physics3d_optimize() {
    if (g().isValid()) g().system->OptimizeBroadPhase();
}

// Bodies

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addBox(uint32_t entity, float hx, float hy, float hz,
                          float px, float py, float pz,
                          float qx, float qy, float qz, float qw,
                          int motion, float gravityScale, float linearDamping,
                          float angularDamping, int fixedRotation,
                          float friction, float restitution, int isSensor) {
    return addBody(entity, new BoxShape(Vec3(hx, hy, hz)), px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation},
                   friction, restitution, isSensor);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSphere(uint32_t entity, float radius,
                             float px, float py, float pz,
                             float qx, float qy, float qz, float qw,
                             int motion, float gravityScale, float linearDamping,
                             float angularDamping, int fixedRotation,
                             float friction, float restitution, int isSensor) {
    return addBody(entity, new SphereShape(radius), px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation},
                   friction, restitution, isSensor);
}

/// `halfHeight` is the cylinder half-height, so the capsule is `2*halfHeight + 2*radius`
/// tall — the same convention CapsuleCollider uses in 2D.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addCapsule(uint32_t entity, float radius, float halfHeight,
                              float px, float py, float pz,
                              float qx, float qy, float qz, float qw,
                              int motion, float gravityScale, float linearDamping,
                              float angularDamping, int fixedRotation,
                              float friction, float restitution, int isSensor) {
    return addBody(entity, new CapsuleShape(halfHeight, radius), px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation},
                   friction, restitution, isSensor);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeBody(uint32_t bodyId) {
    if (!g().isValid() || bodyId == 0) return;
    const BodyID id(bodyId);
    BodyInterface& bodies = g().system->GetBodyInterface();
    bodies.RemoveBody(id);
    bodies.DestroyBody(id);
    g().entityOf.erase(bodyId);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setTransform(uint32_t bodyId, float px, float py, float pz,
                            float qx, float qy, float qz, float qw) {
    if (!g().isValid() || bodyId == 0) return;
    g().system->GetBodyInterface().SetPositionAndRotation(
        BodyID(bodyId), RVec3(px, py, pz), Quat(qx, qy, qz, qw).Normalized(),
        EActivation::Activate);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setLinearVelocity(uint32_t bodyId, float vx, float vy, float vz) {
    if (!g().isValid() || bodyId == 0) return;
    g().system->GetBodyInterface().SetLinearVelocity(BodyID(bodyId), Vec3(vx, vy, vz));
}

/// Writes (px,py,pz, qx,qy,qz,qw, vx,vy,vz) into the query buffer; 0 when the body
/// is gone. One body's state, for a caller that wants it outside the step readback.
EMSCRIPTEN_KEEPALIVE
int physics3d_getBodyState(uint32_t bodyId) {
    if (!g().isValid() || bodyId == 0) return 0;
    const BodyInterface& bodies = g().system->GetBodyInterface();
    const BodyID id(bodyId);
    if (!bodies.IsAdded(id)) return 0;
    RVec3 position;
    Quat rotation;
    bodies.GetPositionAndRotation(id, position, rotation);
    const Vec3 velocity = bodies.GetLinearVelocity(id);
    g().queryBuffer = {
        static_cast<float>(position.GetX()), static_cast<float>(position.GetY()),
        static_cast<float>(position.GetZ()), rotation.GetX(), rotation.GetY(),
        rotation.GetZ(), rotation.GetW(), velocity.GetX(), velocity.GetY(), velocity.GetZ(),
    };
    return 1;
}

// Queries

/// Nearest hit along the ray. Writes (entity, fraction, px,py,pz, nx,ny,nz) into the
/// query buffer and returns 1; returns 0 and leaves it empty when nothing is hit.
EMSCRIPTEN_KEEPALIVE
int physics3d_raycast(float ox, float oy, float oz, float dx, float dy, float dz) {
    g().queryBuffer.clear();
    if (!g().isValid()) return 0;
    const RRayCast ray{RVec3(ox, oy, oz), Vec3(dx, dy, dz)};
    RayCastResult hit;
    if (!g().system->GetNarrowPhaseQuery().CastRay(ray, hit)) return 0;

    const RVec3 point = ray.GetPointOnRay(hit.mFraction);
    const BodyLockRead lock(g().system->GetBodyLockInterface(), hit.mBodyID);
    Vec3 normal = Vec3::sZero();
    if (lock.Succeeded()) {
        normal = lock.GetBody().GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point);
    }
    auto owner = g().entityOf.find(hit.mBodyID.GetIndexAndSequenceNumber());
    g().queryBuffer = {
        owner == g().entityOf.end() ? 0.0f : static_cast<float>(owner->second),
        hit.mFraction,
        static_cast<float>(point.GetX()), static_cast<float>(point.GetY()),
        static_cast<float>(point.GetZ()),
        normal.GetX(), normal.GetY(), normal.GetZ(),
    };
    return 1;
}

// Readback

EMSCRIPTEN_KEEPALIVE
const float* physics3d_transforms() { return g().transformBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_transformsBytes() {
    return g().transformBuffer.size() * sizeof(float);
}

EMSCRIPTEN_KEEPALIVE
const float* physics3d_queryResult() { return g().queryBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_queryResultBytes() {
    return g().queryBuffer.size() * sizeof(float);
}

}  // extern "C"
