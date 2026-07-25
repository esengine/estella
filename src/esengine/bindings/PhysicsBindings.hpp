// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsBindings.hpp
 * @brief   The Box2D module's entry points, declared once for both platforms.
 * @details The physics module is plain C: `extern "C"` functions over a Box2D world,
 *          which the web build links into its own wasm side module and exports by
 *          KEEPALIVE. There were no declarations anywhere — the SDK's
 *          `PhysicsWasmModule` interface was the only statement of this surface, and
 *          it could drift from the C++ silently.
 *
 *          Declaring them here gives the surface one source: the same file the web
 *          module compiles from, and the file EHT reads to generate the QuickJS
 *          wrappers a native host binds (`eht --native-functions`). A native build
 *          compiles these TUs and Box2D into the host binary — no side module, since
 *          there is no dynamic-linking story to have on a device.
 *
 *          Bulk data crosses as an offset into the caller's heap (wasm linear memory
 *          on the web, the host arena on a device), which is why the readback getters
 *          carry an `@heapreturn` annotation: they hand back memory the MODULE owns,
 *          so a native wrapper copies exactly that many bytes into the heap the SDK
 *          reads. The byte counts come from the module, never from a stride guessed
 *          on the far side — see the `*Bytes` helpers at the end.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstddef>
#include <cstdint>

