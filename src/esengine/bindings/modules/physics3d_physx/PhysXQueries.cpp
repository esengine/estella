// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysXQueries.cpp
 * @brief   Characters and scene queries for the PhysX backend.
 * @details A character is a PhysX capsule controller: swept, not solved, like
 *          Jolt's CharacterVirtual and like Unity's CharacterController, which
 *          is this same controller. The query layouts are the Jolt module's.
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
using esengine::physics3d_physx::Character;
using esengine::physics3d_physx::World;
namespace px3 = esengine::physics3d_physx;

namespace {

World& g() { return px3::world(); }

/// Restricts a query to the layers a caller named; a zero mask means every
/// layer, as in the Jolt backend. Rays and sweeps pass through characters (a
/// Jolt character is not in the world for them to meet); overlaps find them.
class LayerFilter final : public PxQueryFilterCallback {
public:
    LayerFilter(uint32_t mask, bool characters, const PxRigidActor* ignore = nullptr, bool touch = false)
        : mask_(mask == 0 ? 0xFFFFFFFFu : mask), characters_(characters), ignore_(ignore), touch_(touch) {}
    PxQueryHitType::Enum preFilter(const PxFilterData&, const PxShape* shape, const PxRigidActor* actor,
                                   PxHitFlags&) override {
        if (actor == ignore_) return PxQueryHitType::eNONE;
        const PxFilterData data = shape->getQueryFilterData();
        if ((mask_ & (1u << data.word0)) == 0) return PxQueryHitType::eNONE;
        if (!characters_ && (data.word1 & px3::KIND_CHARACTER) != 0) return PxQueryHitType::eNONE;
        return touch_ ? PxQueryHitType::eTOUCH : PxQueryHitType::eBLOCK;
    }
    PxQueryHitType::Enum postFilter(const PxFilterData&, const PxQueryHit&, const PxShape*,
                                    const PxRigidActor*) override {
        return touch_ ? PxQueryHitType::eTOUCH : PxQueryHitType::eBLOCK;
    }
private:
    uint32_t mask_;
    bool characters_;
    const PxRigidActor* ignore_;
    bool touch_;
};

PxQueryFilterData queryData(bool touch = false) {
    PxQueryFilterData data;
    data.flags = PxQueryFlag::eSTATIC | PxQueryFlag::eDYNAMIC | PxQueryFlag::ePREFILTER;
    if (touch) data.flags |= PxQueryFlag::eNO_BLOCK;
    return data;
}

PxVec3 toVec(const PxExtendedVec3& v) {
    return PxVec3(static_cast<float>(v.x), static_cast<float>(v.y), static_cast<float>(v.z));
}

/// What a character's sweep may meet: its own layers, never its own actor and
/// never a trigger (a trigger is walked through, and reports it).
class CharacterFilter final : public PxQueryFilterCallback {
public:
    CharacterFilter(uint32_t layer, const PxRigidActor* self) : layer_(layer), self_(self) {}
    PxQueryHitType::Enum preFilter(const PxFilterData&, const PxShape* shape, const PxRigidActor* actor,
                                   PxHitFlags&) override {
        if (actor == self_) return PxQueryHitType::eNONE;
        if (shape->getFlags() & PxShapeFlag::eTRIGGER_SHAPE) return PxQueryHitType::eNONE;
        if (!g().collide(layer_, shape->getQueryFilterData().word0)) return PxQueryHitType::eNONE;
        return PxQueryHitType::eBLOCK;
    }
    PxQueryHitType::Enum postFilter(const PxFilterData&, const PxQueryHit&, const PxShape*,
                                    const PxRigidActor*) override {
        return PxQueryHitType::eBLOCK;
    }
private:
    uint32_t layer_;
    const PxRigidActor* self_;
};

/// Collects, during one move, the ground under the character and pushes what
/// it walks into — with no more force than its push strength, as Jolt's
/// character spends at most its mMaxStrength.
class HitReport final : public PxUserControllerHitReport {
public:
    Character* moving = nullptr;
    float dt = 0.0f;
    float bestUp = -2.0f;
    PxVec3 bestNormal{0.0f};

