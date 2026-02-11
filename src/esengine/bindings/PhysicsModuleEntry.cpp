/**
 * @file    PhysicsModuleEntry.cpp
 * @brief   Physics WASM module entry point (supports both standalone and SIDE_MODULE)
 *
 * Pure computation module (no GL/engine dependencies).
 * Handles: Box2D world management, body creation, stepping, transform extraction.
 *
 * All functions exported as extern "C" + EMSCRIPTEN_KEEPALIVE for SIDE_MODULE compatibility.
 */

#include <emscripten.h>

#include <box2d/box2d.h>

#include <unordered_map>
#include <vector>
#include <cstdint>
#include <cstring>

// =============================================================================
// Global State
// =============================================================================

static b2WorldId g_worldId = b2_nullWorldId;
static float g_fixedTimestep = 1.0f / 60.0f;
static int g_subStepCount = 4;
static float g_accumulator = 0.0f;

static std::unordered_map<uint32_t, b2BodyId> g_entityToBody;
static std::unordered_map<uint32_t, b2ShapeId> g_entityToShape;

// [entityId_bits, x, y, angle, ...]
static std::vector<float> g_dynamicTransformBuffer;

// Collision event flat buffers: [entityA0_bits, entityB0_bits, nx0, ny0, cx0, cy0, ...]
static std::vector<float> g_collisionEnterBuffer;
// [entityA0_bits, entityB0_bits, ...]
static std::vector<float> g_collisionExitBuffer;
// [sensor0_bits, visitor0_bits, ...]
static std::vector<float> g_sensorEnterBuffer;
static std::vector<float> g_sensorExitBuffer;

static float g_velocityBuffer[2];
static float g_gravityBuffer[2];

// =============================================================================
// Helper: Entity ID from body user data
// =============================================================================

static uint32_t entityFromBody(b2BodyId bodyId) {
    void* ud = b2Body_GetUserData(bodyId);
    if (!ud) return 0xFFFFFFFF;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ud));
}

static uint32_t entityFromShape(b2ShapeId shapeId) {
    b2BodyId bodyId = b2Shape_GetBody(shapeId);
    return entityFromBody(bodyId);
}

static void pushEntityBits(std::vector<float>& buf, uint32_t entityId) {
    float bits;
    std::memcpy(&bits, &entityId, sizeof(float));
    buf.push_back(bits);
}

// =============================================================================
// Exported Functions
// =============================================================================

extern "C" {

// World Lifecycle

EMSCRIPTEN_KEEPALIVE
void physics_init(float gx, float gy, float timestep, int substeps) {
    if (b2World_IsValid(g_worldId)) return;

    b2WorldDef worldDef = b2DefaultWorldDef();
    worldDef.gravity = {gx, gy};
    g_worldId = b2CreateWorld(&worldDef);

    g_fixedTimestep = timestep;
    g_subStepCount = substeps;
    g_accumulator = 0.0f;
}

EMSCRIPTEN_KEEPALIVE
void physics_shutdown() {
    if (!b2World_IsValid(g_worldId)) return;

    g_entityToBody.clear();
    g_entityToShape.clear();
    g_dynamicTransformBuffer.clear();
    g_collisionEnterBuffer.clear();
    g_collisionExitBuffer.clear();
    g_sensorEnterBuffer.clear();
    g_sensorExitBuffer.clear();
    g_accumulator = 0.0f;

    b2DestroyWorld(g_worldId);
    g_worldId = b2_nullWorldId;
}

// Body Management

EMSCRIPTEN_KEEPALIVE
void physics_createBody(uint32_t entityId, int bodyType, float x, float y, float angle,
                        float gravityScale, float linearDamping, float angularDamping,
                        int fixedRotation, int bullet) {
    if (!b2World_IsValid(g_worldId)) return;
    if (g_entityToBody.contains(entityId)) return;

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

    b2BodyId bodyId = b2CreateBody(g_worldId, &bodyDef);
    b2Body_SetUserData(bodyId, reinterpret_cast<void*>(static_cast<uintptr_t>(entityId)));
    g_entityToBody[entityId] = bodyId;
}

EMSCRIPTEN_KEEPALIVE
void physics_destroyBody(uint32_t entityId) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    if (b2Body_IsValid(it->second)) {
        b2DestroyBody(it->second);
    }
    g_entityToBody.erase(it);
    g_entityToShape.erase(entityId);
}

EMSCRIPTEN_KEEPALIVE
int physics_hasBody(uint32_t entityId) {
    return g_entityToBody.contains(entityId) ? 1 : 0;
}

// Shape Management

EMSCRIPTEN_KEEPALIVE
void physics_addBoxShape(uint32_t entityId, float halfW, float halfH,
                         float offX, float offY,
                         float density, float friction, float restitution, int isSensor) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;

    b2Polygon polygon = b2MakeOffsetBox(halfW, halfH, {offX, offY}, b2MakeRot(0.0f));
    b2ShapeId shapeId = b2CreatePolygonShape(it->second, &shapeDef, &polygon);
    g_entityToShape[entityId] = shapeId;
}

