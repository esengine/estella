// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DConstraints.cpp
 * @brief   Joints: what holds two 3D bodies to each other.
 * @details A door, a rope, a lift, a ragdoll — none of them are a body and a shape,
 *          they are two bodies and a rule about how they may move relative to each
 *          other. Five rules cover almost all of it: a point they share, an axis
 *          they turn about, an axis they slide along, a distance they keep, and no
 *          freedom at all.
 *
 *          Anchors and axes arrive in WORLD space, taken at the moment the joint is
 *          made. That is also what sets the zero of every limit: both bodies are
 *          given the same reference axis, so "0" means the pose the scene was
 *          authored in and a door's limits read the way an author wrote them.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "./Physics3DContext.hpp"

#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/Collision/GroupFilter.h>
#include <Jolt/Physics/Constraints/DistanceConstraint.h>
#include <Jolt/Physics/Constraints/FixedConstraint.h>
#include <Jolt/Physics/Constraints/HingeConstraint.h>
#include <Jolt/Physics/Constraints/PointConstraint.h>
#include <Jolt/Physics/Constraints/SliderConstraint.h>

#include <algorithm>
#include <cmath>

using namespace JPH;
using esengine::physics3d::Context;

namespace {

Context& g() { return esengine::physics3d::ctx(); }

/// Bodies in one assembly ignore each other. Jolt filters collision per body, so
/// "this joint's two ends do not collide" can only be said as a group they share.
class AssemblyGroupFilter final : public GroupFilter {
public:
    bool CanCollide(const CollisionGroup& a, const CollisionGroup& b) const override {
        if (a.GetGroupID() == CollisionGroup::cInvalidGroup
            || b.GetGroupID() == CollisionGroup::cInvalidGroup) {
            return true;
        }
        return a.GetGroupID() != b.GetGroupID();
    }
};

GroupFilter* assemblyFilter() {
    static Ref<GroupFilter> instance = new AssemblyGroupFilter();
    return instance;
}

void writeGroup(uint32_t body, uint32_t group) {
    BodyLockWrite lock(g().system->GetBodyLockInterface(), BodyID(body));
    if (!lock.Succeeded()) return;
    lock.GetBody().SetCollisionGroup(group == 0
        ? CollisionGroup()
        : CollisionGroup(assemblyFilter(), group, static_cast<CollisionGroup::SubGroupID>(body)));
}

/// Put both bodies in one assembly, merging the groups they were already in: a
/// chain built joint by joint has to end up as ONE group, or its first and third
/// links would still collide.
void joinAssembly(uint32_t a, uint32_t b) {
    Context& c = g();
    const auto ga = c.jointGroupOf.find(a);
    const auto gb = c.jointGroupOf.find(b);
    uint32_t group = 0;
    if (ga == c.jointGroupOf.end() && gb == c.jointGroupOf.end()) {
        group = c.nextJointGroup++;
    } else if (ga == c.jointGroupOf.end()) {
        group = gb->second;
    } else if (gb == c.jointGroupOf.end()) {
        group = ga->second;
    } else if (ga->second != gb->second) {
        group = ga->second;
        const uint32_t old = gb->second;
        for (const uint32_t member : c.jointGroupMembers[old]) {
            c.jointGroupOf[member] = group;
            c.jointGroupMembers[group].push_back(member);
            writeGroup(member, group);
        }
        c.jointGroupMembers.erase(old);
    } else {
        group = ga->second;
    }
    for (const uint32_t body : {a, b}) {
        if (c.jointGroupOf[body] != group || c.jointHolds[body] == 0) {
            c.jointGroupOf[body] = group;
            std::vector<uint32_t>& members = c.jointGroupMembers[group];
            if (std::find(members.begin(), members.end(), body) == members.end()) {
                members.push_back(body);
            }
            writeGroup(body, group);
        }
        c.jointHolds[body] += 1;
    }
}

/// The reverse: a body whose last joint is gone collides with its siblings again.
void leaveAssembly(uint32_t body) {
    Context& c = g();
    const auto hold = c.jointHolds.find(body);
    if (hold == c.jointHolds.end()) return;
    if (hold->second > 1) { hold->second -= 1; return; }
    c.jointHolds.erase(hold);
    const auto group = c.jointGroupOf.find(body);
    if (group != c.jointGroupOf.end()) {
        std::vector<uint32_t>& members = c.jointGroupMembers[group->second];
        members.erase(std::remove(members.begin(), members.end(), body), members.end());
        if (members.empty()) c.jointGroupMembers.erase(group->second);
        c.jointGroupOf.erase(group);
    }
    writeGroup(body, 0);
}

/// Any unit vector at right angles to `v` — the reference the limits measure from.
/// Both bodies are given the same one, so the pose at creation reads as zero.
Vec3 perpendicularTo(Vec3Arg v) {
    const Vec3 axis = v.NormalizedOr(Vec3::sAxisY());
    const Vec3 other = std::abs(axis.GetY()) < 0.9f ? Vec3::sAxisY() : Vec3::sAxisX();
    return axis.Cross(other).NormalizedOr(Vec3::sAxisX());
}

/// Register a built constraint under the entity that authored it, replacing
/// whatever that entity had before.
uint32_t adopt(uint32_t entity, TwoBodyConstraint* constraint,
               uint32_t bodyA, uint32_t bodyB, int collideConnected) {
    if (constraint == nullptr) return 0;
    g().system->AddConstraint(constraint);
    g().constraints[entity] = constraint;
    if (collideConnected == 0) joinAssembly(bodyA, bodyB);
    return 1;
}

/// Both bodies, or nothing: a joint to a body that is not in the world yet has no
/// meaning, and the SDK retries on a later step once it is.
bool bothLive(uint32_t bodyA, uint32_t bodyB) {
    if (!g().isValid()) return false;
    const BodyLockInterface& lock = g().system->GetBodyLockInterface();
    BodyLockRead a(lock, BodyID(bodyA));
    BodyLockRead b(lock, BodyID(bodyB));
    return a.Succeeded() && b.Succeeded();
}

void applyMotor(MotorSettings& motor, float maxForceOrTorque) {
    motor.mSpringSettings.mFrequency = 20.0f;
    motor.mSpringSettings.mDamping = 1.0f;
    motor.SetForceLimit(maxForceOrTorque);
    motor.SetTorqueLimit(maxForceOrTorque);
}

}  // namespace