    void onShapeHit(const PxControllerShapeHit& hit) override {
        const float up = hit.worldNormal.y;
        if (up > bestUp) { bestUp = up; bestNormal = hit.worldNormal; }
        if (moving == nullptr || !(moving->pushForce > 0.0f) || hit.actor == nullptr) return;
        PxRigidDynamic* dynamic = hit.actor->is<PxRigidDynamic>();
        if (dynamic == nullptr || (dynamic->getRigidBodyFlags() & PxRigidBodyFlag::eKINEMATIC)) return;
        PxVec3 push(-hit.worldNormal.x, 0.0f, -hit.worldNormal.z);  // never into the floor
        if (push.normalizeSafe() <= 0.0f || !(dt > 0.0f)) return;
        // What it takes for the body to keep pace with the character along the
        // push, and no more than the push strength gives over one step: the
        // contact Jolt's character solves, with its mMaxStrength as the cap.
        const float walking = hit.dir.dot(push) * hit.length / dt;
        const float need = walking - dynamic->getLinearVelocity().dot(push);
        const float mass = dynamic->getMass();
        if (!(need > 0.0f) || !(mass > 0.0f)) return;
        const float dv = std::min(need, moving->pushForce * dt / mass);
        const PxVec3 at(static_cast<float>(hit.worldPos.x), static_cast<float>(hit.worldPos.y),
                        static_cast<float>(hit.worldPos.z));
        PxRigidBodyExt::addForceAtPos(*dynamic, push * (dv * mass), at, PxForceMode::eIMPULSE, true);
    }
    void onControllerHit(const PxControllersHit& hit) override {
        if (hit.worldNormal.y > bestUp) { bestUp = hit.worldNormal.y; bestNormal = hit.worldNormal; }
    }
    void onObstacleHit(const PxControllerObstacleHit&) override {}
};

HitReport& hitReport() { static HitReport r; return r; }

/// Only bodies that move, in the character's layers, and never itself.
class MovableFilter final : public PxQueryFilterCallback {
public:
    MovableFilter(uint32_t layer, const PxRigidActor* self) : layer_(layer), self_(self) {}
    PxQueryHitType::Enum preFilter(const PxFilterData&, const PxShape* shape, const PxRigidActor* actor,
                                   PxHitFlags&) override {
        if (actor == self_ || (shape->getFlags() & PxShapeFlag::eTRIGGER_SHAPE)) return PxQueryHitType::eNONE;
        const PxRigidDynamic* dynamic = actor->is<PxRigidDynamic>();
        if (dynamic == nullptr || (dynamic->getRigidBodyFlags() & PxRigidBodyFlag::eKINEMATIC)) {
            return PxQueryHitType::eNONE;
        }
        const PxFilterData data = shape->getQueryFilterData();
        if ((data.word1 & px3::KIND_CHARACTER) != 0 || !g().collide(layer_, data.word0)) return PxQueryHitType::eNONE;
        return PxQueryHitType::eBLOCK;
    }
    PxQueryHitType::Enum postFilter(const PxFilterData&, const PxQueryHit&, const PxShape*,
                                    const PxRigidActor*) override {
        return PxQueryHitType::eBLOCK;
    }
private:
    uint32_t layer_;
    const PxRigidActor* self_;
};

/// Whether walking `horizontal` runs the character into a body that moves. Such
/// a move gets no autostep: stepping lifts the capsule first, and from there a
/// crate's top edge is a slope (PhysX holds the slope limit to static geometry
/// only), so the character would ride over what it should push.
bool movableAhead(PxController& controller, uint32_t layer, const PxVec3& horizontal) {
    PxVec3 dir = horizontal;
    const float length = dir.normalizeSafe();
    if (!(length > 0.0f)) return false;
    auto& capsule = static_cast<PxCapsuleController&>(controller);
    const PxCapsuleGeometry geometry(capsule.getRadius() + capsule.getContactOffset(), 0.5f * capsule.getHeight());
    const PxTransform pose(toVec(controller.getPosition()), PxQuat(PxHalfPi, PxVec3(0.0f, 0.0f, 1.0f)));
    PxSweepBuffer hit;
    MovableFilter filter(layer, controller.getActor());
    PxQueryFilterData data;
    data.flags = PxQueryFlag::eDYNAMIC | PxQueryFlag::ePREFILTER;
    return g().scene->sweep(geometry, pose, dir, length + capsule.getContactOffset(), hit,
                            PxHitFlag::eDEFAULT, data, &filter) && hit.hasBlock;
}

/// A character slides off a body that moves rather than standing on it: PhysX
/// applies the slope limit to static geometry only, so without this every crate
/// edge is a slope it can walk up — the "CharacterController climbs rigidbodies"
/// Unity projects work around. A crate is pushed, as in the Jolt backend.
class Behavior final : public PxControllerBehaviorCallback {
public:
    PxControllerBehaviorFlags getBehaviorFlags(const PxShape&, const PxActor& actor) override {
        const PxRigidDynamic* dynamic = actor.is<PxRigidDynamic>();
        if (dynamic && !(dynamic->getRigidBodyFlags() & PxRigidBodyFlag::eKINEMATIC)) {
            return PxControllerBehaviorFlag::eCCT_SLIDE;
        }
        return PxControllerBehaviorFlag::eCCT_CAN_RIDE_ON_OBJECT;
    }
    PxControllerBehaviorFlags getBehaviorFlags(const PxController&) override {
        return PxControllerBehaviorFlags(0);
    }
    PxControllerBehaviorFlags getBehaviorFlags(const PxObstacle&) override {
        return PxControllerBehaviorFlag::eCCT_CAN_RIDE_ON_OBJECT;
    }
};

Behavior& behavior() { static Behavior b; return b; }

void pushHit(uint32_t entity, const PxVec3& point) {
    g().queryBuffer.insert(g().queryBuffer.end(), {static_cast<float>(entity), point.x, point.y, point.z});
}

/// Everything overlapping `geometry` at `center`, into the query buffer.
int overlap(const PxGeometry& geometry, const PxVec3& center, uint32_t layerMask) {
    g().queryBuffer.clear();
    if (!g().isValid()) return 0;
    PxOverlapHit hits[256];
    PxOverlapBuffer buffer(hits, 256);
    LayerFilter filter(layerMask, true, nullptr, true);
    if (!g().scene->overlap(geometry, PxTransform(center), buffer, queryData(true), &filter)) return 0;
    const PxU32 count = buffer.getNbTouches();
    for (PxU32 i = 0; i < count; ++i) {
        const PxOverlapHit& hit = buffer.getTouch(i);
        // The point on the hit shape nearest the query, as Jolt reports the
        // contact point on the body it found; the centre when it is inside.
        PxVec3 closest = center;
        const PxTransform pose = PxShapeExt::getGlobalPose(*hit.shape, *hit.actor);
        if (PxGeometryQuery::pointDistance(center, hit.shape->getGeometry(), pose, &closest) <= 0.0f) {
            closest = center;
        }
        pushHit(px3::entityOf(hit.actor), closest);
    }
    return static_cast<int>(count);
}

}  // namespace

