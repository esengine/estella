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
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Collision/ContactListener.h>
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
LayerMatrix& layerMatrix() {
    static LayerMatrix instance;
    return instance;
}
}  // namespace esengine::physics3d

namespace {

Context& g() { return esengine::physics3d::ctx(); }

/// The temp allocator's arena. A step borrows from it and gives it all back, so
/// this is a ceiling on one step's working set rather than a running cost.
constexpr JPH::uint TEMP_ARENA_BYTES = 8 * 1024 * 1024;

/// Character ids and body ids are both small integers and share one owner map, so
/// a character's key is tagged apart. Bodies never reach this bit: Jolt packs a
/// BodyID's index into the low 23.
constexpr uint32_t CHARACTER_ID_TAG = 0x80000000u;

EMotionType motionTypeOf(int value) {
    switch (value) {
        case 1: return EMotionType::Kinematic;
        case 2: return EMotionType::Dynamic;
        default: return EMotionType::Static;
    }
}

ObjectLayer layerOf(EMotionType motion, uint32_t layer) {
    return esengine::physics3d::Layers::of(layer, motion != EMotionType::Static);
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
    uint32_t layer = 0;
};

/// The entity a body speaks for, or 0 when nothing claims it.
uint32_t entityOfBody(const BodyID& id) {
    auto found = g().entityOf.find(id.GetIndexAndSequenceNumber());
    return found == g().entityOf.end() ? 0u : found->second;
}

/**
 * Records what touched what. Jolt calls this with every body locked, so it reads
 * only its own tables and the geometry it is handed — never the world.
 */
class ContactRecorder final : public ContactListener {
public:
    void OnContactAdded(const Body& body1, const Body& body2, const ContactManifold& manifold,
                        ContactSettings&) override {
        const uint32_t a = body1.GetID().GetIndexAndSequenceNumber();
        const uint32_t b = body2.GetID().GetIndexAndSequenceNumber();
        const uint32_t entityA = entityOfBody(body1.GetID());
        const uint32_t entityB = entityOfBody(body2.GetID());
        if (entityA == 0 && entityB == 0) return;

        const bool aIsSensor = g().sensorBodies.count(a) != 0;
        const bool bIsSensor = g().sensorBodies.count(b) != 0;
        if (aIsSensor || bIsSensor) {
            // The sensor is named first, so a listener never has to work out
            // which of the two it subscribed to.
            g().sensorEnterBuffer.push_back(static_cast<float>(aIsSensor ? entityA : entityB));
            g().sensorEnterBuffer.push_back(static_cast<float>(aIsSensor ? entityB : entityA));
            return;
        }
        const RVec3 point = manifold.GetWorldSpaceContactPointOn1(0);
        const Vec3 normal = manifold.mWorldSpaceNormal;
        g().contactEnterBuffer.insert(g().contactEnterBuffer.end(), {
            static_cast<float>(entityA), static_cast<float>(entityB),
            normal.GetX(), normal.GetY(), normal.GetZ(),
            static_cast<float>(point.GetX()), static_cast<float>(point.GetY()),
            static_cast<float>(point.GetZ()),
        });
    }