extern "C" {

/// A shared point, free to turn on all three axes — a chain link, a ragdoll limb.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addPointJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 float px, float py, float pz, int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    PointConstraintSettings settings;
    settings.mSpace = EConstraintSpace::WorldSpace;
    settings.mPoint1 = settings.mPoint2 = RVec3(px, py, pz);
    return adopt(entity,
                 g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB)),
                 bodyA, bodyB, collideConnected);
}

/// One axis of rotation, optionally limited and optionally driven — a door, a
/// lever, a wheel with a motor.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addHingeJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 float px, float py, float pz,
                                 float ax, float ay, float az,
                                 int enableLimit, float lowerAngle, float upperAngle,
                                 int enableMotor, float motorSpeed, float maxTorque,
                                 int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    const Vec3 axis = Vec3(ax, ay, az).NormalizedOr(Vec3::sAxisY());
    const Vec3 normal = perpendicularTo(axis);
    HingeConstraintSettings settings;
    settings.mSpace = EConstraintSpace::WorldSpace;
    settings.mPoint1 = settings.mPoint2 = RVec3(px, py, pz);
    settings.mHingeAxis1 = settings.mHingeAxis2 = axis;
    settings.mNormalAxis1 = settings.mNormalAxis2 = normal;
    if (enableLimit != 0) {
        settings.mLimitsMin = lowerAngle;
        settings.mLimitsMax = upperAngle;
    }
    if (enableMotor != 0) applyMotor(settings.mMotorSettings, maxTorque);
    TwoBodyConstraint* constraint =
        g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB));
    if (constraint != nullptr && enableMotor != 0) {
        auto* hinge = static_cast<HingeConstraint*>(constraint);
        hinge->SetMotorState(EMotorState::Velocity);
        hinge->SetTargetAngularVelocity(motorSpeed);
    }
    return adopt(entity, constraint, bodyA, bodyB, collideConnected);
}

