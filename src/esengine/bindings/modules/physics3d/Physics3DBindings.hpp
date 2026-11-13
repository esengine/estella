// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DBindings.hpp
 * @brief   The Jolt module's entry points, declared once for both platforms.
 * @details The same arrangement the 2D module has: plain `extern "C"` over one
 *          world, linked into a wasm side module on the web and compiled into the
 *          host binary on a device, where there is no dynamic-linking story to
 *          have. Until this file existed the SDK's `Physics3DWasmModule` interface
 *          was the only statement of the surface and could drift from the C++
 *          silently — and a native host had no way to bind it at all.
 *
 *          Bulk data crosses as an offset into the caller's heap, so the readback
 *          getters carry `@heapreturn`: they hand back memory the MODULE owns, and
 *          a native wrapper copies exactly that many bytes into the heap the SDK
 *          reads. The byte counts come from the module, never from a stride
 *          guessed on the far side.
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

// World lifecycle
void physics3d_init(float gx, float gy, float gz, uint32_t maxBodies);
void physics3d_shutdown();
int physics3d_isReady();
void physics3d_step(float dt, int collisionSteps);
void physics3d_optimize();
void physics3d_setLayerMask(uint32_t layer, uint32_t mask);
/// Every body on a line, nearest first, at most maxHits of them: writes (entity, entry, exit, px,py,pz, nx,ny,nz) for
/// each into the query buffer, where entry and exit are fractions of the line at which it goes into the body and out of
/// it (1 where the line ends inside it), the point and normal where it goes in. Returns how many. What a shot that
/// passes through thin cover needs: the second body, and how much of the first it crossed to get there.
int physics3d_raycastAll(float ox, float oy, float oz, float dx, float dy, float dz, uint32_t layerMask, uint32_t maxHits);
/// physics3d_raycast with flags: bit 0 also meets characters (a shot, which must hit an enemy that walks).
/// Plain physics3d_raycast stays blind to them: line of sight and a camera's boom ask about the world.
int physics3d_raycastWith(float ox, float oy, float oz, float dx, float dy, float dz,
                          uint32_t layerMask, uint32_t flags);
/// The project's solver settings. Each value <= 0 keeps the backend's own default
/// (Jolt's for Jolt, Unity's for PhysX); allowSleep is 0 or 1. After init, before bodies.
void physics3d_setSolver(int velocityIterations, int positionIterations, int allowSleep,
                         float bounceThreshold);

// Bodies
uint32_t physics3d_addCompound(uint32_t entity, uintptr_t partsPtr, uint32_t count,
                               float px, float py, float pz, float qx, float qy, float qz, float qw,
                               int motion, float gravityScale, float linearDamping, float angularDamping,
                               int fixedRotation, uint32_t layer, int continuous,
                               float friction, float restitution, int isSensor, float mass);
uint32_t physics3d_addBox(uint32_t entity, float hx, float hy, float hz,
                          float px, float py, float pz,
                          float qx, float qy, float qz, float qw,
                          int motion, float gravityScale, float linearDamping,
                          float angularDamping, int fixedRotation, uint32_t layer,
                          int continuous, float friction, float restitution, int isSensor,
                          float cx, float cy, float cz);
uint32_t physics3d_addSphere(uint32_t entity, float radius,
                             float px, float py, float pz,
                             float qx, float qy, float qz, float qw,
                             int motion, float gravityScale, float linearDamping,
                             float angularDamping, int fixedRotation, uint32_t layer,
                             int continuous, float friction, float restitution, int isSensor,
                             float cx, float cy, float cz);
uint32_t physics3d_addCapsule(uint32_t entity, float radius, float halfHeight,
                              float px, float py, float pz,
                              float qx, float qy, float qz, float qw,
                              int motion, float gravityScale, float linearDamping,
                              float angularDamping, int fixedRotation, uint32_t layer,
                              int continuous, float friction, float restitution, int isSensor,
                              float cx, float cy, float cz);
uint32_t physics3d_addMeshBody(uint32_t entity, uintptr_t vertexPtr, uint32_t vertexCount,
                               uintptr_t indexPtr, uint32_t indexCount,
                               float px, float py, float pz,
                               float qx, float qy, float qz, float qw,
                               uint32_t layer, float friction, float restitution);
uint32_t physics3d_addConvexBody(uint32_t entity, uintptr_t vertexPtr, uint32_t vertexCount,
                                 float px, float py, float pz,
                                 float qx, float qy, float qz, float qw,
                                 int motion, float gravityScale, float linearDamping,
                                 float angularDamping, int fixedRotation, uint32_t layer,
                                 int continuous, float friction, float restitution, int isSensor);
