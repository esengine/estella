// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./PhysicsContext.hpp"
#include "./PhysicsTaskPool.hpp"

#include <algorithm>
#include <cmath>

#ifndef __EMSCRIPTEN__
namespace {
/// The pool the world solves across, built with the first world and torn down at
/// exit. A wasm side module has no threads, so this exists only off the web.
esengine::physics::TaskPool& taskPool() {
    static esengine::physics::TaskPool pool;
    return pool;
}
}  // namespace
#endif

// How closely the contact normal must align with a platform's solid normal for the
// contact to survive (matches Box2D's own one-sided-platform sample).
static constexpr float ONE_WAY_ALIGN_THRESHOLD = 0.95f;

// Pre-solve callback: cancels contacts that approach a one-way platform from its
// pass-through side. Box2D only invokes this for contacts whose shapes opted in via
// b2Shape_EnablePreSolveEvents, so it costs nothing when no one-way platforms exist.
// Must be thread-safe and side-effect free: it only reads oneWayNormals (never
// mutated during a step) plus the passed-in contact geometry.
static bool preSolveOneWayPlatform(b2ShapeId shapeIdA, b2ShapeId shapeIdB,
                                   b2Vec2 point, b2Vec2 normal, void* context) {
    (void)point;
    (void)context;
    // The manifold normal points from shape A to shape B. A one-way platform keeps a
    // contact only while the *other* shape sits on the platform's solid side.
    auto itA = g_ctx.oneWayNormals.find(entityFromShape(shapeIdA));
    if (itA != g_ctx.oneWayNormals.end()) {
        // Platform = A; direction toward the other shape (B) is +normal.
        float d = normal.x * itA->second.x + normal.y * itA->second.y;
        if (d <= ONE_WAY_ALIGN_THRESHOLD) return false;
    }
    auto itB = g_ctx.oneWayNormals.find(entityFromShape(shapeIdB));
    if (itB != g_ctx.oneWayNormals.end()) {
        // Platform = B; direction toward the other shape (A) is -normal.
        float d = normal.x * itB->second.x + normal.y * itB->second.y;
        if (d >= -ONE_WAY_ALIGN_THRESHOLD) return false;
    }
    return true;
}

