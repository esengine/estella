/**
 * @file    PhysicsModuleEntry.cpp
 * @brief   Standalone Physics WASM module entry point
 *
 * Pure computation module (no GL/engine dependencies).
 * Handles: Box2D world management, body creation, stepping, transform extraction.
 */

#include <emscripten.h>
#include <emscripten/bind.h>

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

// =============================================================================
// Collision Event Structures
// =============================================================================

struct CollisionEventJS {
    uint32_t entityA;
    uint32_t entityB;
    float normalX;
    float normalY;
    float contactX;
    float contactY;
};

struct SensorEventJS {
    uint32_t sensorEntity;
    uint32_t visitorEntity;
};

struct CollisionEventsJS {
    std::vector<CollisionEventJS> enters;
    std::vector<CollisionEventJS> exits;
    std::vector<SensorEventJS> sensorEnters;
    std::vector<SensorEventJS> sensorExits;
};

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

// =============================================================================
// World Lifecycle
// =============================================================================

void physics_init(float gx, float gy, float timestep, int substeps) {
    if (b2World_IsValid(g_worldId)) return;

    b2WorldDef worldDef = b2DefaultWorldDef();
    worldDef.gravity = {gx, gy};
    g_worldId = b2CreateWorld(&worldDef);

    g_fixedTimestep = timestep;
    g_subStepCount = substeps;
    g_accumulator = 0.0f;
}

void physics_shutdown() {
    if (!b2World_IsValid(g_worldId)) return;

    g_entityToBody.clear();
    g_entityToShape.clear();
    g_dynamicTransformBuffer.clear();
    g_accumulator = 0.0f;

    b2DestroyWorld(g_worldId);
    g_worldId = b2_nullWorldId;
}

// =============================================================================
// Body Management
// =============================================================================

void physics_createBody(uint32_t entityId, int bodyType, float x, float y, float angle,
                        float gravityScale, float linearDamping, float angularDamping,
                        bool fixedRotation, bool bullet) {
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
    bodyDef.isBullet = bullet;
    bodyDef.motionLocks.angularZ = fixedRotation;

    b2BodyId bodyId = b2CreateBody(g_worldId, &bodyDef);
    b2Body_SetUserData(bodyId, reinterpret_cast<void*>(static_cast<uintptr_t>(entityId)));
    g_entityToBody[entityId] = bodyId;
}

void physics_destroyBody(uint32_t entityId) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    if (b2Body_IsValid(it->second)) {
        b2DestroyBody(it->second);
    }
    g_entityToBody.erase(it);
    g_entityToShape.erase(entityId);
}

bool physics_hasBody(uint32_t entityId) {
    return g_entityToBody.contains(entityId);
}

// =============================================================================
// Shape Management
// =============================================================================

void physics_addBoxShape(uint32_t entityId, float halfW, float halfH,
                         float offX, float offY,
                         float density, float friction, float restitution, bool isSensor) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor;

    b2Polygon polygon = b2MakeOffsetBox(halfW, halfH, {offX, offY}, b2MakeRot(0.0f));
    b2ShapeId shapeId = b2CreatePolygonShape(it->second, &shapeDef, &polygon);
    g_entityToShape[entityId] = shapeId;
}

void physics_addCircleShape(uint32_t entityId, float radius,
                            float offX, float offY,
                            float density, float friction, float restitution, bool isSensor) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor;

    b2Circle circle;
    circle.center = {offX, offY};
    circle.radius = radius;

    b2ShapeId shapeId = b2CreateCircleShape(it->second, &shapeDef, &circle);
    g_entityToShape[entityId] = shapeId;
}

void physics_addCapsuleShape(uint32_t entityId, float radius, float halfHeight,
                             float offX, float offY,
                             float density, float friction, float restitution, bool isSensor) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor;

    b2Capsule capsule;
    capsule.center1 = {offX, offY + halfHeight};
    capsule.center2 = {offX, offY - halfHeight};
    capsule.radius = radius;

    b2ShapeId shapeId = b2CreateCapsuleShape(it->second, &shapeDef, &capsule);
    g_entityToShape[entityId] = shapeId;
}

