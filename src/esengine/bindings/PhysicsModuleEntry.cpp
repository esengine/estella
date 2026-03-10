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
#include <algorithm>
#include <cstdint>
#include <cstring>

// =============================================================================
// Physics Context
// =============================================================================

static constexpr int MAX_PHYSICS_STEPS_PER_FRAME = 8;

struct PhysicsContext {
    b2WorldId worldId = b2_nullWorldId;
    float fixedTimestep = 1.0f / 60.0f;
    int subStepCount = 4;
    float accumulator = 0.0f;

    std::unordered_map<uint32_t, b2BodyId> entityToBody;
    std::unordered_map<uint32_t, std::vector<b2ShapeId>> entityToShapes;
    std::unordered_map<uint32_t, b2JointId> entityToJoint;
    std::vector<uint32_t> dynamicBodyEntities;

    std::vector<float> dynamicTransformBuffer;

    std::vector<float> collisionEnterBuffer;
    std::vector<float> collisionExitBuffer;
    std::vector<float> sensorEnterBuffer;
    std::vector<float> sensorExitBuffer;

    float velocityBuffer[2] = {};
    float gravityBuffer[2] = {};

    void reset() {
        entityToBody.clear();
        entityToShapes.clear();
        entityToJoint.clear();
        dynamicBodyEntities.clear();
        dynamicTransformBuffer.clear();
        collisionEnterBuffer.clear();
        collisionExitBuffer.clear();
        sensorEnterBuffer.clear();
        sensorExitBuffer.clear();
        accumulator = 0.0f;

        if (b2World_IsValid(worldId)) {
            b2DestroyWorld(worldId);
        }
        worldId = b2_nullWorldId;
    }
};

static PhysicsContext g_ctx;

static std::vector<float> g_raycastBuffer;
static constexpr int RAYCAST_STRIDE = 6;
static constexpr int MAX_RAYCAST_HITS = 64;

static std::vector<float> g_overlapBuffer;
static constexpr int MAX_OVERLAP_HITS = 64;

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
void physics_init(float gx, float gy, float timestep, int substeps,
                  float contactHertz, float contactDampingRatio, float contactSpeed) {
    if (b2World_IsValid(g_ctx.worldId)) return;

    b2WorldDef worldDef = b2DefaultWorldDef();
    worldDef.gravity = {gx, gy};
    worldDef.contactHertz = contactHertz;
    worldDef.contactDampingRatio = contactDampingRatio;
    worldDef.contactSpeed = contactSpeed;
    g_ctx.worldId = b2CreateWorld(&worldDef);

    g_ctx.fixedTimestep = timestep;
    g_ctx.subStepCount = substeps;
    g_ctx.accumulator = 0.0f;
}

