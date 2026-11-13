// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DConstraints.cpp
 * @brief   Joints: what holds two 3D bodies to each other.
 * @details A door, a rope, a lift, a ragdoll — none of them are a body and a shape,
 *          they are two bodies and a rule about how they may move relative to each
 *          other. Basic rules include a point they share, an axis
 *          they turn about, an axis they slide along, a distance they keep, and no
 *          freedom at all. Swing/twist and six-axis constraints add per-axis limits.
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
#include <Jolt/Physics/Constraints/SwingTwistConstraint.h>
#include <Jolt/Physics/Constraints/SixDOFConstraint.h>

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

/// A hinge's limits as Jolt can hold them: within a half turn either way and never excluding the pose it was made in.
static void hingeRange(float lower, float upper, float& outMin, float& outMax) {
    outMin = std::clamp(std::min(lower, 0.0f), -JPH_PI, 0.0f);
    outMax = std::clamp(std::max(upper, 0.0f), 0.0f, JPH_PI);
}

bool finiteVector(Vec3Arg v) {
    return std::isfinite(v.GetX()) && std::isfinite(v.GetY()) && std::isfinite(v.GetZ());
}

bool referenceFrame(Vec3Arg x, Vec3Arg y, Vec3& outX, Vec3& outY) {
    if (!finiteVector(x) || !finiteVector(y) || !std::isfinite(x.LengthSq())
        || !std::isfinite(y.LengthSq()) || x.LengthSq() < 1.0e-12f || y.LengthSq() < 1.0e-12f) return false;
    outX = x.Normalized();
    const Vec3 normal = y - outX * outX.Dot(y);
    if (normal.LengthSq() < 1.0e-10f * y.LengthSq()) return false;
    outY = normal.Normalized();
    return true;
}

}  // namespace

extern "C" {

/// Both frames coincide at creation, so limits are relative to the authored pose.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSwingTwistJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
    float px, float py, float pz, float ax, float ay, float az,
    float nx, float ny, float nz, float normalHalf, float planeHalf,
    float twistMin, float twistMax, int collideConnected) {
    if (bodyA == bodyB || !bothLive(bodyA, bodyB) || g().constraints.count(entity) != 0) return 0;
    Vec3 x, y;
    if (!referenceFrame(Vec3(ax, ay, az), Vec3(nx, ny, nz), x, y)
        || !finiteVector(Vec3(px, py, pz))
        || !std::isfinite(normalHalf) || !std::isfinite(planeHalf)
        || !std::isfinite(twistMin) || !std::isfinite(twistMax)
        || normalHalf < 0 || normalHalf > JPH_PI || planeHalf < 0 || planeHalf > JPH_PI
        || twistMin < -JPH_PI || twistMax > JPH_PI || twistMin > twistMax) return 0;
    SwingTwistConstraintSettings settings;
    settings.mSpace = EConstraintSpace::WorldSpace;
    settings.mPosition1 = settings.mPosition2 = RVec3(px, py, pz);
    settings.mTwistAxis1 = settings.mTwistAxis2 = x;
    settings.mPlaneAxis1 = settings.mPlaneAxis2 = x.Cross(y);
    settings.mNormalHalfConeAngle = normalHalf;
    settings.mPlaneHalfConeAngle = planeHalf;
    settings.mTwistMinAngle = twistMin;
    settings.mTwistMaxAngle = twistMax;
    return adopt(entity,
        g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB)),
        bodyA, bodyB, collideConnected);
}