extern "C" {

// — World, bodies, the step, events and body properties (PhysicsModuleEntry.cpp) —

void physics_init(float gx, float gy, float timestep, int substeps, float contactHertz, float contactDampingRatio, float contactSpeed);
void physics_setWorldConfig(int enableSleep, int enableContinuous, float restitutionThreshold, float maxLinearSpeed);
void physics_shutdown();
void physics_setOneWayPlatform(uint32_t entityId, float nx, float ny, int enable);
void physics_createBody(uint32_t entityId, int bodyType, float x, float y, float angle, float gravityScale, float linearDamping, float angularDamping, int fixedRotation, int bullet);
void physics_destroyBody(uint32_t entityId);
int physics_hasBody(uint32_t entityId);
void physics_setBodyEnabled(uint32_t entityId, int enabled);
void physics_step(float dt);
void physics_setBodyTransform(uint32_t entityId, float x, float y, float angle);
void physics_setBodyTargetTransform(uint32_t entityId, float x, float y, float angle, float dt);
int physics_getDynamicBodyCount();
// @heapreturn physics_dynamicBodyTransformsBytes()
uintptr_t physics_getDynamicBodyTransforms();
void physics_collectEvents();
int physics_getCollisionEnterCount();
// @heapreturn physics_collisionEnterBytes()
uintptr_t physics_getCollisionEnterBuffer();
int physics_getHitEventCount();
// @heapreturn physics_hitEventBytes()
uintptr_t physics_getHitEventBuffer();
int physics_getCollisionExitCount();
// @heapreturn physics_collisionExitBytes()
uintptr_t physics_getCollisionExitBuffer();
int physics_getSensorEnterCount();
// @heapreturn physics_sensorEnterBytes()
uintptr_t physics_getSensorEnterBuffer();
int physics_getSensorExitCount();
// @heapreturn physics_sensorExitBytes()
uintptr_t physics_getSensorExitBuffer();
void physics_applyForce(uint32_t entityId, float forceX, float forceY);
void physics_applyImpulse(uint32_t entityId, float impulseX, float impulseY);
void physics_setLinearVelocity(uint32_t entityId, float vx, float vy);
// @heapreturn 2 * sizeof(float)
uintptr_t physics_getLinearVelocity(uint32_t entityId);
void physics_setGravity(float gx, float gy);
// @heapreturn 2 * sizeof(float)
uintptr_t physics_getGravity();
void physics_setAngularVelocity(uint32_t entityId, float omega);
float physics_getAngularVelocity(uint32_t entityId);
void physics_applyTorque(uint32_t entityId, float torque);
void physics_applyAngularImpulse(uint32_t entityId, float impulse);
void physics_updateBodyProperties(uint32_t entityId, int bodyType, float gravityScale, float linearDamping, float angularDamping, int fixedRotation, int bullet);
void physics_setAwake(uint32_t entityId, int awake);
int physics_isAwake(uint32_t entityId);
float physics_getBodyMass(uint32_t entityId);
float physics_getBodyInertia(uint32_t entityId);
// @heapreturn 2 * sizeof(float)
uintptr_t physics_getBodyCenterOfMass(uint32_t entityId);

// — Shapes (PhysicsShapes.cpp) —

void physics_addBoxShape(uint32_t entityId, float halfW, float halfH, float offX, float offY, float radius, float density, float friction, float restitution, int isSensor, uint32_t categoryBits, uint32_t maskBits);
void physics_addCircleShape(uint32_t entityId, float radius, float offX, float offY, float density, float friction, float restitution, int isSensor, uint32_t categoryBits, uint32_t maskBits);
void physics_addCapsuleShape(uint32_t entityId, float radius, float halfHeight, float offX, float offY, float density, float friction, float restitution, int isSensor, uint32_t categoryBits, uint32_t maskBits);
void physics_addSegmentShape(uint32_t entityId, float x1, float y1, float x2, float y2, float density, float friction, float restitution, int isSensor, uint32_t categoryBits, uint32_t maskBits);
void physics_addPolygonShape(uint32_t entityId, uintptr_t verticesPtr, int vertexCount, float radius, float density, float friction, float restitution, int isSensor, uint32_t categoryBits, uint32_t maskBits);
void physics_addChainShape(uint32_t entityId, uintptr_t pointsPtr, int pointCount, int isLoop, float friction, float restitution, uint32_t categoryBits, uint32_t maskBits);
void physics_clearShapes(uint32_t entityId);

// — Joints (PhysicsJoints.cpp) —

int physics_createRevoluteJoint(uint32_t entityIdA, uint32_t entityIdB, float anchorAx, float anchorAy, float anchorBx, float anchorBy, int enableMotor, float motorSpeed, float maxMotorTorque, int enableLimit, float lowerAngle, float upperAngle, int collideConnected);
void physics_destroyJoint(uint32_t entityId);
void physics_setRevoluteMotorSpeed(uint32_t entityId, float speed);
void physics_setRevoluteMaxMotorTorque(uint32_t entityId, float torque);
void physics_enableRevoluteMotor(uint32_t entityId, int enable);
void physics_enableRevoluteLimit(uint32_t entityId, int enable);
void physics_setRevoluteLimits(uint32_t entityId, float lower, float upper);
float physics_getRevoluteAngle(uint32_t entityId);
float physics_getRevoluteMotorTorque(uint32_t entityId);
int physics_hasJoint(uint32_t entityId);
int physics_createDistanceJoint(uint32_t entityIdA, uint32_t entityIdB, float anchorAx, float anchorAy, float anchorBx, float anchorBy, float length, int enableSpring, float hertz, float dampingRatio, int enableLimit, float minLength, float maxLength, int enableMotor, float maxMotorForce, float motorSpeed, int collideConnected);
int physics_createPrismaticJoint(uint32_t entityIdA, uint32_t entityIdB, float anchorAx, float anchorAy, float anchorBx, float anchorBy, float axisX, float axisY, int enableSpring, float hertz, float dampingRatio, int enableLimit, float lowerTranslation, float upperTranslation, int enableMotor, float maxMotorForce, float motorSpeed, int collideConnected);
int physics_createWeldJoint(uint32_t entityIdA, uint32_t entityIdB, float anchorAx, float anchorAy, float anchorBx, float anchorBy, float linearHertz, float angularHertz, float linearDampingRatio, float angularDampingRatio, int collideConnected);
int physics_createWheelJoint(uint32_t entityIdA, uint32_t entityIdB, float anchorAx, float anchorAy, float anchorBx, float anchorBy, float axisX, float axisY, int enableSpring, float hertz, float dampingRatio, int enableLimit, float lowerTranslation, float upperTranslation, int enableMotor, float maxMotorTorque, float motorSpeed, int collideConnected);
float physics_getDistanceJointLength(uint32_t entityId);
float physics_getDistanceJointCurrentLength(uint32_t entityId);
void physics_setDistanceJointLength(uint32_t entityId, float length);
void physics_enableDistanceJointSpring(uint32_t entityId, int enable);
void physics_enableDistanceJointLimit(uint32_t entityId, int enable);
void physics_setDistanceJointLimits(uint32_t entityId, float minLength, float maxLength);
void physics_enableDistanceJointMotor(uint32_t entityId, int enable);
void physics_setDistanceJointMotorSpeed(uint32_t entityId, float speed);
void physics_setDistanceJointMaxMotorForce(uint32_t entityId, float force);
float physics_getDistanceJointMotorForce(uint32_t entityId);
float physics_getPrismaticJointTranslation(uint32_t entityId);
float physics_getPrismaticJointSpeed(uint32_t entityId);
void physics_enablePrismaticJointSpring(uint32_t entityId, int enable);
void physics_enablePrismaticJointLimit(uint32_t entityId, int enable);
void physics_setPrismaticJointLimits(uint32_t entityId, float lower, float upper);
void physics_enablePrismaticJointMotor(uint32_t entityId, int enable);
void physics_setPrismaticJointMotorSpeed(uint32_t entityId, float speed);
void physics_setPrismaticJointMaxMotorForce(uint32_t entityId, float force);
float physics_getPrismaticJointMotorForce(uint32_t entityId);
void physics_enableWheelJointSpring(uint32_t entityId, int enable);
void physics_enableWheelJointLimit(uint32_t entityId, int enable);
void physics_setWheelJointLimits(uint32_t entityId, float lower, float upper);
void physics_enableWheelJointMotor(uint32_t entityId, int enable);
void physics_setWheelJointMotorSpeed(uint32_t entityId, float speed);
void physics_setWheelJointMaxMotorTorque(uint32_t entityId, float torque);
float physics_getWheelJointMotorTorque(uint32_t entityId);
int physics_createMotorJoint(uint32_t entityIdA, uint32_t entityIdB, float linearVelX, float linearVelY, float maxVelocityForce, float angularVelocity, float maxVelocityTorque, float linearHertz, float linearDampingRatio, float maxSpringForce, float angularHertz, float angularDampingRatio, float maxSpringTorque, int collideConnected);
void physics_setMotorJointLinearVelocity(uint32_t entityId, float vx, float vy);
void physics_setMotorJointAngularVelocity(uint32_t entityId, float omega);
void physics_setMotorJointMaxVelocityForce(uint32_t entityId, float force);
void physics_setMotorJointMaxVelocityTorque(uint32_t entityId, float torque);
int physics_createMouseJoint(uint32_t entityId, float targetX, float targetY, float hertz, float dampingRatio, float maxForce);
void physics_setMouseTarget(float targetX, float targetY);
void physics_destroyMouseJoint();
int physics_hasMouseJoint();

// — Queries: raycast, overlap, shape cast, character movement (PhysicsQueries.cpp) —

int physics_raycast(float originX, float originY, float dirX, float dirY, float maxDistance, uint32_t maskBits);
// @heapreturn physics_raycastBytes()
uintptr_t physics_getRaycastBuffer();
int physics_overlapCircle(float centerX, float centerY, float radius, uint32_t maskBits);
// @heapreturn physics_overlapBytes()
uintptr_t physics_getOverlapBuffer();
int physics_shapeCastCircle(float centerX, float centerY, float radius, float translationX, float translationY, uint32_t maskBits);
int physics_shapeCastBox(float centerX, float centerY, float halfW, float halfH, float angle, float translationX, float translationY, uint32_t maskBits);
int physics_shapeCastCapsule(float center1X, float center1Y, float center2X, float center2Y, float radius, float translationX, float translationY, uint32_t maskBits);
// @heapreturn physics_shapeCastBytes()
uintptr_t physics_getShapeCastBuffer();
int physics_overlapAABB(float minX, float minY, float maxX, float maxY, uint32_t maskBits);
int physics_moveCharacter(float px, float py, float c1x, float c1y, float c2x, float c2y, float radius, float velX, float velY, float dt, float upX, float upY, float floorCos, uint32_t maskBits, uint32_t selfEntity, float skinWidth, int maxSlides, float snapLength, int slideOnCeiling);
// @heapreturn physics_moveCharacterBytes()
uintptr_t physics_getMoveCharacterBuffer();

// — Readback lengths —
//
// How many bytes each getter above actually published. The buffers are the module's
// own (vectors it fills per step, fixed arrays a query writes), so only the module
// can say how much is live: a count times an assumed stride would over-read the very
// frame a body was disabled or a query found fewer hits than the last one.
size_t physics_dynamicBodyTransformsBytes();
size_t physics_collisionEnterBytes();
size_t physics_collisionExitBytes();
size_t physics_sensorEnterBytes();
size_t physics_sensorExitBytes();
size_t physics_hitEventBytes();
size_t physics_raycastBytes();
size_t physics_overlapBytes();
size_t physics_shapeCastBytes();
size_t physics_moveCharacterBytes();

}  // extern "C"