EMSCRIPTEN_KEEPALIVE
void physics_shutdown() {
    g_ctx.reset();
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

// Shape Management

EMSCRIPTEN_KEEPALIVE
void physics_addBoxShape(uint32_t entityId, float halfW, float halfH,
                         float offX, float offY, float radius,
                         float density, float friction, float restitution, int isSensor,
                         uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Polygon polygon;
    if (radius > 0.0f) {
        float innerHalfW = halfW > radius ? halfW - radius : 0.0f;
        float innerHalfH = halfH > radius ? halfH - radius : 0.0f;
        polygon = b2MakeOffsetRoundedBox(innerHalfW, innerHalfH, {offX, offY}, b2MakeRot(0.0f), radius);
    } else {
        polygon = b2MakeOffsetBox(halfW, halfH, {offX, offY}, b2MakeRot(0.0f));
    }
    b2ShapeId shapeId = b2CreatePolygonShape(it->second, &shapeDef, &polygon);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addCircleShape(uint32_t entityId, float radius,
                            float offX, float offY,
                            float density, float friction, float restitution, int isSensor,
                            uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Circle circle;
    circle.center = {offX, offY};
    circle.radius = radius;

    b2ShapeId shapeId = b2CreateCircleShape(it->second, &shapeDef, &circle);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addCapsuleShape(uint32_t entityId, float radius, float halfHeight,
                             float offX, float offY,
                             float density, float friction, float restitution, int isSensor,
                             uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Capsule capsule;
    capsule.center1 = {offX, offY + halfHeight};
    capsule.center2 = {offX, offY - halfHeight};
    capsule.radius = radius;

    b2ShapeId shapeId = b2CreateCapsuleShape(it->second, &shapeDef, &capsule);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addSegmentShape(uint32_t entityId, float x1, float y1, float x2, float y2,
                             float density, float friction, float restitution, int isSensor,
                             uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Segment segment;
    segment.point1 = {x1, y1};
    segment.point2 = {x2, y2};

    b2ShapeId shapeId = b2CreateSegmentShape(it->second, &shapeDef, &segment);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addPolygonShape(uint32_t entityId, uintptr_t verticesPtr, int vertexCount, float radius,
                             float density, float friction, float restitution, int isSensor,
                             uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (vertexCount < 3 || vertexCount > B2_MAX_POLYGON_VERTICES) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableSensorEvents = isSensor != 0;
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    auto* floats = reinterpret_cast<float*>(verticesPtr);
    b2Vec2 points[B2_MAX_POLYGON_VERTICES];
    for (int i = 0; i < vertexCount; i++) {
        points[i] = {floats[i * 2], floats[i * 2 + 1]};
    }

    b2Hull hull = b2ComputeHull(points, vertexCount);
    if (hull.count == 0) return;

    b2Polygon polygon = (radius > 0.0f)
        ? b2MakePolygon(&hull, radius)
        : b2MakePolygon(&hull, 0.0f);
    b2ShapeId shapeId = b2CreatePolygonShape(it->second, &shapeDef, &polygon);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addChainShape(uint32_t entityId, uintptr_t pointsPtr, int pointCount, int isLoop,
                           float friction, float restitution,
                           uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (pointCount < 4) return;

    auto* floats = reinterpret_cast<float*>(pointsPtr);
    std::vector<b2Vec2> points(pointCount);
    for (int i = 0; i < pointCount; i++) {
        points[i] = {floats[i * 2], floats[i * 2 + 1]};
    }

    b2SurfaceMaterial material = b2DefaultSurfaceMaterial();
    material.friction = friction;
    material.restitution = restitution;

    b2ChainDef chainDef = b2DefaultChainDef();
    chainDef.points = points.data();
    chainDef.count = pointCount;
    chainDef.isLoop = isLoop != 0;
    chainDef.materials = &material;
    chainDef.materialCount = 1;
    chainDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    chainDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2CreateChain(it->second, &chainDef);
}

// Simulation

EMSCRIPTEN_KEEPALIVE
void physics_step(float dt) {
    if (!b2World_IsValid(g_ctx.worldId)) return;

    g_ctx.collisionEnterBuffer.clear();
    g_ctx.collisionExitBuffer.clear();
    g_ctx.sensorEnterBuffer.clear();
    g_ctx.sensorExitBuffer.clear();

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

        b2Vec2 pos = b2Body_GetPosition(it->second);
        float angle = b2Rot_GetAngle(b2Body_GetRotation(it->second));

        pushEntityBits(g_ctx.dynamicTransformBuffer, entityId);
        g_ctx.dynamicTransformBuffer.push_back(pos.x);
        g_ctx.dynamicTransformBuffer.push_back(pos.y);
        g_ctx.dynamicTransformBuffer.push_back(angle);
    }

    return reinterpret_cast<uintptr_t>(g_ctx.dynamicTransformBuffer.data());
}

// Collision Events (flat buffer)

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

// Revolute Joint

EMSCRIPTEN_KEEPALIVE
int physics_createRevoluteJoint(uint32_t entityIdA, uint32_t entityIdB,
                                float anchorAx, float anchorAy,
                                float anchorBx, float anchorBy,
                                int enableMotor, float motorSpeed, float maxMotorTorque,
                                int enableLimit, float lowerAngle, float upperAngle,
                                int collideConnected) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto itA = g_ctx.entityToBody.find(entityIdA);
    auto itB = g_ctx.entityToBody.find(entityIdB);
    if (itA == g_ctx.entityToBody.end() || itB == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(itA->second) || !b2Body_IsValid(itB->second)) return 0;

    b2RevoluteJointDef jointDef = b2DefaultRevoluteJointDef();
    jointDef.base.bodyIdA = itA->second;
    jointDef.base.bodyIdB = itB->second;
    jointDef.base.localFrameA.p = {anchorAx, anchorAy};
    jointDef.base.localFrameB.p = {anchorBx, anchorBy};
    jointDef.enableMotor = enableMotor != 0;
    jointDef.motorSpeed = motorSpeed;
    jointDef.maxMotorTorque = maxMotorTorque;
    jointDef.enableLimit = enableLimit != 0;
    jointDef.lowerAngle = lowerAngle;
    jointDef.upperAngle = upperAngle;
    jointDef.base.collideConnected = collideConnected != 0;

    b2JointId jointId = b2CreateRevoluteJoint(g_ctx.worldId, &jointDef);
    g_ctx.entityToJoint[entityIdB] = jointId;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void physics_destroyJoint(uint32_t entityId) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return;

    if (b2Joint_IsValid(it->second)) {
        b2DestroyJoint(it->second, true);
    }
    g_ctx.entityToJoint.erase(it);
}

EMSCRIPTEN_KEEPALIVE
void physics_setRevoluteMotorSpeed(uint32_t entityId, float speed) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return;
    if (!b2Joint_IsValid(it->second)) return;
    b2RevoluteJoint_SetMotorSpeed(it->second, speed);
}

EMSCRIPTEN_KEEPALIVE
void physics_setRevoluteMaxMotorTorque(uint32_t entityId, float torque) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return;
    if (!b2Joint_IsValid(it->second)) return;
    b2RevoluteJoint_SetMaxMotorTorque(it->second, torque);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableRevoluteMotor(uint32_t entityId, int enable) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return;
    if (!b2Joint_IsValid(it->second)) return;
    b2RevoluteJoint_EnableMotor(it->second, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableRevoluteLimit(uint32_t entityId, int enable) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return;
    if (!b2Joint_IsValid(it->second)) return;
    b2RevoluteJoint_EnableLimit(it->second, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setRevoluteLimits(uint32_t entityId, float lower, float upper) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return;
    if (!b2Joint_IsValid(it->second)) return;
    b2RevoluteJoint_SetLimits(it->second, lower, upper);
}

EMSCRIPTEN_KEEPALIVE
float physics_getRevoluteAngle(uint32_t entityId) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return 0;
    if (!b2Joint_IsValid(it->second)) return 0;
    return b2RevoluteJoint_GetAngle(it->second);
}

EMSCRIPTEN_KEEPALIVE
float physics_getRevoluteMotorTorque(uint32_t entityId) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return 0;
    if (!b2Joint_IsValid(it->second)) return 0;
    return b2RevoluteJoint_GetMotorTorque(it->second);
}

EMSCRIPTEN_KEEPALIVE
int physics_hasJoint(uint32_t entityId) {
    return g_ctx.entityToJoint.contains(entityId) ? 1 : 0;
}

// Distance Joint

EMSCRIPTEN_KEEPALIVE
int physics_createDistanceJoint(uint32_t entityIdA, uint32_t entityIdB,
                                float anchorAx, float anchorAy,
                                float anchorBx, float anchorBy,
                                float length, int enableSpring, float hertz, float dampingRatio,
                                int enableLimit, float minLength, float maxLength,
                                int enableMotor, float maxMotorForce, float motorSpeed,
                                int collideConnected) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto itA = g_ctx.entityToBody.find(entityIdA);
    auto itB = g_ctx.entityToBody.find(entityIdB);
    if (itA == g_ctx.entityToBody.end() || itB == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(itA->second) || !b2Body_IsValid(itB->second)) return 0;

    b2DistanceJointDef jointDef = b2DefaultDistanceJointDef();
    jointDef.base.bodyIdA = itA->second;
    jointDef.base.bodyIdB = itB->second;
    jointDef.base.localFrameA.p = {anchorAx, anchorAy};
    jointDef.base.localFrameB.p = {anchorBx, anchorBy};
    jointDef.length = length;
    jointDef.enableSpring = enableSpring != 0;
    jointDef.hertz = hertz;
    jointDef.dampingRatio = dampingRatio;
    jointDef.enableLimit = enableLimit != 0;
    jointDef.minLength = minLength;
    jointDef.maxLength = maxLength;
    jointDef.enableMotor = enableMotor != 0;
    jointDef.maxMotorForce = maxMotorForce;
    jointDef.motorSpeed = motorSpeed;
    jointDef.base.collideConnected = collideConnected != 0;

    b2JointId jointId = b2CreateDistanceJoint(g_ctx.worldId, &jointDef);
    g_ctx.entityToJoint[entityIdB] = jointId;
    return 1;
}

// Prismatic Joint

EMSCRIPTEN_KEEPALIVE
int physics_createPrismaticJoint(uint32_t entityIdA, uint32_t entityIdB,
                                 float anchorAx, float anchorAy,
                                 float anchorBx, float anchorBy,
                                 float axisX, float axisY,
                                 int enableSpring, float hertz, float dampingRatio,
                                 int enableLimit, float lowerTranslation, float upperTranslation,
                                 int enableMotor, float maxMotorForce, float motorSpeed,
                                 int collideConnected) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto itA = g_ctx.entityToBody.find(entityIdA);
    auto itB = g_ctx.entityToBody.find(entityIdB);
    if (itA == g_ctx.entityToBody.end() || itB == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(itA->second) || !b2Body_IsValid(itB->second)) return 0;

    b2PrismaticJointDef jointDef = b2DefaultPrismaticJointDef();
    jointDef.base.bodyIdA = itA->second;
    jointDef.base.bodyIdB = itB->second;
    jointDef.base.localFrameA.p = {anchorAx, anchorAy};
    jointDef.base.localFrameB.p = {anchorBx, anchorBy};

    float len = sqrtf(axisX * axisX + axisY * axisY);
    if (len > 0.0f) {
        float nx = axisX / len;
        float ny = axisY / len;
        jointDef.base.localFrameA.q = {nx, ny};
    }

    jointDef.enableSpring = enableSpring != 0;
    jointDef.hertz = hertz;
    jointDef.dampingRatio = dampingRatio;
    jointDef.enableLimit = enableLimit != 0;
    jointDef.lowerTranslation = lowerTranslation;
    jointDef.upperTranslation = upperTranslation;
    jointDef.enableMotor = enableMotor != 0;
    jointDef.maxMotorForce = maxMotorForce;
    jointDef.motorSpeed = motorSpeed;
    jointDef.base.collideConnected = collideConnected != 0;

    b2JointId jointId = b2CreatePrismaticJoint(g_ctx.worldId, &jointDef);
    g_ctx.entityToJoint[entityIdB] = jointId;
    return 1;
}