void physics3d_removeBody(uint32_t bodyId);
void physics3d_setTransform(uint32_t bodyId, float px, float py, float pz,
                            float qx, float qy, float qz, float qw);
void physics3d_setLinearVelocity(uint32_t bodyId, float vx, float vy, float vz);
// A moving body's mass, in kilograms, its inertia scaled with it so it turns as its shape says; nothing for a body
// that does not move, or a mass that is not a positive number.
void physics3d_setMass(uint32_t bodyId, float mass);
// A blow of (ix, iy, iz) newton seconds at the world point (px, py, pz) - at its centre of mass where the point is not a
// number - all at once: its speed changes by impulse /
// mass, and it turns by as much as the point is off its centre of mass. Wakes it. Nothing for a body that does not move.
void physics3d_addImpulse(uint32_t bodyId, float ix, float iy, float iz, float px, float py, float pz);
// A twist of (ix, iy, iz) newton metre seconds, all at once. Wakes it.
void physics3d_addAngularImpulse(uint32_t bodyId, float ix, float iy, float iz);
// Its spin, in radians a second about each world axis. Wakes it.
void physics3d_setAngularVelocity(uint32_t bodyId, float wx, float wy, float wz);
// The world's gravity, in metres a second squared. A sleeping body stays asleep until something wakes it.
void physics3d_setGravity(float gx, float gy, float gz);
// Wake a body (awake != 0) or put it to sleep; and whether it is awake: 1 awake, 0 asleep or not a moving body.
void physics3d_setAwake(uint32_t bodyId, int awake);
int physics3d_isAwake(uint32_t bodyId);
// Writes (mass, cx, cy, cz, ix, iy, iz): kilograms, its centre of mass in the world in metres, and how hard it is to
// turn about each of its own axes in kg m^2 - the moment that answers a twist about that axis alone, its moment of
// inertia there where the axis is a principal one, as a box's are; infinite about an axis it may not turn on.
// 0 for a body that does not move.
int physics3d_getBodyMassData(uint32_t bodyId);
int physics3d_getBodyState(uint32_t bodyId);
// What a force needs to know of a body: its mass and how it is turning.
int physics3d_getBodyDynamics(uint32_t bodyId);
// Forces, held until the next step and applied over it: at a world point (so it turns the body as well as pushing it), and as a torque.
void physics3d_addForce(uint32_t bodyId, float fx, float fy, float fz, float px, float py, float pz);
void physics3d_addTorque(uint32_t bodyId, float tx, float ty, float tz);

// Characters — swept rather than solved, and not bodies.
uint32_t physics3d_addCharacter(uint32_t entity, float radius, float halfHeight,
                                float px, float py, float pz, float maxSlope, float mass,
                                uint32_t layer, float pushForce);
void physics3d_removeCharacter(uint32_t characterId);
void physics3d_moveCharacter(uint32_t characterId, float vx, float vy, float vz,
                             float dt, float stepUp, float stepDown);
void physics3d_setCharacterPosition(uint32_t characterId, float px, float py, float pz);

// Joints
uint32_t physics3d_addSwingTwistJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
    float px, float py, float pz, float ax, float ay, float az,
    float nx, float ny, float nz, float normalHalf, float planeHalf,
    float twistMin, float twistMax, int collideConnected);
uint32_t physics3d_addSixDOFJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
    float px, float py, float pz, float ax, float ay, float az, float nx, float ny, float nz,
    int translationMotion, int rotationMotion,
    float lx, float ly, float lz, float hx, float hy, float hz,
    float rx, float ry, float rz, float sx, float sy, float sz, int collideConnected);
void physics3d_setAdvancedJointMotor(uint32_t entity, int enable,
    float vx, float vy, float vz, float wx, float wy, float wz, float maxForce, float maxTorque);
uint32_t physics3d_addPointJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 float px, float py, float pz, int collideConnected);
uint32_t physics3d_addHingeJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 float px, float py, float pz,
                                 float ax, float ay, float az,
                                 int enableLimit, float lowerAngle, float upperAngle,
                                 int enableMotor, float motorSpeed, float maxTorque,
                                 int collideConnected);
uint32_t physics3d_addSliderJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                  float px, float py, float pz,
                                  float ax, float ay, float az,
                                  int enableLimit, float lower, float upper,
                                  int enableMotor, float motorSpeed, float maxForce,
                                  int collideConnected);
uint32_t physics3d_addDistanceJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                    float ax, float ay, float az,
                                    float bx, float by, float bz,
                                    float minLength, float maxLength,
                                    float frequency, float damping, int collideConnected);