extern "C" {

// World Lifecycle

EMSCRIPTEN_KEEPALIVE
void physics_init(float gx, float gy, float timestep, int substeps,
                  float contactHertz, float contactDampingRatio, float contactSpeed) {
    if (b2World_IsValid(g_ctx.worldId)) return;

    b2WorldDef worldDef = b2DefaultWorldDef();
    worldDef.gravity = {gx, gy};
    worldDef.contactHertz = contactHertz;
    worldDef.contactDampingRatio = contactDampingRatio;
    worldDef.contactSpeed = contactSpeed;
#ifndef __EMSCRIPTEN__
    // Solve across the cores a device has and the web build does not. The result
    // is the same either way — Box2D is deterministic under multithreading — so
    // this changes only how long a step takes, never what it produces.
    taskPool().configure(worldDef);
#endif
    g_ctx.worldId = b2CreateWorld(&worldDef);
    b2World_SetPreSolveCallback(g_ctx.worldId, preSolveOneWayPlatform, nullptr);

    g_ctx.fixedTimestep = timestep;
    g_ctx.subStepCount = substeps;
    g_ctx.accumulator = 0.0f;
}

// World-level tuning (surfaced to the SDK / project settings). Hardcoded
// b2DefaultWorldDef values otherwise. A non-positive restitutionThreshold /
// maxLinearSpeed leaves Box2D's default in place.
EMSCRIPTEN_KEEPALIVE
void physics_setWorldConfig(int enableSleep, int enableContinuous,
                           float restitutionThreshold, float maxLinearSpeed) {
    if (!b2World_IsValid(g_ctx.worldId)) return;
    b2World_EnableSleeping(g_ctx.worldId, enableSleep != 0);
    b2World_EnableContinuous(g_ctx.worldId, enableContinuous != 0);
    if (restitutionThreshold > 0.0f) {
        b2World_SetRestitutionThreshold(g_ctx.worldId, restitutionThreshold);
    }
    if (maxLinearSpeed > 0.0f) {
        b2World_SetMaximumLinearSpeed(g_ctx.worldId, maxLinearSpeed);
    }
}

EMSCRIPTEN_KEEPALIVE
void physics_shutdown() {
    g_ctx.reset();
}

// One-way (one-sided) platform: with enable != 0, contacts against this entity's
// shapes are cancelled unless the other body approaches from the (nx, ny) solid
// side (physics space; normalized here, falling back to +Y). enable == 0 clears it.
EMSCRIPTEN_KEEPALIVE
void physics_setOneWayPlatform(uint32_t entityId, float nx, float ny, int enable) {
    if (enable != 0) {
        float len = sqrtf(nx * nx + ny * ny);
        g_ctx.oneWayNormals[entityId] = (len > 0.0f)
            ? b2Vec2{nx / len, ny / len}
            : b2Vec2{0.0f, 1.0f};
    } else {
        g_ctx.oneWayNormals.erase(entityId);
    }

    auto it = g_ctx.entityToShapes.find(entityId);
    if (it != g_ctx.entityToShapes.end()) {
        for (b2ShapeId shapeId : it->second) {
            if (b2Shape_IsValid(shapeId)) {
                b2Shape_EnablePreSolveEvents(shapeId, enable != 0);
            }
        }
    }
}

// Body Management

EMSCRIPTEN_KEEPALIVE
void physics_createBody(uint32_t entityId, int bodyType, float x, float y, float angle,
                        float gravityScale, float linearDamping, float angularDamping,
                        int fixedRotation, int bullet) {
    if (!b2World_IsValid(g_ctx.worldId)) return;
    if (entityId == 0xFFFFFFFF) return;
    if (g_ctx.entityToBody.contains(entityId)) return;

    b2BodyDef bodyDef = b2DefaultBodyDef();

    switch (bodyType) {
        case 0: bodyDef.type = b2_staticBody; break;
        case 1: bodyDef.type = b2_kinematicBody; break;
        default: bodyDef.type = b2_dynamicBody; break;
    }

    bodyDef.position = {x, y};
    bodyDef.rotation = b2MakeRot(angle);
    bodyDef.gravityScale = gravityScale;
    bodyDef.linearDamping = linearDamping;
    bodyDef.angularDamping = angularDamping;
    bodyDef.isBullet = bullet != 0;
    bodyDef.motionLocks.angularZ = fixedRotation != 0;

    b2BodyId bodyId = b2CreateBody(g_ctx.worldId, &bodyDef);
    b2Body_SetUserData(bodyId, reinterpret_cast<void*>(static_cast<uintptr_t>(entityId)));
    g_ctx.entityToBody[entityId] = bodyId;
    if (bodyDef.type == b2_dynamicBody) {
        g_ctx.dynamicBodyEntities.push_back(entityId);
    }
}

EMSCRIPTEN_KEEPALIVE
void physics_destroyBody(uint32_t entityId) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    auto jit = g_ctx.entityToJoint.find(entityId);
    if (jit != g_ctx.entityToJoint.end()) {
        if (b2Joint_IsValid(jit->second)) {
            b2DestroyJoint(jit->second, false);
        }
        g_ctx.entityToJoint.erase(jit);
    }

    if (b2Body_IsValid(it->second)) {
        b2DestroyBody(it->second);
    }
    g_ctx.entityToBody.erase(it);
    g_ctx.entityToShapes.erase(entityId);
    auto dit = std::find(g_ctx.dynamicBodyEntities.begin(), g_ctx.dynamicBodyEntities.end(), entityId);
    if (dit != g_ctx.dynamicBodyEntities.end()) {
        *dit = g_ctx.dynamicBodyEntities.back();
        g_ctx.dynamicBodyEntities.pop_back();
    }
}