    void OnContactRemoved(const SubShapeIDPair& pair) override {
        const uint32_t a = pair.GetBody1ID().GetIndexAndSequenceNumber();
        const uint32_t b = pair.GetBody2ID().GetIndexAndSequenceNumber();
        const uint32_t entityA = entityOfBody(pair.GetBody1ID());
        const uint32_t entityB = entityOfBody(pair.GetBody2ID());
        if (entityA == 0 && entityB == 0) return;

        const bool aIsSensor = g().sensorBodies.count(a) != 0;
        const bool bIsSensor = g().sensorBodies.count(b) != 0;
        std::vector<float>& out = (aIsSensor || bIsSensor) ? g().sensorExitBuffer
                                                           : g().contactExitBuffer;
        if (aIsSensor || bIsSensor) {
            out.push_back(static_cast<float>(aIsSensor ? entityA : entityB));
            out.push_back(static_cast<float>(aIsSensor ? entityB : entityA));
        } else {
            out.push_back(static_cast<float>(entityA));
            out.push_back(static_cast<float>(entityB));
        }
    }
};

ContactRecorder& recorder() {
    static ContactRecorder instance;
    return instance;
}

/// Register a shape as a body, and remember which entity it speaks for.
uint32_t addBody(uint32_t entity, const Ref<Shape>& shape, float px, float py, float pz,
                 float qx, float qy, float qz, float qw, const BodyMotion& how,
                 float friction, float restitution, int isSensor) {
    if (!g().isValid()) return 0;
    const EMotionType motionType = motionTypeOf(how.motion);
    BodyCreationSettings settings(shape, RVec3(px, py, pz), Quat(qx, qy, qz, qw).Normalized(),
                                  motionType, layerOf(motionType, how.layer));
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
    if (isSensor != 0) g().sensorBodies.insert(id.GetIndexAndSequenceNumber());
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
    g().system->SetContactListener(&recorder());
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
    g().characters.clear();
    g().sensorBodies.clear();
    g().contactEnterBuffer.clear();
    g().contactExitBuffer.clear();
    g().sensorEnterBuffer.clear();
    g().sensorExitBuffer.clear();
    g().entityOf.clear();
    g().transformBuffer.clear();
    g().queryBuffer.clear();
    // Factory/RegisterTypes are deliberately left standing: they are process-wide
    // and a second world would only re-register the same types.
}

EMSCRIPTEN_KEEPALIVE
int physics3d_isReady() { return g().isValid() ? 1 : 0; }

/**
 * @brief Declares which layers layer `layer` collides with.
 * @details Both sides must agree, so a body only meets another when each names
 *          the other — one of them saying no is enough to keep them apart. Set
 *          before bodies are registered: an ObjectLayer is fixed at creation.
 */
EMSCRIPTEN_KEEPALIVE
void physics3d_setLayerMask(uint32_t layer, uint32_t mask) {
    if (layer < esengine::physics3d::Layers::COUNT) {
        esengine::physics3d::layerMatrix().masks[layer] = mask;
    }
}

/// Advance the world, then refill the transform buffer with every active body.
EMSCRIPTEN_KEEPALIVE
void physics3d_step(float dt, int collisionSteps) {
    if (!g().isValid() || dt <= 0.0f) return;
    // Cleared before the step, not after: the listener fires DURING Update, and a
    // buffer emptied afterwards would publish nothing.
    g().contactEnterBuffer.clear();
    g().contactExitBuffer.clear();
    g().sensorEnterBuffer.clear();
    g().sensorExitBuffer.clear();
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
                          float angularDamping, int fixedRotation, uint32_t layer,
                          float friction, float restitution, int isSensor) {
    return addBody(entity, new BoxShape(Vec3(hx, hy, hz)), px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer},
                   friction, restitution, isSensor);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSphere(uint32_t entity, float radius,
                             float px, float py, float pz,
                             float qx, float qy, float qz, float qw,
                             int motion, float gravityScale, float linearDamping,
                             float angularDamping, int fixedRotation, uint32_t layer,
                             float friction, float restitution, int isSensor) {
    return addBody(entity, new SphereShape(radius), px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer},
                   friction, restitution, isSensor);
}

/// `halfHeight` is the cylinder half-height, so the capsule is `2*halfHeight + 2*radius`
/// tall — the same convention CapsuleCollider uses in 2D.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addCapsule(uint32_t entity, float radius, float halfHeight,
                              float px, float py, float pz,
                              float qx, float qy, float qz, float qw,
                              int motion, float gravityScale, float linearDamping,
                              float angularDamping, int fixedRotation, uint32_t layer,
                              float friction, float restitution, int isSensor) {
    return addBody(entity, new CapsuleShape(halfHeight, radius), px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer},
                   friction, restitution, isSensor);
}

