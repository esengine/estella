// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./PhysicsContext.hpp"

#include <cmath>

extern "C" {

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

EMSCRIPTEN_KEEPALIVE
float physics_getDistanceJointLength(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2DistanceJoint_GetLength(jid);
}

EMSCRIPTEN_KEEPALIVE
float physics_getDistanceJointCurrentLength(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2DistanceJoint_GetCurrentLength(jid);
}

EMSCRIPTEN_KEEPALIVE
void physics_setDistanceJointLength(uint32_t entityId, float length) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_SetLength(jid, length);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableDistanceJointSpring(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_EnableSpring(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableDistanceJointLimit(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_EnableLimit(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setDistanceJointLimits(uint32_t entityId, float minLength, float maxLength) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_SetLengthRange(jid, minLength, maxLength);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableDistanceJointMotor(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_EnableMotor(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setDistanceJointMotorSpeed(uint32_t entityId, float speed) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_SetMotorSpeed(jid, speed);
}

EMSCRIPTEN_KEEPALIVE
void physics_setDistanceJointMaxMotorForce(uint32_t entityId, float force) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2DistanceJoint_SetMaxMotorForce(jid, force);
}

EMSCRIPTEN_KEEPALIVE
float physics_getDistanceJointMotorForce(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2DistanceJoint_GetMotorForce(jid);
}

EMSCRIPTEN_KEEPALIVE
float physics_getPrismaticJointTranslation(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2PrismaticJoint_GetTranslation(jid);
}

EMSCRIPTEN_KEEPALIVE
float physics_getPrismaticJointSpeed(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2PrismaticJoint_GetSpeed(jid);
}

EMSCRIPTEN_KEEPALIVE
void physics_enablePrismaticJointSpring(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2PrismaticJoint_EnableSpring(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_enablePrismaticJointLimit(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2PrismaticJoint_EnableLimit(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setPrismaticJointLimits(uint32_t entityId, float lower, float upper) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2PrismaticJoint_SetLimits(jid, lower, upper);
}

EMSCRIPTEN_KEEPALIVE
void physics_enablePrismaticJointMotor(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2PrismaticJoint_EnableMotor(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setPrismaticJointMotorSpeed(uint32_t entityId, float speed) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2PrismaticJoint_SetMotorSpeed(jid, speed);
}

EMSCRIPTEN_KEEPALIVE
void physics_setPrismaticJointMaxMotorForce(uint32_t entityId, float force) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2PrismaticJoint_SetMaxMotorForce(jid, force);
}

EMSCRIPTEN_KEEPALIVE
float physics_getPrismaticJointMotorForce(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2PrismaticJoint_GetMotorForce(jid);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableWheelJointSpring(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2WheelJoint_EnableSpring(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableWheelJointLimit(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2WheelJoint_EnableLimit(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setWheelJointLimits(uint32_t entityId, float lower, float upper) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2WheelJoint_SetLimits(jid, lower, upper);
}

EMSCRIPTEN_KEEPALIVE
void physics_enableWheelJointMotor(uint32_t entityId, int enable) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2WheelJoint_EnableMotor(jid, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void physics_setWheelJointMotorSpeed(uint32_t entityId, float speed) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2WheelJoint_SetMotorSpeed(jid, speed);
}

EMSCRIPTEN_KEEPALIVE
void physics_setWheelJointMaxMotorTorque(uint32_t entityId, float torque) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2WheelJoint_SetMaxMotorTorque(jid, torque);
}

EMSCRIPTEN_KEEPALIVE
float physics_getWheelJointMotorTorque(uint32_t entityId) {
    auto jid = findValidJoint(entityId);
    if (B2_IS_NULL(jid)) return 0;
    return b2WheelJoint_GetMotorTorque(jid);
}

// -----------------------------------------------------------------------------
// Motor joint — drives bodyB toward a relative linear/angular velocity (or a
// spring-held offset) against bodyA. Good for conveyors, driven platforms, and
// the "move toward a target" behaviour the mouse-drag helper below reuses.
// -----------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int physics_createMotorJoint(uint32_t entityIdA, uint32_t entityIdB,
                             float linearVelX, float linearVelY, float maxVelocityForce,
                             float angularVelocity, float maxVelocityTorque,
                             float linearHertz, float linearDampingRatio, float maxSpringForce,
                             float angularHertz, float angularDampingRatio, float maxSpringTorque,
                             int collideConnected) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto itA = g_ctx.entityToBody.find(entityIdA);
    auto itB = g_ctx.entityToBody.find(entityIdB);
    if (itA == g_ctx.entityToBody.end() || itB == g_ctx.entityToBody.end()) return 0;
    if (!b2Body_IsValid(itA->second) || !b2Body_IsValid(itB->second)) return 0;

    b2MotorJointDef jointDef = b2DefaultMotorJointDef();
    jointDef.base.bodyIdA = itA->second;
    jointDef.base.bodyIdB = itB->second;
    jointDef.linearVelocity = {linearVelX, linearVelY};
    jointDef.maxVelocityForce = maxVelocityForce;
    jointDef.angularVelocity = angularVelocity;
    jointDef.maxVelocityTorque = maxVelocityTorque;
    jointDef.linearHertz = linearHertz;
    jointDef.linearDampingRatio = linearDampingRatio;
    jointDef.maxSpringForce = maxSpringForce;
    jointDef.angularHertz = angularHertz;
    jointDef.angularDampingRatio = angularDampingRatio;
    jointDef.maxSpringTorque = maxSpringTorque;
    jointDef.base.collideConnected = collideConnected != 0;

    b2JointId jointId = b2CreateMotorJoint(g_ctx.worldId, &jointDef);
    g_ctx.entityToJoint[entityIdB] = jointId;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void physics_setMotorJointLinearVelocity(uint32_t entityId, float vx, float vy) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2MotorJoint_SetLinearVelocity(jid, {vx, vy});
}

EMSCRIPTEN_KEEPALIVE
void physics_setMotorJointAngularVelocity(uint32_t entityId, float omega) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2MotorJoint_SetAngularVelocity(jid, omega);
}

EMSCRIPTEN_KEEPALIVE
void physics_setMotorJointMaxVelocityForce(uint32_t entityId, float force) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2MotorJoint_SetMaxVelocityForce(jid, force);
}

EMSCRIPTEN_KEEPALIVE
void physics_setMotorJointMaxVelocityTorque(uint32_t entityId, float torque) {
    auto jid = findValidJoint(entityId);
    if (!B2_IS_NULL(jid)) b2MotorJoint_SetMaxVelocityTorque(jid, torque);
}

// -----------------------------------------------------------------------------
// Mouse (drag) joint — Box2D v3 has no dedicated mouse joint, so this is the
// canonical replacement from Box2D's own sample: a kinematic "mouse body" plus a
// spring motor joint pulling the target toward the cursor. Only one is live at a
// time (stored on the context); creating a new one tears down the previous.
// -----------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int physics_createMouseJoint(uint32_t entityId, float targetX, float targetY,
                             float hertz, float dampingRatio, float maxForce) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end() || !b2Body_IsValid(it->second)) return 0;

    if (b2Joint_IsValid(g_ctx.mouseJointId)) b2DestroyJoint(g_ctx.mouseJointId, false);
    if (b2Body_IsValid(g_ctx.mouseBodyId)) b2DestroyBody(g_ctx.mouseBodyId);

    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_kinematicBody;
    bodyDef.position = {targetX, targetY};
    bodyDef.enableSleep = false;
    g_ctx.mouseBodyId = b2CreateBody(g_ctx.worldId, &bodyDef);

    b2MotorJointDef jointDef = b2DefaultMotorJointDef();
    jointDef.base.bodyIdA = g_ctx.mouseBodyId;
    jointDef.base.bodyIdB = it->second;
    jointDef.base.localFrameB.p = b2Body_GetLocalPoint(it->second, {targetX, targetY});
    jointDef.linearHertz = hertz;
    jointDef.linearDampingRatio = dampingRatio;

    // Auto-size the spring force from the body's weight (Box2D's sample formula) when
    // the caller passes maxForce <= 0. Top-down worlds have no gravity, so fall back
    // to a nominal g so the drag still has bite. Also cap angular drift like the sample.
    b2MassData massData = b2Body_GetMassData(it->second);
    if (maxForce <= 0.0f) {
        float g = b2Length(b2World_GetGravity(g_ctx.worldId));
        maxForce = 100.0f * massData.mass * (g > 0.0f ? g : 10.0f);
    }
    jointDef.maxSpringForce = maxForce;
    if (massData.mass > 0.0f) {
        float lever = sqrtf(massData.rotationalInertia / massData.mass);
        jointDef.maxVelocityTorque = 0.25f * lever * (maxForce / 100.0f);
    }

    g_ctx.mouseJointId = b2CreateMotorJoint(g_ctx.worldId, &jointDef);

    b2Body_SetAwake(it->second, true);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void physics_setMouseTarget(float targetX, float targetY) {
    if (!b2Body_IsValid(g_ctx.mouseBodyId)) return;
    b2Body_SetTransform(g_ctx.mouseBodyId, {targetX, targetY}, b2Rot_identity);
    if (b2Joint_IsValid(g_ctx.mouseJointId)) {
        b2BodyId bodyB = b2Joint_GetBodyB(g_ctx.mouseJointId);
        if (b2Body_IsValid(bodyB)) b2Body_SetAwake(bodyB, true);
    }
}

EMSCRIPTEN_KEEPALIVE
void physics_destroyMouseJoint() {
    if (b2Joint_IsValid(g_ctx.mouseJointId)) b2DestroyJoint(g_ctx.mouseJointId, false);
    if (b2Body_IsValid(g_ctx.mouseBodyId)) b2DestroyBody(g_ctx.mouseBodyId);
    g_ctx.mouseJointId = b2_nullJointId;
    g_ctx.mouseBodyId = b2_nullBodyId;
}

EMSCRIPTEN_KEEPALIVE
int physics_hasMouseJoint() {
    return b2Joint_IsValid(g_ctx.mouseJointId) ? 1 : 0;
}

} // extern "C"