// =============================================================================
// Simulation
// =============================================================================

void physics_step(float dt) {
    if (!b2World_IsValid(g_worldId)) return;

    g_accumulator += dt;

    while (g_accumulator >= g_fixedTimestep) {
        b2World_Step(g_worldId, g_fixedTimestep, g_subStepCount);
        g_accumulator -= g_fixedTimestep;
    }
}

// =============================================================================
// Transform Sync
// =============================================================================

void physics_setBodyTransform(uint32_t entityId, float x, float y, float angle) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Body_SetTransform(it->second, {x, y}, b2MakeRot(angle));
}

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

uintptr_t physics_getDynamicBodyTransforms() {
    g_dynamicTransformBuffer.clear();

    for (auto& [entityId, bodyId] : g_entityToBody) {
        if (!b2Body_IsValid(bodyId)) continue;
        if (b2Body_GetType(bodyId) != b2_dynamicBody) continue;

        b2Vec2 pos = b2Body_GetPosition(bodyId);
        float angle = b2Rot_GetAngle(b2Body_GetRotation(bodyId));

        float entityBits;
        std::memcpy(&entityBits, &entityId, sizeof(float));

        g_dynamicTransformBuffer.push_back(entityBits);
        g_dynamicTransformBuffer.push_back(pos.x);
        g_dynamicTransformBuffer.push_back(pos.y);
        g_dynamicTransformBuffer.push_back(angle);
    }

    return reinterpret_cast<uintptr_t>(g_dynamicTransformBuffer.data());
}

// =============================================================================
// Collision Events
// =============================================================================

CollisionEventsJS physics_getCollisionEvents() {
    CollisionEventsJS result;
    if (!b2World_IsValid(g_worldId)) return result;

    b2ContactEvents contactEvents = b2World_GetContactEvents(g_worldId);

    for (int i = 0; i < contactEvents.beginCount; ++i) {
        auto& evt = contactEvents.beginEvents[i];
        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;

        result.enters.push_back({entityA, entityB, 0, 0, 0, 0});
    }

    for (int i = 0; i < contactEvents.endCount; ++i) {
        auto& evt = contactEvents.endEvents[i];
        if (!b2Shape_IsValid(evt.shapeIdA) || !b2Shape_IsValid(evt.shapeIdB)) continue;

        uint32_t entityA = entityFromShape(evt.shapeIdA);
        uint32_t entityB = entityFromShape(evt.shapeIdB);
        if (entityA == 0xFFFFFFFF || entityB == 0xFFFFFFFF) continue;

        result.exits.push_back({entityA, entityB, 0, 0, 0, 0});
    }

    b2SensorEvents sensorEvents = b2World_GetSensorEvents(g_worldId);

    for (int i = 0; i < sensorEvents.beginCount; ++i) {
        auto& evt = sensorEvents.beginEvents[i];
        uint32_t sensor = entityFromShape(evt.sensorShapeId);
        uint32_t visitor = entityFromShape(evt.visitorShapeId);
        if (sensor == 0xFFFFFFFF || visitor == 0xFFFFFFFF) continue;

        result.sensorEnters.push_back({sensor, visitor});
    }

    for (int i = 0; i < sensorEvents.endCount; ++i) {
        auto& evt = sensorEvents.endEvents[i];
        if (!b2Shape_IsValid(evt.sensorShapeId) || !b2Shape_IsValid(evt.visitorShapeId)) continue;

        uint32_t sensor = entityFromShape(evt.sensorShapeId);
        uint32_t visitor = entityFromShape(evt.visitorShapeId);
        if (sensor == 0xFFFFFFFF || visitor == 0xFFFFFFFF) continue;

        result.sensorExits.push_back({sensor, visitor});
    }

    return result;
}