EMSCRIPTEN_KEEPALIVE
int physics_hasBody(uint32_t entityId) {
    return g_ctx.entityToBody.contains(entityId) ? 1 : 0;
}

// Enable / disable a body in place (RigidBody.enabled). Unlike destroy, this keeps
// the body, its shapes, velocity, and joints — b2Body_Disable just removes it from
// simulation/broadphase — so the reconciler can toggle without losing state.
EMSCRIPTEN_KEEPALIVE
void physics_setBodyEnabled(uint32_t entityId, int enabled) {
    b2BodyId body = findValidBody(entityId);
    if (!b2Body_IsValid(body)) return;
    if (enabled) {
        b2Body_Enable(body);
    } else {
        b2Body_Disable(body);
    }
}

// Simulation

EMSCRIPTEN_KEEPALIVE
void physics_step(float dt) {
    if (!b2World_IsValid(g_ctx.worldId)) return;

    g_ctx.collisionEnterBuffer.clear();
    g_ctx.collisionExitBuffer.clear();
    g_ctx.sensorEnterBuffer.clear();
    g_ctx.sensorExitBuffer.clear();
    g_ctx.hitEventBuffer.clear();

    g_ctx.accumulator += dt;

    int steps = 0;
    while (g_ctx.accumulator >= g_ctx.fixedTimestep && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
        b2World_Step(g_ctx.worldId, g_ctx.fixedTimestep, g_ctx.subStepCount);
        g_ctx.accumulator -= g_ctx.fixedTimestep;
        ++steps;
    }

    if (g_ctx.accumulator > g_ctx.fixedTimestep) {
        g_ctx.accumulator = g_ctx.fixedTimestep;
    }
}

// Transform Sync

EMSCRIPTEN_KEEPALIVE
void physics_setBodyTransform(uint32_t entityId, float x, float y, float angle) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Body_SetTransform(it->second, {x, y}, b2MakeRot(angle));
}

// Drive a kinematic body toward a target pose over `dt`, deriving its
// linear+angular velocity from the delta (unlike setBodyTransform, which
// teleports with zero velocity). The velocity is what the contact solver uses
// to carry/push resting dynamic bodies — a moving platform is dead without it.
EMSCRIPTEN_KEEPALIVE
void physics_setBodyTargetTransform(uint32_t entityId, float x, float y, float angle, float dt) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Transform target = { {x, y}, b2MakeRot(angle) };
    b2Body_SetTargetTransform(it->second, target, dt, true);
}

