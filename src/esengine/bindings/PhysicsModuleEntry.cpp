#include "PhysicsContext.hpp"

#include <algorithm>

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