/// One axis of travel — a lift, a piston, a sliding door.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSliderJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                  float px, float py, float pz,
                                  float ax, float ay, float az,
                                  int enableLimit, float lower, float upper,
                                  int enableMotor, float motorSpeed, float maxForce,
                                  int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    const Vec3 axis = Vec3(ax, ay, az).NormalizedOr(Vec3::sAxisY());
    const Vec3 normal = perpendicularTo(axis);
    SliderConstraintSettings settings;
    settings.mSpace = EConstraintSpace::WorldSpace;
    settings.mPoint1 = settings.mPoint2 = RVec3(px, py, pz);
    settings.mSliderAxis1 = settings.mSliderAxis2 = axis;
    settings.mNormalAxis1 = settings.mNormalAxis2 = normal;
    if (enableLimit != 0) {
        settings.mLimitsMin = lower;
        settings.mLimitsMax = upper;
    }
    if (enableMotor != 0) applyMotor(settings.mMotorSettings, maxForce);
    TwoBodyConstraint* constraint =
        g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB));
    if (constraint != nullptr && enableMotor != 0) {
        auto* slider = static_cast<SliderConstraint*>(constraint);
        slider->SetMotorState(EMotorState::Velocity);
        slider->SetTargetVelocity(motorSpeed);
    }
    return adopt(entity, constraint, bodyA, bodyB, collideConnected);
}

/// A distance kept between two points — a rope (max only), a rod (min = max), or
/// a spring when a frequency is given.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addDistanceJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                    float ax, float ay, float az,
                                    float bx, float by, float bz,
                                    float minLength, float maxLength,
                                    float frequency, float damping,
                                    int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    DistanceConstraintSettings settings;
    settings.mSpace = EConstraintSpace::WorldSpace;
    settings.mPoint1 = RVec3(ax, ay, az);
    settings.mPoint2 = RVec3(bx, by, bz);
    settings.mMinDistance = minLength;
    settings.mMaxDistance = std::max(maxLength, minLength);
    if (frequency > 0.0f) {
        settings.mLimitsSpringSettings.mFrequency = frequency;
        settings.mLimitsSpringSettings.mDamping = damping;
    }
    return adopt(entity,
                 g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB)),
                 bodyA, bodyB, collideConnected);
}

/// No freedom at all: the two move as one, until something breaks them apart.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addFixedJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
                                 int collideConnected) {
    if (!bothLive(bodyA, bodyB)) return 0;
    FixedConstraintSettings settings;
    // The pose the two are in right now IS the joint — an author places the pieces
    // and the joint holds them there, rather than snapping them somewhere else.
    settings.mAutoDetectPoint = true;
    return adopt(entity,
                 g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB)),
                 bodyA, bodyB, collideConnected);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end()) return;
    g().system->RemoveConstraint(it->second);
    g().constraints.erase(it);
    leaveAssembly(bodyA);
    leaveAssembly(bodyB);
    // A body held still by a joint falls asleep, and losing the joint is not an
    // event that wakes it: without this it hangs exactly where the joint left it.
    BodyInterface& bodies = g().system->GetBodyInterface();
    bodies.ActivateBody(BodyID(bodyA));
    bodies.ActivateBody(BodyID(bodyB));
}

/// Drive an existing hinge or slider from gameplay, without rebuilding the joint.
EMSCRIPTEN_KEEPALIVE
void physics3d_setJointMotor(uint32_t entity, int enable, float speed) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end()) return;
    Constraint* constraint = it->second;
    const EMotorState state = enable != 0 ? EMotorState::Velocity : EMotorState::Off;
    // The module is built without RTTI, so the kind comes from Jolt's own tag.
    switch (constraint->GetSubType()) {
        case EConstraintSubType::Hinge: {
            auto* hinge = static_cast<HingeConstraint*>(constraint);
            hinge->SetMotorState(state);
            hinge->SetTargetAngularVelocity(speed);
            break;
        }
        case EConstraintSubType::Slider: {
            auto* slider = static_cast<SliderConstraint*>(constraint);
            slider->SetMotorState(state);
            slider->SetTargetVelocity(speed);
            break;
        }
        default: break;
    }
}

/// What the joint is at right now — a hinge's angle, a slider's travel — so a
/// game can watch a door swing without integrating it a second time.
EMSCRIPTEN_KEEPALIVE
float physics3d_jointValue(uint32_t entity) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end()) return 0.0f;
    Constraint* constraint = it->second;
    switch (constraint->GetSubType()) {
        case EConstraintSubType::Hinge:
            return static_cast<HingeConstraint*>(constraint)->GetCurrentAngle();
        case EConstraintSubType::Slider:
            return static_cast<SliderConstraint*>(constraint)->GetCurrentPosition();
        default: return 0.0f;
    }
}

}  // extern "C"
