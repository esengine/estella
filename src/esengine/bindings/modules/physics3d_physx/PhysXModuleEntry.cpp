// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysXModuleEntry.cpp
 * @brief   The PhysX backend's world, bodies, characters, queries and readback.
 * @details Every entry point here answers what its Jolt twin answers, in the
 *          same buffer layouts (Physics3DBindings.hpp is included so a
 *          signature that drifts is a compile error). Where the two engines
 *          genuinely differ the choice follows Unity, which runs this same
 *          solver: trigger volumes report character controllers, and a
 *          character stops rising when it hits a ceiling.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "./PhysXWorld.hpp"
#include "../physics3d/Physics3DBindings.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

using namespace physx;
using esengine::physics3d_physx::Body;
using esengine::physics3d_physx::Character;
using esengine::physics3d_physx::World;
namespace px3 = esengine::physics3d_physx;

namespace {

PxDefaultAllocator& allocator() { static PxDefaultAllocator a; return a; }
PxDefaultErrorCallback& errors() { static PxDefaultErrorCallback e; return e; }
PxFoundation* gFoundation = nullptr;
PxPhysics* gPhysics = nullptr;

World& g() { return px3::world(); }

// Unity's defaults for the same solver (Project Settings > Physics, Rigidbody).
constexpr float CONTACT_OFFSET = 0.01f;
constexpr float SLEEP_THRESHOLD = 0.005f;
/// Unity's Default Max Angular Speed since 2021.2 (it was 7 before).
constexpr float MAX_ANGULAR_VELOCITY = 50.0f;
constexpr float MAX_DEPENETRATION_VELOCITY = 10.0f;
constexpr uint32_t POSITION_ITERATIONS = 6;
constexpr uint32_t VELOCITY_ITERATIONS = 1;
constexpr float BOUNCE_THRESHOLD = 2.0f;
/// The ABI names no mass, so a body weighs what its volume of water would: the
/// density the Jolt backend uses, so switching backend does not change a scene.
constexpr float DENSITY = 1000.0f;
constexpr PxU32 MAX_OVERLAP_HITS = 256;

PxMaterial* material(float friction, float restitution) {
    uint32_t f = 0, r = 0;
    std::memcpy(&f, &friction, 4);
    std::memcpy(&r, &restitution, 4);
    const uint64_t key = (static_cast<uint64_t>(f) << 32) | r;
    auto found = g().materials.find(key);
    if (found != g().materials.end()) return found->second;
    // One friction for both, as the SDK authors one; Average is Unity's default
    // combine for both friction and bounce.
    PxMaterial* m = gPhysics->createMaterial(friction, friction, restitution);
    m->setFrictionCombineMode(PxCombineMode::eAVERAGE);
    m->setRestitutionCombineMode(PxCombineMode::eAVERAGE);
    g().materials[key] = m;
    return m;
}

PxFilterData filterData(uint32_t layer, uint32_t kind) {
    PxFilterData d;
    d.word0 = layer;
    d.word1 = kind;
    return d;
}

/**
 * Who meets whom. Layers are read from the live matrix, as the Jolt backend
 * reads its own. Characters push and are pushed but report no contacts — a
 * Jolt character is not a body and reports none either — while a trigger does
 * report them, which is what Unity's OnTriggerEnter on a player relies on.
 */
PxFilterFlags filterShader(PxFilterObjectAttributes a0, PxFilterData d0,
                           PxFilterObjectAttributes a1, PxFilterData d1,
                           PxPairFlags& flags, const void*, PxU32) {
    if (!g().collide(d0.word0, d1.word0)) return PxFilterFlag::eSUPPRESS;
    if (PxFilterObjectIsTrigger(a0) || PxFilterObjectIsTrigger(a1)) {
        flags = PxPairFlag::eTRIGGER_DEFAULT;
        return PxFilterFlag::eDEFAULT;
    }
    flags = PxPairFlag::eCONTACT_DEFAULT | PxPairFlag::eDETECT_CCD_CONTACT;
    if (((d0.word1 | d1.word1) & px3::KIND_CHARACTER) == 0) {
        flags |= PxPairFlag::eNOTIFY_TOUCH_FOUND | PxPairFlag::eNOTIFY_TOUCH_LOST
               | PxPairFlag::eNOTIFY_CONTACT_POINTS;
    }
    return PxFilterFlag::eDEFAULT;
}

/** Records what touched what, in the layouts the Jolt module writes. */
class ContactRecorder final : public PxSimulationEventCallback {
public:
    void onContact(const PxContactPairHeader& header, const PxContactPair* pairs, PxU32 count) override {
        // A removed actor's pointer is not to be read; its side is nobody.
        const uint32_t a = (header.flags & PxContactPairHeaderFlag::eREMOVED_ACTOR_0)
            ? 0u : px3::entityOf(header.actors[0]);
        const uint32_t b = (header.flags & PxContactPairHeaderFlag::eREMOVED_ACTOR_1)
            ? 0u : px3::entityOf(header.actors[1]);
        if (a == 0 && b == 0) return;
        for (PxU32 i = 0; i < count; ++i) {
            const PxContactPair& pair = pairs[i];
            if (pair.events & PxPairFlag::eNOTIFY_TOUCH_FOUND) {
                PxContactPairPoint point;
                PxVec3 normal(0.0f), position(0.0f);
                if (pair.contactCount > 0 && pair.extractContacts(&point, 1) > 0) {
                    // PhysX points from the second shape to the first; the
                    // buffer, like Jolt's, points from A to B.
                    normal = -point.normal;
                    position = point.position;
                }
                g().contactEnterBuffer.insert(g().contactEnterBuffer.end(), {
                    static_cast<float>(a), static_cast<float>(b),
                    normal.x, normal.y, normal.z, position.x, position.y, position.z,
                });
            }
            if (pair.events & PxPairFlag::eNOTIFY_TOUCH_LOST) {
                g().contactExitBuffer.push_back(static_cast<float>(a));
                g().contactExitBuffer.push_back(static_cast<float>(b));
            }
        }
    }