/**
 * @brief Registers imported geometry as a collider.
 * @details Triangles rather than a shape: the `.esmesh` format belongs to the
 *          asset layer, which hands over positions it has already extracted and
 *          scaled. A mesh collider is always STATIC — Jolt cannot give a triangle
 *          soup an inertia tensor, so there is nothing for a solver to push.
 * @param vertexPtr `vertexCount * 3` floats, in metres, in the body's own space.
 * @param indexPtr `indexCount` uint32 indices; must be a triangle list.
 */
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addMeshBody(uint32_t entity, uintptr_t vertexPtr, uint32_t vertexCount,
                               uintptr_t indexPtr, uint32_t indexCount,
                               float px, float py, float pz,
                               float qx, float qy, float qz, float qw,
                               uint32_t layer, float friction, float restitution) {
    if (!g().isValid() || vertexCount == 0 || indexCount < 3 || indexCount % 3 != 0) return 0;
    const float* positions = reinterpret_cast<const float*>(vertexPtr);
    const uint32_t* indices = reinterpret_cast<const uint32_t*>(indexPtr);
    if (positions == nullptr || indices == nullptr) return 0;

    VertexList vertices;
    vertices.reserve(vertexCount);
    for (uint32_t i = 0; i < vertexCount; ++i) {
        vertices.push_back(Float3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    }
    IndexedTriangleList triangles;
    triangles.reserve(indexCount / 3);
    for (uint32_t i = 0; i + 2 < indexCount; i += 3) {
        if (indices[i] >= vertexCount || indices[i + 1] >= vertexCount
            || indices[i + 2] >= vertexCount) {
            return 0;  // an index past the vertices would read whatever follows them
        }
        triangles.push_back(IndexedTriangle(indices[i], indices[i + 1], indices[i + 2], 0));
    }

    MeshShapeSettings settings(std::move(vertices), std::move(triangles));
    settings.SetEmbedded();
    ShapeSettings::ShapeResult shape = settings.Create();
    if (shape.HasError()) return 0;
    return addBody(entity, shape.Get(), px, py, pz, qx, qy, qz, qw,
                   {0, 1.0f, 0.0f, 0.0f, 0, layer}, friction, restitution, 0);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeBody(uint32_t bodyId) {
    if (!g().isValid() || bodyId == 0) return;
    const BodyID id(bodyId);
    BodyInterface& bodies = g().system->GetBodyInterface();
    bodies.RemoveBody(id);
    bodies.DestroyBody(id);
    g().entityOf.erase(bodyId);
    g().sensorBodies.erase(bodyId);
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

// Characters

/**
 * @brief Registers a character: an upright capsule swept against the world.
 * @param maxSlope Steepest ground the character can stand on, in radians.
 * @return the character id, or 0 when there is no world.
 */
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addCharacter(uint32_t entity, float radius, float halfHeight,
                                float px, float py, float pz, float maxSlope, float mass,
                                uint32_t layer) {
    if (!g().isValid()) return 0;
    Ref<CharacterVirtualSettings> settings = new CharacterVirtualSettings();
    settings->mShape = new CapsuleShape(halfHeight, radius);
    settings->mMaxSlopeAngle = maxSlope;
    settings->mMass = mass;
    // The plane below which contacts do not hold the character up. Without it a
    // contact anywhere on the capsule — including the top — reads as ground.
    settings->mSupportingVolume = Plane(Vec3::sAxisY(), -radius);
    auto character = std::make_unique<CharacterVirtual>(
        settings, RVec3(px, py, pz), Quat::sIdentity(), g().system);
    const uint32_t id = g().nextCharacterId++;
    g().characterLayers[id] = layer;
    g().characters[id] = std::move(character);
    g().entityOf[id | CHARACTER_ID_TAG] = entity;
    return id;
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeCharacter(uint32_t characterId) {
    g().characters.erase(characterId);
    g().characterLayers.erase(characterId);
    g().entityOf.erase(characterId | CHARACTER_ID_TAG);
}

/**
 * @brief Moves a character by its velocity for one step.
 * @details ExtendedUpdate is Jolt's own combination of move, stick-to-floor and
 *          walk-stairs: without it a character stops dead at a 10cm step and
 *          launches off the top of every slope it walks down.
 *          Writes (px,py,pz, groundState, nx,ny,nz, vx,vy,vz) to the query buffer.
 */
EMSCRIPTEN_KEEPALIVE
void physics3d_moveCharacter(uint32_t characterId, float vx, float vy, float vz,
                             float dt, float stepUp, float stepDown) {
    g().queryBuffer.clear();
    auto found = g().characters.find(characterId);
    if (!g().isValid() || found == g().characters.end()) return;
    CharacterVirtual& character = *found->second;

    // A CharacterVirtual does not fall on its own — its gravity parameter only
    // pushes down on what it stands on, and the vertical speed is the caller's.
    // Carried here so `vy = 0` means "walk", not "hang in the air".
    float vertical = character.GetLinearVelocity().GetY();
    if (vy != 0.0f) {
        vertical = vy;  // a jump, or a deliberate dive
    } else if (character.GetGroundState() == CharacterVirtual::EGroundState::OnGround) {
        vertical = 0.0f;
    } else {
        vertical += g().system->GetGravity().GetY() * dt;
    }
    character.SetLinearVelocity(Vec3(vx, vertical, vz));
    CharacterVirtual::ExtendedUpdateSettings settings;
    settings.mWalkStairsStepUp = Vec3(0, stepUp, 0);
    settings.mStickToFloorStepDown = Vec3(0, -stepDown, 0);
    const ObjectLayer objectLayer = esengine::physics3d::Layers::of(
        g().characterLayers.count(characterId) ? g().characterLayers[characterId] : 0, true);
    character.ExtendedUpdate(dt, g().system->GetGravity(), settings,
                             g().system->GetDefaultBroadPhaseLayerFilter(objectLayer),
                             g().system->GetDefaultLayerFilter(objectLayer),
                             {}, {}, *g().temp);

    const RVec3 position = character.GetPosition();
    const Vec3 normal = character.GetGroundNormal();
    const Vec3 velocity = character.GetLinearVelocity();
    g().queryBuffer = {
        static_cast<float>(position.GetX()), static_cast<float>(position.GetY()),
        static_cast<float>(position.GetZ()),
        static_cast<float>(character.GetGroundState()),
        normal.GetX(), normal.GetY(), normal.GetZ(),
        velocity.GetX(), velocity.GetY(), velocity.GetZ(),
    };
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setCharacterPosition(uint32_t characterId, float px, float py, float pz) {
    auto found = g().characters.find(characterId);
    if (found != g().characters.end()) found->second->SetPosition(RVec3(px, py, pz));
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
const float* physics3d_contactEnters() { return g().contactEnterBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_contactEntersBytes() {
    return g().contactEnterBuffer.size() * sizeof(float);
}

EMSCRIPTEN_KEEPALIVE
const float* physics3d_contactExits() { return g().contactExitBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_contactExitsBytes() {
    return g().contactExitBuffer.size() * sizeof(float);
}

EMSCRIPTEN_KEEPALIVE
const float* physics3d_sensorEnters() { return g().sensorEnterBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_sensorEntersBytes() {
    return g().sensorEnterBuffer.size() * sizeof(float);
}

EMSCRIPTEN_KEEPALIVE
const float* physics3d_sensorExits() { return g().sensorExitBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_sensorExitsBytes() {
    return g().sensorExitBuffer.size() * sizeof(float);
}

EMSCRIPTEN_KEEPALIVE
const float* physics3d_queryResult() { return g().queryBuffer.data(); }

EMSCRIPTEN_KEEPALIVE
size_t physics3d_queryResultBytes() {
    return g().queryBuffer.size() * sizeof(float);
}

}  // extern "C"