/// Axis motion is packed as two bits per axis: 0 locked, 1 limited, 2 free.
EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addSixDOFJoint(uint32_t entity, uint32_t bodyA, uint32_t bodyB,
    float px, float py, float pz, float ax, float ay, float az, float nx, float ny, float nz,
    int translationMotion, int rotationMotion,
    float lx, float ly, float lz, float hx, float hy, float hz,
    float rx, float ry, float rz, float sx, float sy, float sz, int collideConnected) {
    if (bodyA == bodyB || !bothLive(bodyA, bodyB) || g().constraints.count(entity) != 0) return 0;
    Vec3 x, y;
    if (!referenceFrame(Vec3(ax, ay, az), Vec3(nx, ny, nz), x, y)
        || !finiteVector(Vec3(px, py, pz))
        || translationMotion < 0 || translationMotion > 63 || rotationMotion < 0 || rotationMotion > 63) return 0;
    SixDOFConstraintSettings settings;
    settings.mSpace = EConstraintSpace::WorldSpace;
    settings.mSwingType = ESwingType::Pyramid;
    settings.mPosition1 = settings.mPosition2 = RVec3(px, py, pz);
    settings.mAxisX1 = settings.mAxisX2 = x;
    settings.mAxisY1 = settings.mAxisY2 = y;
    const float lower[] = {lx, ly, lz, rx, ry, rz};
    const float upper[] = {hx, hy, hz, sx, sy, sz};
    for (int i = 0; i < 6; ++i) {
        const auto axis = static_cast<SixDOFConstraintSettings::EAxis>(i);
        const int mode = ((i < 3 ? translationMotion : rotationMotion) >> (2 * (i % 3))) & 3;
        if (!std::isfinite(lower[i]) || !std::isfinite(upper[i]) || mode == 3) return 0;
        if (mode == 0) settings.MakeFixedAxis(axis);
        else if (mode == 2) settings.MakeFreeAxis(axis);
        else {
            if (lower[i] >= upper[i] || (i >= 3 && (lower[i] < -JPH_PI || upper[i] > JPH_PI))) return 0;
            settings.SetLimitedAxis(axis, lower[i], upper[i]);
        }
    }
    return adopt(entity,
        g().system->GetBodyInterface().CreateConstraint(&settings, BodyID(bodyA), BodyID(bodyB)),
        bodyA, bodyB, collideConnected);
}

/// Live velocity/force changes do not rebuild the joint or reset its zero pose.
EMSCRIPTEN_KEEPALIVE
void physics3d_setAdvancedJointMotor(uint32_t entity, int enable,
    float vx, float vy, float vz, float wx, float wy, float wz, float maxForce, float maxTorque) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end() || !finiteVector(Vec3(vx, vy, vz)) || !finiteVector(Vec3(wx, wy, wz))
        || !std::isfinite(maxForce) || maxForce < 0 || !std::isfinite(maxTorque) || maxTorque < 0) return;
    TwoBodyConstraint* constraint = it->second;
    const EMotorState state = enable != 0 ? EMotorState::Velocity : EMotorState::Off;
    if (constraint->GetSubType() == EConstraintSubType::SwingTwist) {
        auto* joint = static_cast<SwingTwistConstraint*>(constraint);
        applyMotor(joint->GetSwingMotorSettings(), maxTorque);
        applyMotor(joint->GetTwistMotorSettings(), maxTorque);
        joint->SetSwingMotorState(state);
        joint->SetTwistMotorState(state);
        joint->SetTargetAngularVelocityCS(Vec3(wx, wy, wz));
    } else if (constraint->GetSubType() == EConstraintSubType::SixDOF) {
        auto* joint = static_cast<SixDOFConstraint*>(constraint);
        for (int i = 0; i < 6; ++i) {
            const auto axis = static_cast<SixDOFConstraintSettings::EAxis>(i);
            applyMotor(joint->GetMotorSettings(axis), i < 3 ? maxForce : maxTorque);
            if (!joint->IsFixedAxis(axis)) joint->SetMotorState(axis, state);
        }
        joint->SetTargetVelocityCS(Vec3(vx, vy, vz));
        joint->SetTargetAngularVelocityCS(Vec3(wx, wy, wz));
    } else return;
    g().system->GetBodyInterface().ActivateBody(constraint->GetBody1()->GetID());
    g().system->GetBodyInterface().ActivateBody(constraint->GetBody2()->GetID());
}

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
    if (enableLimit != 0) hingeRange(lowerAngle, upperAngle, settings.mLimitsMin, settings.mLimitsMax);
    // Always: a motor turned on later is held to the same torque as one that started on.
    applyMotor(settings.mMotorSettings, maxTorque);
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
        settings.mLimitsMin = std::min(lower, 0.0f);
        settings.mLimitsMax = std::max(upper, 0.0f);
    }
    applyMotor(settings.mMotorSettings, maxForce);
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