EMSCRIPTEN_KEEPALIVE
void physics_addCircleShape(uint32_t entityId, float radius,
                            float offX, float offY,
                            float density, float friction, float restitution, int isSensor) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;

    b2Circle circle;
    circle.center = {offX, offY};
    circle.radius = radius;

    b2ShapeId shapeId = b2CreateCircleShape(it->second, &shapeDef, &circle);
    g_entityToShape[entityId] = shapeId;
}

EMSCRIPTEN_KEEPALIVE
void physics_addCapsuleShape(uint32_t entityId, float radius, float halfHeight,
                             float offX, float offY,
                             float density, float friction, float restitution, int isSensor) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;

    b2Capsule capsule;
    capsule.center1 = {offX, offY + halfHeight};
    capsule.center2 = {offX, offY - halfHeight};
    capsule.radius = radius;

    b2ShapeId shapeId = b2CreateCapsuleShape(it->second, &shapeDef, &capsule);
    g_entityToShape[entityId] = shapeId;
}

// Simulation

EMSCRIPTEN_KEEPALIVE
void physics_step(float dt) {
    if (!b2World_IsValid(g_worldId)) return;

    g_accumulator += dt;

    while (g_accumulator >= g_fixedTimestep) {
        b2World_Step(g_worldId, g_fixedTimestep, g_subStepCount);
        g_accumulator -= g_fixedTimestep;
    }
}

// Transform Sync

EMSCRIPTEN_KEEPALIVE
void physics_setBodyTransform(uint32_t entityId, float x, float y, float angle) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Body_SetTransform(it->second, {x, y}, b2MakeRot(angle));
}

