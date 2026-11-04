// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysXJoints.cpp
 * @brief   Joints for the PhysX backend, on the Jolt module's terms.
 * @details Anchors and axes arrive in world space, taken when the joint is made,
 *          and both bodies get the same frame, so every limit's zero is the
 *          authored pose — the same rule the Jolt module follows. A slider is a
 *          D6 joint here rather than a prismatic one, because a prismatic joint
 *          has no motor; swing-twist and six-axis joints are D6 as in Unity's
 *          ConfigurableJoint.
 *
 *          "Do not collide connected" is PhysX's own default for every joint,
 *          so the assemblies the Jolt module keeps are not needed.
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

using namespace physx;
using esengine::physics3d_physx::Body;
using esengine::physics3d_physx::Joint;
using esengine::physics3d_physx::JointKind;
using esengine::physics3d_physx::World;
namespace px3 = esengine::physics3d_physx;

namespace {

World& g() { return px3::world(); }

/// A velocity drive: no spring, a damping stiff enough that the force limit is
/// what bounds it — what a motor with a maximum force is.
constexpr float MOTOR_DAMPING = 1.0e6f;

bool finite(const PxVec3& v) { return v.isFinite(); }

PxVec3 perpendicularTo(const PxVec3& v) {
    PxVec3 axis = v;
    if (axis.normalizeSafe() <= 0.0f) axis = PxVec3(0.0f, 1.0f, 0.0f);
    const PxVec3 other = std::abs(axis.y) < 0.9f ? PxVec3(0.0f, 1.0f, 0.0f) : PxVec3(1.0f, 0.0f, 0.0f);
    PxVec3 out = axis.cross(other);
    return out.normalizeSafe() > 0.0f ? out : PxVec3(1.0f, 0.0f, 0.0f);
}

bool referenceFrame(const PxVec3& x, const PxVec3& y, PxVec3& outX, PxVec3& outY) {
    if (!finite(x) || !finite(y) || x.magnitudeSquared() < 1.0e-12f || y.magnitudeSquared() < 1.0e-12f) return false;
    outX = x.getNormalized();
    const PxVec3 normal = y - outX * outX.dot(y);
    if (normal.magnitudeSquared() < 1.0e-10f * y.magnitudeSquared()) return false;
    outY = normal.getNormalized();
    return true;
}

/// The world frame whose X is `x` and whose Y is `y`.
PxTransform worldFrame(const PxVec3& at, const PxVec3& x, const PxVec3& y) {
    return PxTransform(at, PxQuat(PxMat33(x, y, x.cross(y))).getNormalized());
}

/// That frame in an actor's own space.
PxTransform localFrame(PxRigidActor* actor, const PxTransform& world) {
    return actor->getGlobalPose().transformInv(world);
}

PxRigidActor* actorOf(uint32_t bodyId) {
    Body* body = g().body(bodyId);
    return body ? body->actor : nullptr;
}

bool bothLive(uint32_t a, uint32_t b) {
    return g().isValid() && actorOf(a) != nullptr && actorOf(b) != nullptr;
}

void wake(PxRigidActor* actor) {
    if (PxRigidDynamic* d = actor ? actor->is<PxRigidDynamic>() : nullptr) {
        if (!(d->getRigidBodyFlags() & PxRigidBodyFlag::eKINEMATIC) && d->getScene()) d->wakeUp();
    }
}

void release(uint32_t entity) {
    auto found = g().joints.find(entity);
    if (found == g().joints.end()) return;
    found->second.joint->release();
    g().joints.erase(found);
}

uint32_t adopt(uint32_t entity, PxJoint* joint, JointKind kind, int collideConnected, float maxForce = 0.0f) {
    if (joint == nullptr) return 0;
    joint->setConstraintFlag(PxConstraintFlag::eCOLLISION_ENABLED, collideConnected != 0);
    release(entity);  // one joint per entity: the new one replaces the old
    Joint record;
    record.joint = joint;
    record.kind = kind;
    record.maxForce = maxForce;
    g().joints[entity] = record;
    return 1;
}

PxD6JointDrive motor(bool on, float limit) {
    return on ? PxD6JointDrive(0.0f, MOTOR_DAMPING, limit) : PxD6JointDrive();
}

/// The joint a world frame names between two bodies, as a D6 with everything locked.
PxD6Joint* d6(uint32_t bodyA, uint32_t bodyB, const PxTransform& frame) {
    PxRigidActor* a = actorOf(bodyA);
    PxRigidActor* b = actorOf(bodyB);
    PxD6Joint* joint = PxD6JointCreate(px3::physics(), a, localFrame(a, frame), b, localFrame(b, frame));
    if (joint) joint->setAngularDriveConfig(PxD6AngularDriveConfig::eSWING_TWIST);
    return joint;
}

/// A swing half-angle: none locks the axis, a half turn frees it.
PxD6Motion::Enum swingMotion(float half) {
    if (half <= 1.0e-4f) return PxD6Motion::eLOCKED;
    if (half >= PxPi - 1.0e-4f) return PxD6Motion::eFREE;
    return PxD6Motion::eLIMITED;
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSwingTwistJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
    float px, float py, float pz, float ax, float ay, float az,
    float nx, float ny, float nz, float normalHalf, float planeHalf,
    float twistMin, float twistMax, int collideConnected) {
    if (bodyA == bodyB || !bothLive(bodyA, bodyB) || g().joints.count(entity) != 0) return 0;
    PxVec3 x, y;
    if (!referenceFrame(PxVec3(ax, ay, az), PxVec3(nx, ny, nz), x, y) || !finite(PxVec3(px, py, pz))
        || !std::isfinite(normalHalf) || !std::isfinite(planeHalf)
        || !std::isfinite(twistMin) || !std::isfinite(twistMax)
        || normalHalf < 0 || normalHalf > PxPi || planeHalf < 0 || planeHalf > PxPi
        || twistMin < -PxPi || twistMax > PxPi || twistMin > twistMax) return 0;
    PxD6Joint* joint = d6(bodyA, bodyB, worldFrame(PxVec3(px, py, pz), x, y));
    if (joint == nullptr) return 0;
    // Twist about X. Jolt's normal half-angle bounds the swing about Z and its
    // plane half-angle the swing about Y.
    const bool twistFree = twistMin <= -PxPi + 1.0e-4f && twistMax >= PxPi - 1.0e-4f;
    joint->setMotion(PxD6Axis::eTWIST, twistFree ? PxD6Motion::eFREE
        : (twistMax - twistMin <= 1.0e-4f ? PxD6Motion::eLOCKED : PxD6Motion::eLIMITED));
    joint->setTwistLimit(PxJointAngularLimitPair(twistMin, twistMax));
    joint->setMotion(PxD6Axis::eSWING1, swingMotion(planeHalf));
    joint->setMotion(PxD6Axis::eSWING2, swingMotion(normalHalf));
    joint->setSwingLimit(PxJointLimitCone(std::max(planeHalf, 1.0e-3f), std::max(normalHalf, 1.0e-3f)));
    return adopt(entity, joint, JointKind::SwingTwist, collideConnected);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSixDOFJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
    float px, float py, float pz, float ax, float ay, float az, float nx, float ny, float nz,
    int translationMotion, int rotationMotion,
    float lx, float ly, float lz, float hx, float hy, float hz,
    float rx, float ry, float rz, float sx, float sy, float sz, int collideConnected) {
    if (bodyA == bodyB || !bothLive(bodyA, bodyB) || g().joints.count(entity) != 0) return 0;
    PxVec3 x, y;
    if (!referenceFrame(PxVec3(ax, ay, az), PxVec3(nx, ny, nz), x, y) || !finite(PxVec3(px, py, pz))
        || translationMotion < 0 || translationMotion > 63 || rotationMotion < 0 || rotationMotion > 63) return 0;
    const float lower[] = {lx, ly, lz, rx, ry, rz};
    const float upper[] = {hx, hy, hz, sx, sy, sz};
    PxD6Motion::Enum modes[6];
    for (int i = 0; i < 6; ++i) {
        const int mode = ((i < 3 ? translationMotion : rotationMotion) >> (2 * (i % 3))) & 3;
        if (!std::isfinite(lower[i]) || !std::isfinite(upper[i]) || mode == 3) return 0;
        if (mode == 1 && (lower[i] >= upper[i] || (i >= 3 && (lower[i] < -PxPi || upper[i] > PxPi)))) return 0;
        modes[i] = mode == 0 ? PxD6Motion::eLOCKED : (mode == 2 ? PxD6Motion::eFREE : PxD6Motion::eLIMITED);
    }
    PxD6Joint* joint = d6(bodyA, bodyB, worldFrame(PxVec3(px, py, pz), x, y));
    if (joint == nullptr) return 0;
    const PxD6Axis::Enum linear[] = {PxD6Axis::eX, PxD6Axis::eY, PxD6Axis::eZ};
    for (int i = 0; i < 3; ++i) {
        joint->setMotion(linear[i], modes[i]);
        if (modes[i] == PxD6Motion::eLIMITED) {
            joint->setLinearLimit(linear[i], PxJointLinearLimitPair(lower[i], upper[i], PxSpring(0.0f, 0.0f)));
        }
    }
    joint->setMotion(PxD6Axis::eTWIST, modes[3]);
    joint->setMotion(PxD6Axis::eSWING1, modes[4]);
    joint->setMotion(PxD6Axis::eSWING2, modes[5]);
    if (modes[3] == PxD6Motion::eLIMITED) joint->setTwistLimit(PxJointAngularLimitPair(rx, sx));
    // A pyramid: each swing axis limited on its own, the swing Jolt's six-axis joint uses.
    if (modes[4] == PxD6Motion::eLIMITED || modes[5] == PxD6Motion::eLIMITED) {
        joint->setPyramidSwingLimit(PxJointLimitPyramid(
            modes[4] == PxD6Motion::eLIMITED ? ry : -PxPi + 1.0e-3f,
            modes[4] == PxD6Motion::eLIMITED ? sy : PxPi - 1.0e-3f,
            modes[5] == PxD6Motion::eLIMITED ? rz : -PxPi + 1.0e-3f,
            modes[5] == PxD6Motion::eLIMITED ? sz : PxPi - 1.0e-3f));
    }
    return adopt(entity, joint, JointKind::SixDOF, collideConnected);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setAdvancedJointMotor(uint32_t entity, int enable,
    float vx, float vy, float vz, float wx, float wy, float wz, float maxForce, float maxTorque) {
    auto found = g().joints.find(entity);
    if (found == g().joints.end() || !finite(PxVec3(vx, vy, vz)) || !finite(PxVec3(wx, wy, wz))
        || !std::isfinite(maxForce) || maxForce < 0 || !std::isfinite(maxTorque) || maxTorque < 0) return;
    if (found->second.kind != JointKind::SwingTwist && found->second.kind != JointKind::SixDOF) return;
    PxD6Joint* joint = static_cast<PxD6Joint*>(found->second.joint);
    const bool on = enable != 0;
    if (found->second.kind == JointKind::SixDOF) {
        joint->setDrive(PxD6Drive::eX, motor(on && joint->getMotion(PxD6Axis::eX) != PxD6Motion::eLOCKED, maxForce));
        joint->setDrive(PxD6Drive::eY, motor(on && joint->getMotion(PxD6Axis::eY) != PxD6Motion::eLOCKED, maxForce));
        joint->setDrive(PxD6Drive::eZ, motor(on && joint->getMotion(PxD6Axis::eZ) != PxD6Motion::eLOCKED, maxForce));
    }
    joint->setDrive(PxD6Drive::eTWIST, motor(on && joint->getMotion(PxD6Axis::eTWIST) != PxD6Motion::eLOCKED, maxTorque));
    joint->setDrive(PxD6Drive::eSWING1, motor(on && joint->getMotion(PxD6Axis::eSWING1) != PxD6Motion::eLOCKED, maxTorque));
    joint->setDrive(PxD6Drive::eSWING2, motor(on && joint->getMotion(PxD6Axis::eSWING2) != PxD6Motion::eLOCKED, maxTorque));
    // PhysX drives the angular axes the other way round from Jolt: measured, a
    // positive twist velocity turned the joint towards its lower limit.
    joint->setDriveVelocity(found->second.kind == JointKind::SixDOF ? PxVec3(vx, vy, vz) : PxVec3(0.0f),
                            -PxVec3(wx, wy, wz), true);
    PxRigidActor* a = nullptr;
    PxRigidActor* b = nullptr;
    joint->getActors(a, b);
    wake(a);
    wake(b);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addPointJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 float px, float py, float pz, int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    PxRigidActor* a = actorOf(bodyA);
    PxRigidActor* b = actorOf(bodyB);
    const PxTransform frame(PxVec3(px, py, pz));
    return adopt(entity, PxSphericalJointCreate(px3::physics(), a, localFrame(a, frame), b, localFrame(b, frame)),
                 JointKind::Point, collideConnected);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addHingeJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 float px, float py, float pz, float ax, float ay, float az,
                                 int enableLimit, float lowerAngle, float upperAngle,
                                 int enableMotor, float motorSpeed, float maxTorque,
                                 int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    PxVec3 axis(ax, ay, az);
    if (axis.normalizeSafe() <= 0.0f) axis = PxVec3(0.0f, 1.0f, 0.0f);
    const PxTransform frame = worldFrame(PxVec3(px, py, pz), axis, perpendicularTo(axis));
    PxRigidActor* a = actorOf(bodyA);
    PxRigidActor* b = actorOf(bodyB);
    PxRevoluteJoint* joint = PxRevoluteJointCreate(px3::physics(), a, localFrame(a, frame), b, localFrame(b, frame));
    if (joint == nullptr) return 0;
    if (enableLimit != 0 && lowerAngle < upperAngle) {
        joint->setLimit(PxJointAngularLimitPair(lowerAngle, upperAngle));
        joint->setRevoluteJointFlag(PxRevoluteJointFlag::eLIMIT_ENABLED, true);
    }
    joint->setDriveForceLimit(maxTorque);
    if (enableMotor != 0) {
        joint->setRevoluteJointFlag(PxRevoluteJointFlag::eDRIVE_ENABLED, true);
        joint->setDriveVelocity(motorSpeed);
    }
    return adopt(entity, joint, JointKind::Hinge, collideConnected, maxTorque);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSliderJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                  float px, float py, float pz, float ax, float ay, float az,
                                  int enableLimit, float lower, float upper,
                                  int enableMotor, float motorSpeed, float maxForce,
                                  int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    PxVec3 axis(ax, ay, az);
    if (axis.normalizeSafe() <= 0.0f) axis = PxVec3(0.0f, 1.0f, 0.0f);
    PxD6Joint* joint = d6(bodyA, bodyB, worldFrame(PxVec3(px, py, pz), axis, perpendicularTo(axis)));
    if (joint == nullptr) return 0;
    const bool limited = enableLimit != 0 && lower < upper;
    joint->setMotion(PxD6Axis::eX, limited ? PxD6Motion::eLIMITED : PxD6Motion::eFREE);
    if (limited) joint->setLinearLimit(PxD6Axis::eX, PxJointLinearLimitPair(lower, upper, PxSpring(0.0f, 0.0f)));
    if (enableMotor != 0) {
        joint->setDrive(PxD6Drive::eX, motor(true, maxForce));
        joint->setDriveVelocity(PxVec3(motorSpeed, 0.0f, 0.0f), PxVec3(0.0f), true);
    }
    return adopt(entity, joint, JointKind::Slider, collideConnected, maxForce);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addDistanceJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                    float ax, float ay, float az, float bx, float by, float bz,
                                    float minLength, float maxLength, float frequency, float damping,
                                    int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    PxRigidActor* a = actorOf(bodyA);
    PxRigidActor* b = actorOf(bodyB);
    PxDistanceJoint* joint = PxDistanceJointCreate(px3::physics(),
        a, localFrame(a, PxTransform(PxVec3(ax, ay, az))), b, localFrame(b, PxTransform(PxVec3(bx, by, bz))));
    if (joint == nullptr) return 0;
    const float maxDistance = std::max(maxLength, minLength);
    joint->setMaxDistance(maxDistance);
    joint->setMinDistance(std::max(minLength, 0.0f));
    PxDistanceJointFlags flags = PxDistanceJointFlag::eMAX_DISTANCE_ENABLED;
    if (minLength > 0.0f) flags |= PxDistanceJointFlag::eMIN_DISTANCE_ENABLED;
    if (frequency > 0.0f) {
        // Jolt speaks in a frequency and a damping ratio; PhysX in a stiffness
        // and a damping, which need the mass the spring moves.
        float mass = 0.0f;
        float massA = 0.0f, massB = 0.0f;
        if (PxRigidDynamic* d = a->is<PxRigidDynamic>()) massA = d->getMass();
        if (PxRigidDynamic* d = b->is<PxRigidDynamic>()) massB = d->getMass();
        if (massA > 0.0f && massB > 0.0f) mass = massA * massB / (massA + massB);
        else mass = std::max(massA, massB);
        const float omega = 2.0f * PxPi * frequency;
        joint->setStiffness(mass * omega * omega);
        joint->setDamping(2.0f * mass * std::max(damping, 0.0f) * omega);
        flags |= PxDistanceJointFlag::eSPRING_ENABLED;
    }
    joint->setDistanceJointFlags(flags);
    return adopt(entity, joint, JointKind::Distance, collideConnected);
}

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addFixedJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB, int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    PxRigidActor* a = actorOf(bodyA);
    PxRigidActor* b = actorOf(bodyB);
    // The pose the two are in now IS the joint.
    const PxTransform frame = a->getGlobalPose();
    return adopt(entity, PxFixedJointCreate(px3::physics(), a, PxTransform(PxIdentity), b, localFrame(b, frame)),
                 JointKind::Fixed, collideConnected);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB) {
    if (g().joints.count(entity) == 0) return;
    release(entity);
    // A body held still by a joint has gone to sleep, and losing the joint does not wake it.
    wake(actorOf(bodyA));
    wake(actorOf(bodyB));
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setJointMotor(uint32_t entity, int enable, float speed) {
    auto found = g().joints.find(entity);
    if (found == g().joints.end()) return;
    if (found->second.kind == JointKind::Hinge) {
        auto* hinge = static_cast<PxRevoluteJoint*>(found->second.joint);
        hinge->setRevoluteJointFlag(PxRevoluteJointFlag::eDRIVE_ENABLED, enable != 0);
        hinge->setDriveVelocity(speed, true);
    } else if (found->second.kind == JointKind::Slider) {
        auto* slider = static_cast<PxD6Joint*>(found->second.joint);
        slider->setDrive(PxD6Drive::eX, motor(enable != 0, found->second.maxForce));
        slider->setDriveVelocity(PxVec3(speed, 0.0f, 0.0f), PxVec3(0.0f), true);
    }
}

EMSCRIPTEN_KEEPALIVE
float physics3d_jointValue(uint32_t entity) {
    auto found = g().joints.find(entity);
    if (found == g().joints.end()) return 0.0f;
    if (found->second.kind == JointKind::Hinge) {
        return static_cast<PxRevoluteJoint*>(found->second.joint)->getAngle();
    }
    if (found->second.kind == JointKind::Slider) {
        return found->second.joint->getRelativeTransform().p.x;
    }
    return 0.0f;
}

}  // extern "C"