    void onTrigger(PxTriggerPair* pairs, PxU32 count) override {
        for (PxU32 i = 0; i < count; ++i) {
            const PxTriggerPair& pair = pairs[i];
            const uint32_t sensor = (pair.flags & PxTriggerPairFlag::eREMOVED_SHAPE_TRIGGER)
                ? 0u : px3::entityOf(pair.triggerActor);
            const uint32_t other = (pair.flags & PxTriggerPairFlag::eREMOVED_SHAPE_OTHER)
                ? 0u : px3::entityOf(pair.otherActor);
            if (sensor == 0 && other == 0) continue;
            // The sensor first, as the Jolt module writes it.
            std::vector<float>& out = pair.status == PxPairFlag::eNOTIFY_TOUCH_FOUND
                ? g().sensorEnterBuffer : g().sensorExitBuffer;
            if (pair.status != PxPairFlag::eNOTIFY_TOUCH_FOUND
                && pair.status != PxPairFlag::eNOTIFY_TOUCH_LOST) continue;
            out.push_back(static_cast<float>(sensor));
            out.push_back(static_cast<float>(other));
        }
    }

    void onConstraintBreak(PxConstraintInfo*, PxU32) override {}
    void onWake(PxActor**, PxU32) override {}
    void onSleep(PxActor**, PxU32) override {}
    void onAdvance(const PxRigidBody* const*, const PxTransform*, const PxU32) override {}
};

ContactRecorder& recorder() { static ContactRecorder r; return r; }

struct BodyMotion {
    int motion = 0;
    float gravityScale = 1.0f;
    float linearDamping = 0.0f;
    float angularDamping = 0.0f;
    int fixedRotation = 0;
    uint32_t layer = 0;
    int continuous = 0;
};

PxQuat quat(float qx, float qy, float qz, float qw) {
    PxQuat q(qx, qy, qz, qw);
    return q.magnitudeSquared() > 0.0f ? q.getNormalized() : PxQuat(PxIdentity);
}

/// Register one shape as a body, and remember which entity it speaks for.
uint32_t addBody(uint32_t entity, const PxGeometry& geometry, const PxTransform& local,
                 float px, float py, float pz, float qx, float qy, float qz, float qw,
                 const BodyMotion& how, float friction, float restitution, int isSensor) {
    if (!g().isValid()) return 0;
    const PxTransform pose(PxVec3(px, py, pz), quat(qx, qy, qz, qw));
    if (!pose.isValid()) return 0;
    PxRigidActor* actor = nullptr;
    PxRigidDynamic* dynamic = nullptr;
    if (how.motion == 0) {
        actor = gPhysics->createRigidStatic(pose);
    } else {
        dynamic = gPhysics->createRigidDynamic(pose);
        actor = dynamic;
    }
    if (actor == nullptr) return 0;

    // A trigger is still found by queries: Unity's queriesHitTriggers is on by default.
    const PxShapeFlags shapeFlags = isSensor != 0
        ? PxShapeFlags(PxShapeFlag::eTRIGGER_SHAPE | PxShapeFlag::eSCENE_QUERY_SHAPE)
        : PxShapeFlags(PxShapeFlag::eSIMULATION_SHAPE | PxShapeFlag::eSCENE_QUERY_SHAPE);
    PxShape* shape = gPhysics->createShape(geometry, *material(friction, restitution), true, shapeFlags);
    if (shape == nullptr) { actor->release(); return 0; }
    shape->setLocalPose(local);
    shape->setContactOffset(CONTACT_OFFSET);
    shape->setRestOffset(0.0f);
    shape->setSimulationFilterData(filterData(how.layer, 0));
    shape->setQueryFilterData(filterData(how.layer, 0));
    actor->attachShape(*shape);
    shape->release();

    auto record = std::make_unique<Body>();
    record->entity = entity;
    record->layer = how.layer;
    record->actor = actor;
    record->sensor = isSensor != 0;
    record->gravityScale = how.gravityScale;

    if (dynamic != nullptr) {
        if (how.motion == 1) dynamic->setRigidBodyFlag(PxRigidBodyFlag::eKINEMATIC, true);
        if (isSensor != 0) {
            // A trigger has no volume to weigh; it needs a mass all the same.
            dynamic->setMass(1.0f);
            dynamic->setMassSpaceInertiaTensor(PxVec3(1.0f));
        } else {
            PxRigidBodyExt::updateMassAndInertia(*dynamic, DENSITY);
        }
        dynamic->setLinearDamping(how.linearDamping);
        dynamic->setAngularDamping(how.angularDamping);
        dynamic->setMaxAngularVelocity(MAX_ANGULAR_VELOCITY);
        dynamic->setMaxDepenetrationVelocity(MAX_DEPENETRATION_VELOCITY);
        dynamic->setSleepThreshold(SLEEP_THRESHOLD);
        dynamic->setSolverIterationCounts(POSITION_ITERATIONS, VELOCITY_ITERATIONS);
        if (how.fixedRotation != 0) {
            dynamic->setRigidDynamicLockFlags(PxRigidDynamicLockFlag::eLOCK_ANGULAR_X
                | PxRigidDynamicLockFlag::eLOCK_ANGULAR_Y | PxRigidDynamicLockFlag::eLOCK_ANGULAR_Z);
        }
        // A kinematic body follows its target exactly; sweeping it is an error in PhysX.
        if (how.continuous != 0 && how.motion == 2) {
            dynamic->setRigidBodyFlag(PxRigidBodyFlag::eENABLE_CCD, true);
        }
        if (how.gravityScale != 1.0f) actor->setActorFlag(PxActorFlag::eDISABLE_GRAVITY, true);
    }

    const uint32_t id = g().nextBodyId++;
    record->id = id;
    actor->userData = record.get();
    g().scene->addActor(*actor);
    g().bodies[id] = std::move(record);
    return id;
}

/// A collider's offset from the entity. A caller that leaves it off passes NaN,
/// which means none, as `> 0` reads it in the Jolt backend.
PxVec3 offset(float cx, float cy, float cz) {
    const PxVec3 v(cx, cy, cz);
    return v.isFinite() ? v : PxVec3(0.0f);
}

/// A capsule stands up: PhysX lays its axis along X, the SDK stands it along Y.
const PxQuat& capsuleUpright() {
    static const PxQuat q(PxHalfPi, PxVec3(0.0f, 0.0f, 1.0f));
    return q;
}

PxRigidDynamic* dynamicOf(uint32_t bodyId) {
    Body* body = g().body(bodyId);
    return body ? body->actor->is<PxRigidDynamic>() : nullptr;
}

bool isKinematic(const PxRigidDynamic* dynamic) {
    return dynamic->getRigidBodyFlags() & PxRigidBodyFlag::eKINEMATIC;
}

/// What a substep does before PhysX runs it: the gravity a factor stands in for,
/// and the targets kinematic bodies given a velocity move to.
void beforeSubstep(float h) {
    const PxVec3 gravity = g().scene->getGravity();
    for (auto& entry : g().bodies) {
        Body& body = *entry.second;
        PxRigidDynamic* dynamic = body.actor->is<PxRigidDynamic>();
        if (dynamic == nullptr) continue;
        if (isKinematic(dynamic)) {
            if (!body.hasKinematicVelocity) continue;
            PxTransform target = dynamic->getGlobalPose();
            target.p += body.kinematicVelocity * h;
            dynamic->setKinematicTarget(target);
        } else if (body.gravityScale != 1.0f && !dynamic->isSleeping()) {
            dynamic->addForce(gravity * body.gravityScale, PxForceMode::eACCELERATION, false);
        }
    }
}

}  // namespace