EMSCRIPTEN_KEEPALIVE
int physics_getDynamicBodyCount() {
    int count = 0;
    for (auto& [entityId, bodyId] : g_entityToBody) {
        if (!b2Body_IsValid(bodyId)) continue;
        if (b2Body_GetType(bodyId) == b2_dynamicBody) {
            ++count;
        }
    }
    return count;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getDynamicBodyTransforms() {
    g_dynamicTransformBuffer.clear();

    for (auto& [entityId, bodyId] : g_entityToBody) {
        if (!b2Body_IsValid(bodyId)) continue;
        if (b2Body_GetType(bodyId) != b2_dynamicBody) continue;

        b2Vec2 pos = b2Body_GetPosition(bodyId);
        float angle = b2Rot_GetAngle(b2Body_GetRotation(bodyId));

        pushEntityBits(g_dynamicTransformBuffer, entityId);
        g_dynamicTransformBuffer.push_back(pos.x);
        g_dynamicTransformBuffer.push_back(pos.y);
        g_dynamicTransformBuffer.push_back(angle);
    }

    return reinterpret_cast<uintptr_t>(g_dynamicTransformBuffer.data());
}

// Collision Events (flat buffer)

EMSCRIPTEN_KEEPALIVE
void physics_collectEvents() {
    g_collisionEnterBuffer.clear();
    g_collisionExitBuffer.clear();
    g_sensorEnterBuffer.clear();
    g_sensorExitBuffer.clear();

    if (!b2World_IsValid(g_worldId)) return;

    b2ContactEvents contactEvents = b2World_GetContactEvents(g_worldId);

    for (int i = 0; i < contactEvents.beginCount; ++i) {
        auto& evt = contactEvents.beginEvents[i];
        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;

        pushEntityBits(g_collisionEnterBuffer, entityA);
        pushEntityBits(g_collisionEnterBuffer, entityB);

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
        g_collisionEnterBuffer.push_back(nx);
        g_collisionEnterBuffer.push_back(ny);
        g_collisionEnterBuffer.push_back(cx);
        g_collisionEnterBuffer.push_back(cy);
    }

    for (int i = 0; i < contactEvents.endCount; ++i) {
        auto& evt = contactEvents.endEvents[i];
        if (!b2Shape_IsValid(evt.shapeIdA) || !b2Shape_IsValid(evt.shapeIdB)) continue;

        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;

        pushEntityBits(g_collisionExitBuffer, entityA);
        pushEntityBits(g_collisionExitBuffer, entityB);
    }

    b2SensorEvents sensorEvents = b2World_GetSensorEvents(g_worldId);

    for (int i = 0; i < sensorEvents.beginCount; ++i) {
        auto& evt = sensorEvents.beginEvents[i];
        uint32_t sensor = entityFromShape(evt.sensorShapeId);
        uint32_t visitor = entityFromShape(evt.visitorShapeId);
        if (sensor == 0xFFFFFFFF || visitor == 0xFFFFFFFF) continue;

        pushEntityBits(g_sensorEnterBuffer, sensor);
        pushEntityBits(g_sensorEnterBuffer, visitor);
    }

    for (int i = 0; i < sensorEvents.endCount; ++i) {
        auto& evt = sensorEvents.endEvents[i];
        if (!b2Shape_IsValid(evt.sensorShapeId) || !b2Shape_IsValid(evt.visitorShapeId)) continue;

        uint32_t sensor = entityFromShape(evt.sensorShapeId);
        uint32_t visitor = entityFromShape(evt.visitorShapeId);
        if (sensor == 0xFFFFFFFF || visitor == 0xFFFFFFFF) continue;

        pushEntityBits(g_sensorExitBuffer, sensor);
        pushEntityBits(g_sensorExitBuffer, visitor);
    }
}

EMSCRIPTEN_KEEPALIVE
int physics_getCollisionEnterCount() {
    return static_cast<int>(g_collisionEnterBuffer.size() / 6);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getCollisionEnterBuffer() {
    return reinterpret_cast<uintptr_t>(g_collisionEnterBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getCollisionExitCount() {
    return static_cast<int>(g_collisionExitBuffer.size() / 2);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getCollisionExitBuffer() {
    return reinterpret_cast<uintptr_t>(g_collisionExitBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getSensorEnterCount() {
    return static_cast<int>(g_sensorEnterBuffer.size() / 2);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getSensorEnterBuffer() {
    return reinterpret_cast<uintptr_t>(g_sensorEnterBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_getSensorExitCount() {
    return static_cast<int>(g_sensorExitBuffer.size() / 2);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getSensorExitBuffer() {
    return reinterpret_cast<uintptr_t>(g_sensorExitBuffer.data());
}

// Force / Impulse / Velocity

EMSCRIPTEN_KEEPALIVE
void physics_applyForce(uint32_t entityId, float forceX, float forceY) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Vec2 center = b2Body_GetPosition(it->second);
    b2Body_ApplyForce(it->second, {forceX, forceY}, center, true);
}

EMSCRIPTEN_KEEPALIVE
void physics_applyImpulse(uint32_t entityId, float impulseX, float impulseY) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Vec2 center = b2Body_GetPosition(it->second);
    b2Body_ApplyLinearImpulse(it->second, {impulseX, impulseY}, center, true);
}

EMSCRIPTEN_KEEPALIVE
void physics_setLinearVelocity(uint32_t entityId, float vx, float vy) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Body_SetLinearVelocity(it->second, {vx, vy});
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getLinearVelocity(uint32_t entityId) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) {
        g_velocityBuffer[0] = 0;
        g_velocityBuffer[1] = 0;
        return reinterpret_cast<uintptr_t>(g_velocityBuffer);
    }
    if (!b2Body_IsValid(it->second)) {
        g_velocityBuffer[0] = 0;
        g_velocityBuffer[1] = 0;
        return reinterpret_cast<uintptr_t>(g_velocityBuffer);
    }

    b2Vec2 v = b2Body_GetLinearVelocity(it->second);
    g_velocityBuffer[0] = v.x;
    g_velocityBuffer[1] = v.y;
    return reinterpret_cast<uintptr_t>(g_velocityBuffer);
}

// Gravity

EMSCRIPTEN_KEEPALIVE
void physics_setGravity(float gx, float gy) {
    if (!b2World_IsValid(g_worldId)) return;
    b2World_SetGravity(g_worldId, {gx, gy});
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getGravity() {
    if (!b2World_IsValid(g_worldId)) {
        g_gravityBuffer[0] = 0;
        g_gravityBuffer[1] = 0;
        return reinterpret_cast<uintptr_t>(g_gravityBuffer);
    }
    b2Vec2 g = b2World_GetGravity(g_worldId);
    g_gravityBuffer[0] = g.x;
    g_gravityBuffer[1] = g.y;
    return reinterpret_cast<uintptr_t>(g_gravityBuffer);
}

// Angular Velocity / Torque

EMSCRIPTEN_KEEPALIVE
void physics_setAngularVelocity(uint32_t entityId, float omega) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_SetAngularVelocity(it->second, omega);
}

EMSCRIPTEN_KEEPALIVE
float physics_getAngularVelocity(uint32_t entityId) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return 0;
    if (!b2Body_IsValid(it->second)) return 0;
    return b2Body_GetAngularVelocity(it->second);
}

EMSCRIPTEN_KEEPALIVE
void physics_applyTorque(uint32_t entityId, float torque) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_ApplyTorque(it->second, torque, true);
}

EMSCRIPTEN_KEEPALIVE
void physics_applyAngularImpulse(uint32_t entityId, float impulse) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;
    b2Body_ApplyAngularImpulse(it->second, impulse, true);
}

// Runtime Body Property Update

EMSCRIPTEN_KEEPALIVE
void physics_updateBodyProperties(uint32_t entityId, int bodyType,
                                  float gravityScale, float linearDamping, float angularDamping,
                                  int fixedRotation, int bullet) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2BodyType type;
    switch (bodyType) {
        case 0: type = b2_staticBody; break;
        case 1: type = b2_kinematicBody; break;
        default: type = b2_dynamicBody; break;
    }
    b2Body_SetType(it->second, type);
    b2Body_SetGravityScale(it->second, gravityScale);
    b2Body_SetLinearDamping(it->second, linearDamping);
    b2Body_SetAngularDamping(it->second, angularDamping);
    b2Body_SetBullet(it->second, bullet != 0);

    b2MotionLocks locks = b2Body_GetMotionLocks(it->second);
    locks.angularZ = fixedRotation != 0;
    b2Body_SetMotionLocks(it->second, locks);
}

} // extern "C"