/// A joint changed under two sleeping bodies does nothing until they wake: they are woken.
static void wakeEnds(Constraint* constraint) {
    if (constraint->GetType() != EConstraintType::TwoBodyConstraint) return;
    auto* two = static_cast<TwoBodyConstraint*>(constraint);
    BodyInterface& bodies = g().system->GetBodyInterface();
    bodies.ActivateBody(two->GetBody1()->GetID());
    bodies.ActivateBody(two->GetBody2()->GetID());
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

EMSCRIPTEN_KEEPALIVE
void physics3d_setJointLimits(uint32_t entity, int enable, float lower, float upper) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end() || !std::isfinite(lower) || !std::isfinite(upper)) return;
    Constraint* constraint = it->second;
    switch (constraint->GetSubType()) {
        case EConstraintSubType::Hinge: {
            float lo = -JPH_PI, hi = JPH_PI;
            if (enable != 0) hingeRange(lower, upper, lo, hi);
            static_cast<HingeConstraint*>(constraint)->SetLimits(lo, hi);
            break;
        }
        case EConstraintSubType::Slider:
            if (enable != 0) static_cast<SliderConstraint*>(constraint)->SetLimits(std::min(lower, 0.0f), std::max(upper, 0.0f));
            else static_cast<SliderConstraint*>(constraint)->SetLimits(-FLT_MAX, FLT_MAX);
            break;
        default: return;
    }
    wakeEnds(constraint);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setJointMotorLimit(uint32_t entity, float limit) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end() || !std::isfinite(limit) || limit < 0.0f) return;
    Constraint* constraint = it->second;
    switch (constraint->GetSubType()) {
        case EConstraintSubType::Hinge: applyMotor(static_cast<HingeConstraint*>(constraint)->GetMotorSettings(), limit); break;
        case EConstraintSubType::Slider: applyMotor(static_cast<SliderConstraint*>(constraint)->GetMotorSettings(), limit); break;
        default: return;
    }
    wakeEnds(constraint);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setDistanceJoint(uint32_t entity, float minLength, float maxLength, float frequency, float damping) {
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end() || it->second->GetSubType() != EConstraintSubType::Distance) return;
    if (!std::isfinite(minLength) || !std::isfinite(maxLength) || !std::isfinite(frequency) || !std::isfinite(damping)) return;
    auto* distance = static_cast<DistanceConstraint*>(it->second.GetPtr());
    const float lo = std::max(minLength, 0.0f);
    distance->SetDistance(lo, std::max(maxLength, lo));
    SpringSettings& spring = distance->GetLimitsSpringSettings();
    spring.mFrequency = std::max(frequency, 0.0f);
    spring.mDamping = std::max(damping, 0.0f);
    wakeEnds(it->second.GetPtr());
}

EMSCRIPTEN_KEEPALIVE
int physics3d_jointForce(uint32_t entity) {
    g().queryBuffer.clear();
    const auto it = g().constraints.find(entity);
    if (it == g().constraints.end()) return 0;
    Constraint* constraint = it->second.GetPtr();
    // Jolt keeps what each part of a constraint applied over the step as an impulse; over the step's length it is the
    // force the part held with.
    float linear = 0.0f, angular = 0.0f;
    switch (constraint->GetSubType()) {
        case EConstraintSubType::Point:
            linear = static_cast<PointConstraint*>(constraint)->GetTotalLambdaPosition().Length();
            break;
        case EConstraintSubType::Hinge: {
            auto* c = static_cast<HingeConstraint*>(constraint);
            const Vector<2> r = c->GetTotalLambdaRotation();
            linear = c->GetTotalLambdaPosition().Length();
            angular = std::sqrt(r[0] * r[0] + r[1] * r[1]) + std::abs(c->GetTotalLambdaRotationLimits());
            break;
        }
        case EConstraintSubType::Slider: {
            auto* c = static_cast<SliderConstraint*>(constraint);
            const Vector<2> p = c->GetTotalLambdaPosition();
            linear = std::sqrt(p[0] * p[0] + p[1] * p[1]) + std::abs(c->GetTotalLambdaPositionLimits());
            angular = c->GetTotalLambdaRotation().Length();
            break;
        }
        case EConstraintSubType::Distance:
            linear = std::abs(static_cast<DistanceConstraint*>(constraint)->GetTotalLambdaPosition());
            break;
        case EConstraintSubType::Fixed: {
            auto* c = static_cast<FixedConstraint*>(constraint);
            linear = c->GetTotalLambdaPosition().Length();
            angular = c->GetTotalLambdaRotation().Length();
            break;
        }
        case EConstraintSubType::SwingTwist: {
            auto* c = static_cast<SwingTwistConstraint*>(constraint);
            linear = c->GetTotalLambdaPosition().Length();
            angular = Vec3(c->GetTotalLambdaTwist(), c->GetTotalLambdaSwingY(), c->GetTotalLambdaSwingZ()).Length();
            break;
        }
        case EConstraintSubType::SixDOF: {
            auto* c = static_cast<SixDOFConstraint*>(constraint);
            linear = c->GetTotalLambdaPosition().Length();
            angular = c->GetTotalLambdaRotation().Length();
            break;
        }
        default: break;
    }
    const float step = g().solverStep > 0.0f ? g().solverStep : 1.0f / 60.0f;
    g().queryBuffer = {linear / step, angular / step};
    return 1;
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