// Weld Joint

EMSCRIPTEN_KEEPALIVE
int physics_createWeldJoint(uint32_t entityIdA, uint32_t entityIdB,
                            float anchorAx, float anchorAy,
                            float anchorBx, float anchorBy,
                            float linearHertz, float angularHertz,
                            float linearDampingRatio, float angularDampingRatio,
                            int collideConnected) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto itA = g_ctx.entityToBody.find(entityIdA);
    auto itB = g_ctx.entityToBody.find(entityIdB);
    if (itA == g_ctx.entityToBody.end() || itB == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(itA->second) || !b2Body_IsValid(itB->second)) return 0;

    b2WeldJointDef jointDef = b2DefaultWeldJointDef();
    jointDef.base.bodyIdA = itA->second;
    jointDef.base.bodyIdB = itB->second;
    jointDef.base.localFrameA.p = {anchorAx, anchorAy};
    jointDef.base.localFrameB.p = {anchorBx, anchorBy};
    jointDef.linearHertz = linearHertz;
    jointDef.angularHertz = angularHertz;
    jointDef.linearDampingRatio = linearDampingRatio;
    jointDef.angularDampingRatio = angularDampingRatio;
    jointDef.base.collideConnected = collideConnected != 0;

    b2JointId jointId = b2CreateWeldJoint(g_ctx.worldId, &jointDef);
    g_ctx.entityToJoint[entityIdB] = jointId;
    return 1;
}