// =============================================================================
// Force / Impulse / Velocity
// =============================================================================

void physics_applyForce(uint32_t entityId, float forceX, float forceY) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Vec2 center = b2Body_GetPosition(it->second);
    b2Body_ApplyForce(it->second, {forceX, forceY}, center, true);
}

void physics_applyImpulse(uint32_t entityId, float impulseX, float impulseY) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Vec2 center = b2Body_GetPosition(it->second);
    b2Body_ApplyLinearImpulse(it->second, {impulseX, impulseY}, center, true);
}

void physics_setLinearVelocity(uint32_t entityId, float vx, float vy) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return;
    if (!b2Body_IsValid(it->second)) return;

    b2Body_SetLinearVelocity(it->second, {vx, vy});
}

struct Vec2JS {
    float x;
    float y;
};

Vec2JS physics_getLinearVelocity(uint32_t entityId) {
    auto it = g_entityToBody.find(entityId);
    if (it == g_entityToBody.end()) return {0, 0};
    if (!b2Body_IsValid(it->second)) return {0, 0};

    b2Vec2 v = b2Body_GetLinearVelocity(it->second);
    return {v.x, v.y};
}

// =============================================================================
// Emscripten Bindings
// =============================================================================

EMSCRIPTEN_BINDINGS(physics_module) {
    emscripten::function("physics_init", &physics_init);
    emscripten::function("physics_shutdown", &physics_shutdown);

    emscripten::function("physics_createBody", &physics_createBody);
    emscripten::function("physics_destroyBody", &physics_destroyBody);
    emscripten::function("physics_hasBody", &physics_hasBody);

    emscripten::function("physics_addBoxShape", &physics_addBoxShape);
    emscripten::function("physics_addCircleShape", &physics_addCircleShape);
    emscripten::function("physics_addCapsuleShape", &physics_addCapsuleShape);

    emscripten::function("physics_step", &physics_step);

    emscripten::function("physics_setBodyTransform", &physics_setBodyTransform);
    emscripten::function("physics_getDynamicBodyCount", &physics_getDynamicBodyCount);
    emscripten::function("physics_getDynamicBodyTransforms", &physics_getDynamicBodyTransforms);

    emscripten::function("physics_applyForce", &physics_applyForce);
    emscripten::function("physics_applyImpulse", &physics_applyImpulse);
    emscripten::function("physics_setLinearVelocity", &physics_setLinearVelocity);
    emscripten::function("physics_getLinearVelocity", &physics_getLinearVelocity);

    emscripten::value_object<Vec2JS>("PhysicsVec2JS")
        .field("x", &Vec2JS::x)
        .field("y", &Vec2JS::y);

    emscripten::value_object<CollisionEventJS>("CollisionEventJS")
        .field("entityA", &CollisionEventJS::entityA)
        .field("entityB", &CollisionEventJS::entityB)
        .field("normalX", &CollisionEventJS::normalX)
        .field("normalY", &CollisionEventJS::normalY)
        .field("contactX", &CollisionEventJS::contactX)
        .field("contactY", &CollisionEventJS::contactY);

    emscripten::value_object<SensorEventJS>("SensorEventJS")
        .field("sensorEntity", &SensorEventJS::sensorEntity)
        .field("visitorEntity", &SensorEventJS::visitorEntity);

    emscripten::register_vector<CollisionEventJS>("CollisionEventJSVector");
    emscripten::register_vector<SensorEventJS>("SensorEventJSVector");

    emscripten::value_object<CollisionEventsJS>("CollisionEventsJS")
        .field("enters", &CollisionEventsJS::enters)
        .field("exits", &CollisionEventsJS::exits)
        .field("sensorEnters", &CollisionEventsJS::sensorEnters)
        .field("sensorExits", &CollisionEventsJS::sensorExits);

    emscripten::function("physics_getCollisionEvents", &physics_getCollisionEvents);
}