uint32_t physics3d_addFixedJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 int collideConnected);
void physics3d_removeJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB);
void physics3d_setJointMotor(uint32_t entity, int enable, float speed);
// What the joint held its two bodies together with over the last step: writes (force in newtons, torque in newton
// metres) into the query buffer, its limits' share included and its motor's not. 1 for a joint, 0 for none.
int physics3d_jointForce(uint32_t entity);
// A hinge's angles (radians) or a slider's travel (metres) it may move between, or none (enable 0). A range is
// measured from the pose the joint was made in and always holds it: one that does not reach 0 is widened to 0.
void physics3d_setJointLimits(uint32_t entity, int enable, float lower, float upper);
// The most a hinge's motor may twist (newton metres) or a slider's push (newtons).
void physics3d_setJointMotorLimit(uint32_t entity, float limit);
// A distance joint's shortest and longest (metres), and its spring (frequency 0 is rigid).
void physics3d_setDistanceJoint(uint32_t entity, float minLength, float maxLength, float frequency, float damping);
float physics3d_jointValue(uint32_t entity);

// Queries. Each answers a hit count and leaves the hits in the query buffer.
int physics3d_raycast(float ox, float oy, float oz, float dx, float dy, float dz,
                      uint32_t layerMask);
// A box of half-extents (hx, hy, hz), turned by (qx, qy, qz, qw), swept from (px, py, pz) along (dx, dy, dz): the
// first body it would meet, written as sphereCast writes it.
int physics3d_boxCast(float px, float py, float pz, float hx, float hy, float hz,
                      float qx, float qy, float qz, float qw, float dx, float dy, float dz, uint32_t layerMask);
// An upright capsule (its length along its own y, as a character stands), turned by (qx, qy, qz, qw), swept the same way.
int physics3d_capsuleCast(float px, float py, float pz, float radius, float halfHeight,
                          float qx, float qy, float qz, float qw, float dx, float dy, float dz, uint32_t layerMask);
int physics3d_sphereCast(float px, float py, float pz, float radius,
                         float dx, float dy, float dz, uint32_t layerMask);
int physics3d_overlapSphere(float px, float py, float pz, float radius, uint32_t layerMask);
int physics3d_overlapBox(float px, float py, float pz, float hx, float hy, float hz,
                         uint32_t layerMask);

// Readback. A pointer crosses as an integer, the same way the 2D module's
// getters do: the caller reads `*Bytes()` from the module and copies exactly
// that much out of the heap it names.

// @heapreturn physics3d_transformsBytes()
uintptr_t physics3d_transforms();
size_t physics3d_transformsBytes();
// @heapreturn physics3d_contactEntersBytes()
uintptr_t physics3d_contactEnters();
size_t physics3d_contactEntersBytes();
// How fast the two came together at each contact begun this step, along its normal, in the world's own units a
// second: one float for each entry of physics3d_contactEnters, in its order.
// @heapreturn physics3d_contactEnterSpeedsBytes()
uintptr_t physics3d_contactEnterSpeeds();
size_t physics3d_contactEnterSpeedsBytes();
// The mass the two met with at each contact begun this step, in kilograms: 1 / (1/a + 1/b), a body that does not move
// counting as one of no inverse mass, so a stone on a floor meets it with the stone's own mass. Infinite where neither
// moves of itself (a kinematic body into a static one). One float for each entry of physics3d_contactEnters.
// @heapreturn physics3d_contactEnterMassesBytes()
uintptr_t physics3d_contactEnterMasses();
size_t physics3d_contactEnterMassesBytes();
// What characters ran into this step, each meeting once until they part: (character entity, other entity, px,py,pz,
// nx,ny,nz with the normal toward the character, closing speed, meeting mass in kilograms) for each, the speed and mass
// as a contact between bodies gives them. Read after the step; the next step's first move starts it again.
// @heapreturn physics3d_characterHitsBytes()
uintptr_t physics3d_characterHits();
size_t physics3d_characterHitsBytes();
// @heapreturn physics3d_contactExitsBytes()
uintptr_t physics3d_contactExits();
size_t physics3d_contactExitsBytes();
// @heapreturn physics3d_sensorEntersBytes()
uintptr_t physics3d_sensorEnters();
size_t physics3d_sensorEntersBytes();
// @heapreturn physics3d_sensorExitsBytes()
uintptr_t physics3d_sensorExits();
size_t physics3d_sensorExitsBytes();
// @heapreturn physics3d_queryResultBytes()
uintptr_t physics3d_queryResult();
size_t physics3d_queryResultBytes();

}  // extern "C"