// Wheel Joint

EMSCRIPTEN_KEEPALIVE
int physics_createWheelJoint(uint32_t entityIdA, uint32_t entityIdB,
                             float anchorAx, float anchorAy,
                             float anchorBx, float anchorBy,
                             float axisX, float axisY,
                             int enableSpring, float hertz, float dampingRatio,
                             int enableLimit, float lowerTranslation, float upperTranslation,
                             int enableMotor, float maxMotorTorque, float motorSpeed,
                             int collideConnected) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto itA = g_ctx.entityToBody.find(entityIdA);
    auto itB = g_ctx.entityToBody.find(entityIdB);
    if (itA == g_ctx.entityToBody.end() || itB == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(itA->second) || !b2Body_IsValid(itB->second)) return 0;

    b2WheelJointDef jointDef = b2DefaultWheelJointDef();
    jointDef.base.bodyIdA = itA->second;
    jointDef.base.bodyIdB = itB->second;
    jointDef.base.localFrameA.p = {anchorAx, anchorAy};
    jointDef.base.localFrameB.p = {anchorBx, anchorBy};

    float len = sqrtf(axisX * axisX + axisY * axisY);
    if (len > 0.0f) {
        float nx = axisX / len;
        float ny = axisY / len;
        jointDef.base.localFrameA.q = {nx, ny};
    }

    jointDef.enableSpring = enableSpring != 0;
    jointDef.hertz = hertz;
    jointDef.dampingRatio = dampingRatio;
    jointDef.enableLimit = enableLimit != 0;
    jointDef.lowerTranslation = lowerTranslation;
    jointDef.upperTranslation = upperTranslation;
    jointDef.enableMotor = enableMotor != 0;
    jointDef.maxMotorTorque = maxMotorTorque;
    jointDef.motorSpeed = motorSpeed;
    jointDef.base.collideConnected = collideConnected != 0;

    b2JointId jointId = b2CreateWheelJoint(g_ctx.worldId, &jointDef);
    g_ctx.entityToJoint[entityIdB] = jointId;
    return 1;
}