EMSCRIPTEN_KEEPALIVE
int physics_getDynamicBodyCount() {
    return static_cast<int>(g_ctx.dynamicBodyEntities.size());
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getDynamicBodyTransforms() {
    g_ctx.dynamicTransformBuffer.clear();

    for (uint32_t entityId : g_ctx.dynamicBodyEntities) {
        auto it = g_ctx.entityToBody.find(entityId);
        if (it == g_ctx.entityToBody.end() || !b2Body_IsValid(it->second)) continue;
        // A disabled body is frozen; skip it so the readback doesn't stamp its
        // stale pose back over a Transform the game is hand-animating while
        // physics is off (RigidBody.enabled = false).
        if (!b2Body_IsEnabled(it->second)) continue;

        b2Vec2 pos = b2Body_GetPosition(it->second);
        float angle = b2Rot_GetAngle(b2Body_GetRotation(it->second));

        pushEntityBits(g_ctx.dynamicTransformBuffer, entityId);
        g_ctx.dynamicTransformBuffer.push_back(pos.x);
        g_ctx.dynamicTransformBuffer.push_back(pos.y);
        g_ctx.dynamicTransformBuffer.push_back(angle);
    }

    return reinterpret_cast<uintptr_t>(g_ctx.dynamicTransformBuffer.data());
}

// Render interpolation
//
// The snapshot pair and the lerp live here, not in the SDK: interpolation touches
// every dynamic body every frame, and that is exactly the hot loop the no-JIT
// budget keeps off the JS path (docs/REARCH_NATIVE.md §3.2). The SDK asks for the
// finished buffer and hands it straight to the engine's batched Transform sync.

/** The entity id packed into a flat pose buffer at float offset @p offset. */
static uint32_t poseEntityAt(const std::vector<float>& buf, size_t offset) {
    uint32_t entityId;
    std::memcpy(&entityId, &buf[offset], sizeof(uint32_t));
    return entityId;
}

/** Shortest-arc angle interpolation (radians), matching the SDK's own lerpAngle. */
static float lerpAngleShortest(float a, float b, float t) {
    constexpr float kPi = 3.14159265358979323846f;
    constexpr float kTwoPi = 2.0f * kPi;
    float d = std::fmod(b - a, kTwoPi);
    if (d > kPi) d -= kTwoPi;
    else if (d < -kPi) d += kTwoPi;
    return a + d * t;
}

/**
 * Promote the current snapshot to `prev` and refill it from the world. Called once
 * per fixed step, after the step, so the pair always straddles one step.
 */
EMSCRIPTEN_KEEPALIVE
void physics_capturePoses() {
    g_ctx.posePrev.swap(g_ctx.poseCur);
    g_ctx.poseCur.clear();
    g_ctx.posePrevIndex.clear();

    for (uint32_t entityId : g_ctx.dynamicBodyEntities) {
        auto it = g_ctx.entityToBody.find(entityId);
        if (it == g_ctx.entityToBody.end() || !b2Body_IsValid(it->second)) continue;
        // Same exclusion the readback makes: a disabled body is frozen, and its
        // stale pose must not be stamped back over a hand-animated Transform.
        if (!b2Body_IsEnabled(it->second)) continue;

        b2Vec2 pos = b2Body_GetPosition(it->second);
        float angle = b2Rot_GetAngle(b2Body_GetRotation(it->second));

        pushEntityBits(g_ctx.poseCur, entityId);
        g_ctx.poseCur.push_back(pos.x);
        g_ctx.poseCur.push_back(pos.y);
        g_ctx.poseCur.push_back(angle);
    }
}

EMSCRIPTEN_KEEPALIVE
int physics_getInterpolatedCount() {
    return static_cast<int>(g_ctx.poseCur.size() / 4);
}

/**
 * Interpolate the snapshot pair by @p alpha into a flat [entityBits, x, y, angle]
 * buffer (physics space) and return it. With alpha = 1 this reproduces a direct
 * post-step sync.
 */
EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getInterpolatedTransforms(float alpha) {
    const size_t count = g_ctx.poseCur.size();
    g_ctx.poseInterpolated.resize(count);
    if (count == 0) return reinterpret_cast<uintptr_t>(g_ctx.poseInterpolated.data());

    // Steady state (no body created or destroyed since the last step) keeps both
    // snapshots in the same order, so a body's previous pose sits at its own index
    // and the whole pass is a linear walk. Only a changed body set pays for a map.
    const bool sameLayout = g_ctx.posePrev.size() == count;
    bool indexBuilt = false;

    for (size_t o = 0; o < count; o += 4) {
        const uint32_t entityId = poseEntityAt(g_ctx.poseCur, o);
        const float cx = g_ctx.poseCur[o + 1];
        const float cy = g_ctx.poseCur[o + 2];
        const float ca = g_ctx.poseCur[o + 3];

        const float* prev = nullptr;
        if (sameLayout && poseEntityAt(g_ctx.posePrev, o) == entityId) {
            prev = &g_ctx.posePrev[o];
        } else if (!g_ctx.posePrev.empty()) {
            if (!indexBuilt) {
                for (size_t p = 0; p < g_ctx.posePrev.size(); p += 4) {
                    g_ctx.posePrevIndex[poseEntityAt(g_ctx.posePrev, p)] = static_cast<uint32_t>(p);
                }
                indexBuilt = true;
            }
            auto it = g_ctx.posePrevIndex.find(entityId);
            if (it != g_ctx.posePrevIndex.end()) prev = &g_ctx.posePrev[it->second];
        }

        // A body seen for the first time seeds prev = cur, so it doesn't smear in
        // from wherever it was spawned.
        const float px = prev ? prev[1] : cx;
        const float py = prev ? prev[2] : cy;
        const float pa = prev ? prev[3] : ca;

        std::memcpy(&g_ctx.poseInterpolated[o], &entityId, sizeof(uint32_t));
        g_ctx.poseInterpolated[o + 1] = px + (cx - px) * alpha;
        g_ctx.poseInterpolated[o + 2] = py + (cy - py) * alpha;
        g_ctx.poseInterpolated[o + 3] = lerpAngleShortest(pa, ca, alpha);
    }

    return reinterpret_cast<uintptr_t>(g_ctx.poseInterpolated.data());
}

// Collision Events

EMSCRIPTEN_KEEPALIVE
void physics_collectEvents() {
    if (!b2World_IsValid(g_ctx.worldId)) return;

    b2ContactEvents contactEvents = b2World_GetContactEvents(g_ctx.worldId);

    for (int i = 0; i < contactEvents.beginCount; ++i) {
        auto& evt = contactEvents.beginEvents[i];
        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;

        pushEntityBits(g_ctx.collisionEnterBuffer, entityA);
        pushEntityBits(g_ctx.collisionEnterBuffer, entityB);

        float nx = 0, ny = 0, cx = 0, cy = 0;
        if (b2Contact_IsValid(evt.contactId)) {
            b2ContactData cd = b2Contact_GetData(evt.contactId);
            nx = cd.manifold.normal.x;
            ny = cd.manifold.normal.y;
            if (cd.manifold.pointCount > 0) {
                cx = cd.manifold.points[0].point.x;
                cy = cd.manifold.points[0].point.y;
            }
        }
        g_ctx.collisionEnterBuffer.push_back(nx);
        g_ctx.collisionEnterBuffer.push_back(ny);
        g_ctx.collisionEnterBuffer.push_back(cx);
        g_ctx.collisionEnterBuffer.push_back(cy);
    }

    for (int i = 0; i < contactEvents.endCount; ++i) {
        auto& evt = contactEvents.endEvents[i];
        if (!b2Shape_IsValid(evt.shapeIdA) || !b2Shape_IsValid(evt.shapeIdB)) continue;

        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;

        pushEntityBits(g_ctx.collisionExitBuffer, entityA);
        pushEntityBits(g_ctx.collisionExitBuffer, entityB);
    }

    // High-speed impacts (approach speed past the world's hitEventThreshold) —
    // per hit: [entityA, entityB, pointX, pointY, normalX, normalY, approachSpeed].
    for (int i = 0; i < contactEvents.hitCount; ++i) {
        auto& evt = contactEvents.hitEvents[i];
        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;
        pushEntityBits(g_ctx.hitEventBuffer, entityA);
        pushEntityBits(g_ctx.hitEventBuffer, entityB);
        g_ctx.hitEventBuffer.push_back(evt.point.x);
        g_ctx.hitEventBuffer.push_back(evt.point.y);
        g_ctx.hitEventBuffer.push_back(evt.normal.x);
        g_ctx.hitEventBuffer.push_back(evt.normal.y);
        g_ctx.hitEventBuffer.push_back(evt.approachSpeed);
    }

    b2SensorEvents sensorEvents = b2World_GetSensorEvents(g_ctx.worldId);

    for (int i = 0; i < sensorEvents.beginCount; ++i) {
        auto& evt = sensorEvents.beginEvents[i];
        uint32_t sensor = entityFromShape(evt.sensorShapeId);
        uint32_t visitor = entityFromShape(evt.visitorShapeId);
        if (sensor == 0xFFFFFFFF || visitor == 0xFFFFFFFF) continue;

        pushEntityBits(g_ctx.sensorEnterBuffer, sensor);
        pushEntityBits(g_ctx.sensorEnterBuffer, visitor);
    }

    for (int i = 0; i < sensorEvents.endCount; ++i) {
        auto& evt = sensorEvents.endEvents[i];
        if (!b2Shape_IsValid(evt.sensorShapeId) || !b2Shape_IsValid(evt.visitorShapeId)) continue;

        uint32_t sensor = entityFromShape(evt.sensorShapeId);
        uint32_t visitor = entityFromShape(evt.visitorShapeId);
        if (sensor == 0xFFFFFFFF || visitor == 0xFFFFFFFF) continue;

        pushEntityBits(g_ctx.sensorExitBuffer, sensor);
        pushEntityBits(g_ctx.sensorExitBuffer, visitor);
    }
}

EMSCRIPTEN_KEEPALIVE
int physics_getCollisionEnterCount() {
    return static_cast<int>(g_ctx.collisionEnterBuffer.size() / 6);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getCollisionEnterBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.collisionEnterBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getHitEventCount() {
    return static_cast<int>(g_ctx.hitEventBuffer.size() / 7);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getHitEventBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.hitEventBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getCollisionExitCount() {
    return static_cast<int>(g_ctx.collisionExitBuffer.size() / 2);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getCollisionExitBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.collisionExitBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getSensorEnterCount() {
    return static_cast<int>(g_ctx.sensorEnterBuffer.size() / 2);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getSensorEnterBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.sensorEnterBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getSensorExitCount() {
    return static_cast<int>(g_ctx.sensorExitBuffer.size() / 2);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getSensorExitBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.sensorExitBuffer.data());
}

// Force / Impulse / Velocity

EMSCRIPTEN_KEEPALIVE
void physics_applyForce(uint32_t entityId, float forceX, float forceY) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Vec2 center = b2Body_GetPosition(it->second);
    b2Body_ApplyForce(it->second, {forceX, forceY}, center, true);
}

EMSCRIPTEN_KEEPALIVE
void physics_applyImpulse(uint32_t entityId, float impulseX, float impulseY) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Vec2 center = b2Body_GetPosition(it->second);
    b2Body_ApplyLinearImpulse(it->second, {impulseX, impulseY}, center, true);
}

EMSCRIPTEN_KEEPALIVE
void physics_setLinearVelocity(uint32_t entityId, float vx, float vy) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Body_SetLinearVelocity(it->second, {vx, vy});
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getLinearVelocity(uint32_t entityId) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) {
        g_ctx.velocityBuffer[0] = 0;
        g_ctx.velocityBuffer[1] = 0;
        return reinterpret_cast<uintptr_t>(g_ctx.velocityBuffer);
    }
    if (!b2Body_IsValid(it->second)) {
        g_ctx.velocityBuffer[0] = 0;
        g_ctx.velocityBuffer[1] = 0;
        return reinterpret_cast<uintptr_t>(g_ctx.velocityBuffer);
    }

    b2Vec2 v = b2Body_GetLinearVelocity(it->second);
    g_ctx.velocityBuffer[0] = v.x;
    g_ctx.velocityBuffer[1] = v.y;
    return reinterpret_cast<uintptr_t>(g_ctx.velocityBuffer);
}