namespace esengine::physics3d_physx {
World& world() { static World instance; return instance; }
PxPhysics& physics() { return *gPhysics; }
PxMaterial* defaultMaterial() { return material(0.6f, 0.0f); }
}  // namespace esengine::physics3d_physx

extern "C" {

// World lifecycle

EMSCRIPTEN_KEEPALIVE
void physics3d_init(float gx, float gy, float gz, uint32_t) {
    if (g().isValid()) return;
    // Foundation and SDK are process-wide, and PhysX allows one foundation: a
    // world built after a shutdown reuses them.
    if (gFoundation == nullptr) {
        gFoundation = PxCreateFoundation(PX_PHYSICS_VERSION, allocator(), errors());
        if (gFoundation == nullptr) return;
        gPhysics = PxCreatePhysics(PX_PHYSICS_VERSION, *gFoundation, PxTolerancesScale(), false, nullptr);
        if (gPhysics == nullptr) return;
        // No PxInitExtensions: it registers the serializers (and with them the
        // metadata of every PhysX type), and joints need neither without PVD.
    }
    // No worker threads: a wasm module has none, and the tasks run on the
    // thread that steps.
    g().dispatcher = PxDefaultCpuDispatcherCreate(0);
    PxSceneDesc desc(gPhysics->getTolerancesScale());
    desc.gravity = PxVec3(gx, gy, gz);
    desc.cpuDispatcher = g().dispatcher;
    desc.filterShader = filterShader;
    desc.simulationEventCallback = &recorder();
    desc.flags |= PxSceneFlag::eENABLE_ACTIVE_ACTORS | PxSceneFlag::eENABLE_CCD | PxSceneFlag::eENABLE_PCM;
    desc.frictionType = PxFrictionType::ePATCH;
    desc.solverType = PxSolverType::ePGS;
    desc.bounceThresholdVelocity = BOUNCE_THRESHOLD;
    g().scene = gPhysics->createScene(desc);
    if (g().scene == nullptr) return;
    g().controllers = PxCreateControllerManager(*g().scene);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_shutdown() {
    if (!g().isValid()) return;
    for (auto& entry : g().joints) entry.second.joint->release();
    g().joints.clear();
    g().characters.clear();
    if (g().controllers) g().controllers->release();  // releases every controller
    g().controllers = nullptr;
    for (auto& entry : g().bodies) entry.second->actor->release();
    g().bodies.clear();
    g().scene->release();
    g().scene = nullptr;
    g().dispatcher->release();
    g().dispatcher = nullptr;
    g().transformBuffer.clear();
    g().queryBuffer.clear();
    g().contactEnterBuffer.clear();
    g().contactExitBuffer.clear();
    g().sensorEnterBuffer.clear();
    g().sensorExitBuffer.clear();
}

EMSCRIPTEN_KEEPALIVE
int physics3d_isReady() { return g().isValid() ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE
void physics3d_setLayerMask(uint32_t layer, uint32_t mask) {
    if (layer < px3::LAYER_COUNT) g().masks[layer] = mask;
}

EMSCRIPTEN_KEEPALIVE
void physics3d_step(float dt, int collisionSteps) {
    if (!g().isValid() || dt <= 0.0f) return;
    g().contactEnterBuffer.clear();
    g().contactExitBuffer.clear();
    g().sensorEnterBuffer.clear();
    g().sensorExitBuffer.clear();
    const int steps = collisionSteps > 0 ? collisionSteps : 1;
    const float h = dt / static_cast<float>(steps);
    for (int i = 0; i < steps; ++i) {
        beforeSubstep(h);
        g().scene->simulate(h);
        g().scene->fetchResults(true);
    }

    PxU32 count = 0;
    PxActor** active = g().scene->getActiveActors(count);
    std::vector<float>& out = g().transformBuffer;
    out.clear();
    out.reserve(count * 8);
    for (PxU32 i = 0; i < count; ++i) {
        const PxRigidActor* actor = active[i]->is<PxRigidActor>();
        if (actor == nullptr || actor->userData == nullptr) continue;
        const Body* body = static_cast<const Body*>(actor->userData);
        if (body->character) continue;  // its pose comes back from moveCharacter
        const PxTransform pose = actor->getGlobalPose();
        out.insert(out.end(), {
            static_cast<float>(body->entity), pose.p.x, pose.p.y, pose.p.z,
            pose.q.x, pose.q.y, pose.q.z, pose.q.w,
        });
    }
}

EMSCRIPTEN_KEEPALIVE
void physics3d_optimize() {
    if (g().isValid()) g().scene->forceRebuildDynamicTree(PX_SCENE_PRUNER_STATIC);
}

// Bodies

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addBox(uint32_t entity, float hx, float hy, float hz,
                          float px, float py, float pz,
                          float qx, float qy, float qz, float qw,
                          int motion, float gravityScale, float linearDamping,
                          float angularDamping, int fixedRotation, uint32_t layer,
                          int continuous, float friction, float restitution, int isSensor,
                          float cx, float cy, float cz) {
    if (!(hx > 0.0f && hy > 0.0f && hz > 0.0f)) return 0;
    return addBody(entity, PxBoxGeometry(hx, hy, hz), PxTransform(offset(cx, cy, cz)),
                   px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer, continuous},
                   friction, restitution, isSensor);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSphere(uint32_t entity, float radius,
                             float px, float py, float pz,
                             float qx, float qy, float qz, float qw,
                             int motion, float gravityScale, float linearDamping,
                             float angularDamping, int fixedRotation, uint32_t layer,
                             int continuous, float friction, float restitution, int isSensor,
                             float cx, float cy, float cz) {
    if (!(radius > 0.0f)) return 0;
    return addBody(entity, PxSphereGeometry(radius), PxTransform(offset(cx, cy, cz)),
                   px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer, continuous},
                   friction, restitution, isSensor);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addCapsule(uint32_t entity, float radius, float halfHeight,
                              float px, float py, float pz,
                              float qx, float qy, float qz, float qw,
                              int motion, float gravityScale, float linearDamping,
                              float angularDamping, int fixedRotation, uint32_t layer,
                              int continuous, float friction, float restitution, int isSensor,
                              float cx, float cy, float cz) {
    if (!(radius > 0.0f) || !(halfHeight >= 0.0f)) return 0;
    return addBody(entity, PxCapsuleGeometry(radius, halfHeight),
                   PxTransform(offset(cx, cy, cz), capsuleUpright()),
                   px, py, pz, qx, qy, qz, qw,
                   {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer, continuous},
                   friction, restitution, isSensor);
}

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
    for (uint32_t i = 0; i < indexCount; ++i) {
        if (indices[i] >= vertexCount) return 0;  // would read past the vertices
    }
    PxTriangleMeshDesc desc;
    desc.points.count = vertexCount;
    desc.points.stride = sizeof(float) * 3;
    desc.points.data = positions;
    desc.triangles.count = indexCount / 3;
    desc.triangles.stride = sizeof(uint32_t) * 3;
    desc.triangles.data = indices;
    const PxCookingParams params(gPhysics->getTolerancesScale());
    PxTriangleMesh* mesh = PxCreateTriangleMesh(params, desc, gPhysics->getPhysicsInsertionCallback());
    if (mesh == nullptr) return 0;
    // A triangle soup has no inside, so no mass: always static, as in the Jolt backend.
    const uint32_t id = addBody(entity, PxTriangleMeshGeometry(mesh), PxTransform(PxIdentity),
                                px, py, pz, qx, qy, qz, qw, {0, 1.0f, 0.0f, 0.0f, 0, layer},
                                friction, restitution, 0);
    mesh->release();  // the shape holds its own reference
    return id;
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addConvexBody(uint32_t entity, uintptr_t vertexPtr, uint32_t vertexCount,
                                 float px, float py, float pz,
                                 float qx, float qy, float qz, float qw,
                                 int motion, float gravityScale, float linearDamping,
                                 float angularDamping, int fixedRotation, uint32_t layer,
                                 int continuous, float friction, float restitution, int isSensor) {
    if (!g().isValid() || vertexCount < 4) return 0;
    const float* positions = reinterpret_cast<const float*>(vertexPtr);
    if (positions == nullptr) return 0;
    PxConvexMeshDesc desc;
    desc.points.count = vertexCount;
    desc.points.stride = sizeof(float) * 3;
    desc.points.data = positions;
    // PhysX keeps at most 255 hull vertices, Unity's limit as well.
    desc.flags = PxConvexFlag::eCOMPUTE_CONVEX;
    const PxCookingParams params(gPhysics->getTolerancesScale());
    PxConvexMesh* mesh = PxCreateConvexMesh(params, desc, gPhysics->getPhysicsInsertionCallback());
    // Every point on a plane, or all the same, has no hull.
    if (mesh == nullptr) return 0;
    const uint32_t id = addBody(entity, PxConvexMeshGeometry(mesh), PxTransform(PxIdentity),
                                px, py, pz, qx, qy, qz, qw,
                                {motion, gravityScale, linearDamping, angularDamping, fixedRotation, layer, continuous},
                                friction, restitution, isSensor);
    mesh->release();
    return id;
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeBody(uint32_t bodyId) {
    auto found = g().bodies.find(bodyId);
    if (!g().isValid() || found == g().bodies.end()) return;
    PxRigidActor* actor = found->second->actor;
    actor->userData = nullptr;
    actor->release();  // leaves the scene as it goes
    g().bodies.erase(found);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setTransform(uint32_t bodyId, float px, float py, float pz,
                            float qx, float qy, float qz, float qw) {
    Body* body = g().body(bodyId);
    if (!g().isValid() || body == nullptr) return;
    const PxTransform pose(PxVec3(px, py, pz), quat(qx, qy, qz, qw));
    if (!pose.isValid()) return;
    // A teleport, as SetPositionAndRotation is in Jolt; it wakes the body too.
    body->actor->setGlobalPose(pose, true);
    if (PxRigidDynamic* dynamic = body->actor->is<PxRigidDynamic>()) {
        if (isKinematic(dynamic)) dynamic->setKinematicTarget(pose);
    }
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setLinearVelocity(uint32_t bodyId, float vx, float vy, float vz) {
    Body* body = g().body(bodyId);
    if (!g().isValid() || body == nullptr) return;
    PxRigidDynamic* dynamic = body->actor->is<PxRigidDynamic>();
    if (dynamic == nullptr) return;
    const PxVec3 v(vx, vy, vz);
    if (!v.isFinite()) return;
    if (isKinematic(dynamic)) {
        body->kinematicVelocity = v;
        body->hasKinematicVelocity = !v.isZero();
    } else {
        dynamic->setLinearVelocity(v, true);
    }
}

EMSCRIPTEN_KEEPALIVE
int physics3d_getBodyState(uint32_t bodyId) {
    Body* body = g().body(bodyId);
    if (!g().isValid() || body == nullptr) return 0;
    const PxTransform pose = body->actor->getGlobalPose();
    PxVec3 v(0.0f);
    if (const PxRigidDynamic* dynamic = body->actor->is<PxRigidDynamic>()) {
        v = isKinematic(dynamic) ? body->kinematicVelocity : dynamic->getLinearVelocity();
    }
    g().queryBuffer = {pose.p.x, pose.p.y, pose.p.z, pose.q.x, pose.q.y, pose.q.z, pose.q.w, v.x, v.y, v.z};
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int physics3d_getBodyDynamics(uint32_t bodyId) {
    PxRigidDynamic* dynamic = dynamicOf(bodyId);
    if (!g().isValid() || dynamic == nullptr || isKinematic(dynamic)) return 0;
    const float mass = dynamic->getMass();
    if (!(mass > 0.0f)) return 0;
    const PxVec3 w = dynamic->getAngularVelocity();
    g().queryBuffer = {mass, w.x, w.y, w.z};
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void physics3d_addForce(uint32_t bodyId, float fx, float fy, float fz, float px, float py, float pz) {
    PxRigidDynamic* dynamic = dynamicOf(bodyId);
    if (!g().isValid() || dynamic == nullptr || isKinematic(dynamic)) return;
    PxRigidBodyExt::addForceAtPos(*dynamic, PxVec3(fx, fy, fz), PxVec3(px, py, pz), PxForceMode::eFORCE, true);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_addTorque(uint32_t bodyId, float tx, float ty, float tz) {
    PxRigidDynamic* dynamic = dynamicOf(bodyId);
    if (!g().isValid() || dynamic == nullptr || isKinematic(dynamic)) return;
    dynamic->addTorque(PxVec3(tx, ty, tz), PxForceMode::eFORCE, true);
}

// Readback

EMSCRIPTEN_KEEPALIVE
uintptr_t physics3d_transforms() { return reinterpret_cast<uintptr_t>(g().transformBuffer.data()); }
EMSCRIPTEN_KEEPALIVE
size_t physics3d_transformsBytes() { return g().transformBuffer.size() * sizeof(float); }
EMSCRIPTEN_KEEPALIVE
uintptr_t physics3d_contactEnters() { return reinterpret_cast<uintptr_t>(g().contactEnterBuffer.data()); }
EMSCRIPTEN_KEEPALIVE
size_t physics3d_contactEntersBytes() { return g().contactEnterBuffer.size() * sizeof(float); }
EMSCRIPTEN_KEEPALIVE
uintptr_t physics3d_contactExits() { return reinterpret_cast<uintptr_t>(g().contactExitBuffer.data()); }
EMSCRIPTEN_KEEPALIVE
size_t physics3d_contactExitsBytes() { return g().contactExitBuffer.size() * sizeof(float); }
EMSCRIPTEN_KEEPALIVE
uintptr_t physics3d_sensorEnters() { return reinterpret_cast<uintptr_t>(g().sensorEnterBuffer.data()); }
EMSCRIPTEN_KEEPALIVE
size_t physics3d_sensorEntersBytes() { return g().sensorEnterBuffer.size() * sizeof(float); }
EMSCRIPTEN_KEEPALIVE
uintptr_t physics3d_sensorExits() { return reinterpret_cast<uintptr_t>(g().sensorExitBuffer.data()); }
EMSCRIPTEN_KEEPALIVE
size_t physics3d_sensorExitsBytes() { return g().sensorExitBuffer.size() * sizeof(float); }
EMSCRIPTEN_KEEPALIVE
uintptr_t physics3d_queryResult() { return reinterpret_cast<uintptr_t>(g().queryBuffer.data()); }
EMSCRIPTEN_KEEPALIVE
size_t physics3d_queryResultBytes() { return g().queryBuffer.size() * sizeof(float); }

}  // extern "C"
