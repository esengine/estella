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

// Bodies
uint32_t physics3d_addBox(uint32_t entity, float hx, float hy, float hz,
                          float px, float py, float pz,
                          float qx, float qy, float qz, float qw,
                          int motion, float gravityScale, float linearDamping,
                          float angularDamping, int fixedRotation, uint32_t layer,
                          int continuous, float friction, float restitution, int isSensor);
uint32_t physics3d_addSphere(uint32_t entity, float radius,
                             float px, float py, float pz,
                             float qx, float qy, float qz, float qw,
                             int motion, float gravityScale, float linearDamping,
                             float angularDamping, int fixedRotation, uint32_t layer,
                             int continuous, float friction, float restitution, int isSensor);
uint32_t physics3d_addCapsule(uint32_t entity, float radius, float halfHeight,
                              float px, float py, float pz,
                              float qx, float qy, float qz, float qw,
                              int motion, float gravityScale, float linearDamping,
                              float angularDamping, int fixedRotation, uint32_t layer,
                              int continuous, float friction, float restitution, int isSensor);
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
int physics3d_getBodyState(uint32_t bodyId);

// Characters — swept rather than solved, and not bodies.
uint32_t physics3d_addCharacter(uint32_t entity, float radius, float halfHeight,
                                float px, float py, float pz, float maxSlope, float mass,
                                uint32_t layer, float pushForce);
void physics3d_removeCharacter(uint32_t characterId);
void physics3d_moveCharacter(uint32_t characterId, float vx, float vy, float vz,
                             float dt, float stepUp, float stepDown);
void physics3d_setCharacterPosition(uint32_t characterId, float px, float py, float pz);

// Joints
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
float physics3d_jointValue(uint32_t entity);

// Queries. Each answers a hit count and leaves the hits in the query buffer.
int physics3d_raycast(float ox, float oy, float oz, float dx, float dy, float dz,
                      uint32_t layerMask);
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