// Gravity

EMSCRIPTEN_KEEPALIVE
void physics_setGravity(float gx, float gy) {
    if (!b2World_IsValid(g_ctx.worldId)) return;
    b2World_SetGravity(g_ctx.worldId, {gx, gy});
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getGravity() {
    if (!b2World_IsValid(g_ctx.worldId)) {
        g_ctx.gravityBuffer[0] = 0;
        g_ctx.gravityBuffer[1] = 0;
        return reinterpret_cast<uintptr_t>(g_ctx.gravityBuffer);
    }
    b2Vec2 g = b2World_GetGravity(g_ctx.worldId);
    g_ctx.gravityBuffer[0] = g.x;
    g_ctx.gravityBuffer[1] = g.y;
    return reinterpret_cast<uintptr_t>(g_ctx.gravityBuffer);
}

// Angular Velocity / Torque

EMSCRIPTEN_KEEPALIVE
void physics_setAngularVelocity(uint32_t entityId, float omega) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_SetAngularVelocity(it->second, omega);
}

EMSCRIPTEN_KEEPALIVE
float physics_getAngularVelocity(uint32_t entityId) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(it->second)) return 0;
    return b2Body_GetAngularVelocity(it->second);
}

EMSCRIPTEN_KEEPALIVE
void physics_applyTorque(uint32_t entityId, float torque) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_ApplyTorque(it->second, torque, true);
}