// Raycasting

static float raycastCallback(b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal, float fraction, void* context) {
    if (g_raycastBuffer.size() / RAYCAST_STRIDE >= MAX_RAYCAST_HITS) return 0.0f;

    uint32_t entityId = entityFromShape(shapeId);
    if (entityId == 0xFFFFFFFF) return 1.0f;

    pushEntityBits(g_raycastBuffer, entityId);
    g_raycastBuffer.push_back(point.x);
    g_raycastBuffer.push_back(point.y);
    g_raycastBuffer.push_back(normal.x);
    g_raycastBuffer.push_back(normal.y);
    g_raycastBuffer.push_back(fraction);

    return 1.0f;
}

EMSCRIPTEN_KEEPALIVE
int physics_raycast(float originX, float originY, float dirX, float dirY,
                    float maxDistance, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_raycastBuffer.clear();

    b2Vec2 origin = {originX, originY};
    b2Vec2 translation = {dirX * maxDistance, dirY * maxDistance};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_CastRay(g_ctx.worldId, origin, translation, filter, raycastCallback, nullptr);

    return static_cast<int>(g_raycastBuffer.size() / RAYCAST_STRIDE);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getRaycastBuffer() {
    return reinterpret_cast<uintptr_t>(g_raycastBuffer.data());
}

// Overlap Query

static bool overlapCallback(b2ShapeId shapeId, void* context) {
    if (g_overlapBuffer.size() >= MAX_OVERLAP_HITS) return false;

    uint32_t entityId = entityFromShape(shapeId);
    if (entityId == 0xFFFFFFFF) return true;

    pushEntityBits(g_overlapBuffer, entityId);
    return true;
}

EMSCRIPTEN_KEEPALIVE
int physics_overlapCircle(float centerX, float centerY, float radius, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_overlapBuffer.clear();

    b2Vec2 center = {centerX, centerY};
    b2ShapeProxy proxy = b2MakeProxy(&center, 1, radius);

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_OverlapShape(g_ctx.worldId, &proxy, filter, overlapCallback, nullptr);

    return static_cast<int>(g_overlapBuffer.size());
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getOverlapBuffer() {
    return reinterpret_cast<uintptr_t>(g_overlapBuffer.data());
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

} // extern "C"