extern "C" {

// Characters

EMSCRIPTEN_KEEPALIVE
uint32_t physics3d_addCharacter(uint32_t entity, float radius, float halfHeight,
                                float px, float py, float pz, float maxSlope, float mass,
                                uint32_t layer, float pushForce) {
    (void)mass;
    if (!g().isValid() || g().controllers == nullptr || !(radius > 0.0f)) return 0;
    PxCapsuleControllerDesc desc;
    desc.radius = radius;
    desc.height = std::max(2.0f * halfHeight, 1.0e-3f);
    desc.position = PxExtendedVec3(px, py, pz);
    desc.upDirection = PxVec3(0.0f, 1.0f, 0.0f);
    desc.slopeLimit = std::cos(std::clamp(maxSlope, 0.0f, PxHalfPi));
    desc.stepOffset = 0.0f;  // set per move, from the caller's step height
    // Unity's guidance for skin width: a tenth of the radius.
    desc.contactOffset = std::max(0.1f * radius, 1.0e-3f);
    desc.material = px3::defaultMaterial();
    desc.climbingMode = PxCapsuleClimbingMode::eCONSTRAINED;
    desc.reportCallback = &hitReport();
    desc.behaviorCallback = &behavior();
    if (!desc.isValid()) return 0;
    PxController* controller = g().controllers->createController(desc);
    if (controller == nullptr) return 0;

    auto character = std::make_unique<Character>();
    character->controller = controller;
    character->entity = entity;
    character->layer = layer;
    character->pushForce = pushForce;
    character->body = std::make_unique<Body>();
    character->body->entity = entity;
    character->body->layer = layer;
    character->body->character = true;
    PxRigidDynamic* actor = controller->getActor();
    character->body->actor = actor;
    actor->userData = character->body.get();
    PxShape* shape = nullptr;
    if (actor->getShapes(&shape, 1) == 1 && shape != nullptr) {
        PxFilterData data;
        data.word0 = layer;
        data.word1 = px3::KIND_CHARACTER;
        shape->setSimulationFilterData(data);
        shape->setQueryFilterData(data);
    }
    const uint32_t id = g().nextCharacterId++;
    g().characters[id] = std::move(character);
    return id;
}

EMSCRIPTEN_KEEPALIVE
void physics3d_removeCharacter(uint32_t characterId) {
    auto found = g().characters.find(characterId);
    if (found == g().characters.end()) return;
    found->second->controller->getActor()->userData = nullptr;
    found->second->controller->release();
    g().characters.erase(found);
}

EMSCRIPTEN_KEEPALIVE
void physics3d_moveCharacter(uint32_t characterId, float vx, float vy, float vz,
                             float dt, float stepUp, float stepDown) {
    g().queryBuffer.clear();
    auto found = g().characters.find(characterId);
    if (!g().isValid() || found == g().characters.end()) return;
    Character& c = *found->second;
    PxController& controller = *c.controller;

    // The vertical speed is the caller's, carried between moves: `vy = 0` walks.
    float vertical = c.verticalSpeed;
    if (vy != 0.0f) vertical = vy;
    else if (c.grounded) vertical = 0.0f;
    else vertical += g().scene->getGravity().y * dt;

    const bool pushing = movableAhead(controller, c.layer, PxVec3(vx, 0.0f, vz) * dt);
    controller.setStepOffset(pushing ? 0.0f : std::max(stepUp, 0.0f));
    CharacterFilter filter(c.layer, controller.getActor());
    const PxControllerFilters filters(nullptr, &filter, nullptr);
    HitReport& report = hitReport();
    report.moving = &c;
    report.dt = dt;
    report.bestUp = -2.0f;
    report.bestNormal = PxVec3(0.0f);

    const PxVec3 startedAt = toVec(controller.getPosition());
    PxControllerCollisionFlags flags = controller.move(PxVec3(vx, vertical, vz) * dt, 1.0e-4f, dt, filters);
    bool grounded = flags & PxControllerCollisionFlag::eCOLLISION_DOWN;
    // Stick to the floor walking down a slope or off a step, as Jolt's
    // ExtendedUpdate does; give the probe back if there is no floor in reach.
    if (!grounded && c.grounded && vertical <= 0.0f && stepDown > 0.0f) {
        const PxExtendedVec3 before = controller.getPosition();
        const PxControllerCollisionFlags probe =
            controller.move(PxVec3(0.0f, -stepDown, 0.0f), 1.0e-4f, dt, filters);
        if (probe & PxControllerCollisionFlag::eCOLLISION_DOWN) grounded = true;
        else controller.setPosition(before);
    }
    // A ceiling ends a jump, as it does for Unity's CharacterController.
    if ((flags & PxControllerCollisionFlag::eCOLLISION_UP) && vertical > 0.0f) vertical = 0.0f;
    report.moving = nullptr;

    c.grounded = grounded;
    c.verticalSpeed = vertical;
    const PxVec3 position = toVec(controller.getPosition());
    // Jolt's ground states: 0 on ground, 1 on ground too steep, 3 in the air.
    const float slopeLimit = controller.getSlopeLimit();
    float state = 3.0f;
    PxVec3 normal(0.0f);
    if (grounded) {
        state = 0.0f;
        normal = report.bestUp > 0.0f ? report.bestNormal : PxVec3(0.0f, 1.0f, 0.0f);
    } else if (report.bestUp > 0.0f && report.bestUp < slopeLimit) {
        state = 1.0f;
        normal = report.bestNormal;
    }
    // The velocity it reached, not the one it asked for.
    const PxVec3 velocity = dt > 0.0f ? (position - startedAt) / dt : PxVec3(0.0f);
    g().queryBuffer = {position.x, position.y, position.z, state, normal.x, normal.y, normal.z,
                       velocity.x, velocity.y, velocity.z};
}

EMSCRIPTEN_KEEPALIVE
void physics3d_setCharacterPosition(uint32_t characterId, float px, float py, float pz) {
    auto found = g().characters.find(characterId);
    if (found == g().characters.end()) return;
    found->second->controller->setPosition(PxExtendedVec3(px, py, pz));
    found->second->verticalSpeed = 0.0f;
    found->second->grounded = false;
}

// Queries

EMSCRIPTEN_KEEPALIVE
int physics3d_overlapSphere(float px, float py, float pz, float radius, uint32_t layerMask) {
    if (!(radius > 0.0f)) { g().queryBuffer.clear(); return 0; }
    return overlap(PxSphereGeometry(radius), PxVec3(px, py, pz), layerMask);
}

EMSCRIPTEN_KEEPALIVE
int physics3d_overlapBox(float px, float py, float pz, float hx, float hy, float hz, uint32_t layerMask) {
    if (!(hx > 0.0f && hy > 0.0f && hz > 0.0f)) { g().queryBuffer.clear(); return 0; }
    return overlap(PxBoxGeometry(hx, hy, hz), PxVec3(px, py, pz), layerMask);
}

EMSCRIPTEN_KEEPALIVE
int physics3d_sphereCast(float px, float py, float pz, float radius,
                         float dx, float dy, float dz, uint32_t layerMask) {
    g().queryBuffer.clear();
    if (!g().isValid() || !(radius > 0.0f)) return 0;
    PxVec3 dir(dx, dy, dz);
    const float length = dir.normalizeSafe();
    if (!(length > 0.0f)) return 0;
    PxSweepBuffer hit;
    LayerFilter filter(layerMask, false);
    if (!g().scene->sweep(PxSphereGeometry(radius), PxTransform(PxVec3(px, py, pz)), dir, length, hit,
                          PxHitFlag::ePOSITION | PxHitFlag::eNORMAL, queryData(), &filter)
        || !hit.hasBlock) return 0;
    const PxSweepHit& b = hit.block;
    g().queryBuffer = {static_cast<float>(px3::entityOf(b.actor)), b.distance / length,
                       b.position.x, b.position.y, b.position.z, b.normal.x, b.normal.y, b.normal.z};
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int physics3d_raycast(float ox, float oy, float oz, float dx, float dy, float dz, uint32_t layerMask) {
    g().queryBuffer.clear();
    if (!g().isValid()) return 0;
    PxVec3 dir(dx, dy, dz);
    const float length = dir.normalizeSafe();
    if (!(length > 0.0f)) return 0;
    PxRaycastBuffer hit;
    LayerFilter filter(layerMask, false);
    const PxVec3 origin(ox, oy, oz);
    if (!g().scene->raycast(origin, dir, length, hit, PxHitFlag::ePOSITION | PxHitFlag::eNORMAL,
                            queryData(), &filter)
        || !hit.hasBlock) return 0;
    const PxRaycastHit& b = hit.block;
    const PxVec3 point = origin + dir * b.distance;
    g().queryBuffer = {static_cast<float>(px3::entityOf(b.actor)), b.distance / length,
                       point.x, point.y, point.z, b.normal.x, b.normal.y, b.normal.z};
    return 1;
}

}  // extern "C"