EMSCRIPTEN_KEEPALIVE
void physics_applyAngularImpulse(uint32_t entityId, float impulse) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_ApplyAngularImpulse(it->second, impulse, true);
}

// Runtime Body Property Update

EMSCRIPTEN_KEEPALIVE
void physics_updateBodyProperties(uint32_t entityId, int bodyType,
                                  float gravityScale, float linearDamping, float angularDamping,
                                  int fixedRotation, int bullet) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2BodyType type;
    switch (bodyType) {
        case 0: type = b2_staticBody; break;
        case 1: type = b2_kinematicBody; break;
        default: type = b2_dynamicBody; break;
    }
    b2BodyType oldType = b2Body_GetType(it->second);
    b2Body_SetType(it->second, type);
    if (oldType != type) {
        auto dit = std::find(g_ctx.dynamicBodyEntities.begin(), g_ctx.dynamicBodyEntities.end(), entityId);
        if (type == b2_dynamicBody && dit == g_ctx.dynamicBodyEntities.end()) {
            g_ctx.dynamicBodyEntities.push_back(entityId);
        } else if (type != b2_dynamicBody && dit != g_ctx.dynamicBodyEntities.end()) {
            *dit = g_ctx.dynamicBodyEntities.back();
            g_ctx.dynamicBodyEntities.pop_back();
        }
    }
    b2Body_SetGravityScale(it->second, gravityScale);
    b2Body_SetLinearDamping(it->second, linearDamping);
    b2Body_SetAngularDamping(it->second, angularDamping);
    b2Body_SetBullet(it->second, bullet != 0);

    b2MotionLocks locks = b2Body_GetMotionLocks(it->second);
    locks.angularZ = fixedRotation != 0;
    b2Body_SetMotionLocks(it->second, locks);
}

// Sleep / Wake

EMSCRIPTEN_KEEPALIVE
void physics_setAwake(uint32_t entityId, int awake) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_SetAwake(it->second, awake != 0);
}

EMSCRIPTEN_KEEPALIVE
int physics_isAwake(uint32_t entityId) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(it->second)) return 0;
    return b2Body_IsAwake(it->second) ? 1 : 0;
}

// Body Mass Queries

EMSCRIPTEN_KEEPALIVE
float physics_getBodyMass(uint32_t entityId) {
    auto body = findValidBody(entityId);
    if (B2_IS_NULL(body)) return 0;
    return b2Body_GetMass(body);
}

EMSCRIPTEN_KEEPALIVE
float physics_getBodyInertia(uint32_t entityId) {
    auto body = findValidBody(entityId);
    if (B2_IS_NULL(body)) return 0;
    return b2Body_GetRotationalInertia(body);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getBodyCenterOfMass(uint32_t entityId) {
    g_massDataBuffer[0] = 0;
    g_massDataBuffer[1] = 0;
    auto body = findValidBody(entityId);
    if (!B2_IS_NULL(body)) {
        b2Vec2 com = b2Body_GetLocalCenterOfMass(body);
        g_massDataBuffer[0] = com.x;
        g_massDataBuffer[1] = com.y;
    }
    return reinterpret_cast<uintptr_t>(g_massDataBuffer);
}

} // extern "C"
