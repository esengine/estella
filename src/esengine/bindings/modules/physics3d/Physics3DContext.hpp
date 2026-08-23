// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DContext.hpp
 * @brief   The one 3D world a frame steps, and the layer scheme Jolt asks for.
 * @details A side module holds one world, the way the 2D one does: the SDK owns
 *          when it is built and stepped, and every entry point here reads this.
 *
 *          Jolt wants two classifications per body — an object layer (who collides
 *          with whom) and a broad-phase layer (how the tree is split). Both are the
 *          minimum a rigid-body world needs: static geometry that never tests
 *          against itself, and everything else.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <Jolt/Jolt.h>
#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/Physics/Constraints/TwoBodyConstraint.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>

#include <cstdint>
#include <memory>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace esengine::physics3d {

namespace Layers {
/// How many collision layers a project can name. Sixteen, like the 2D world's
/// mask bits, so a project describes its layers once for both.
static constexpr JPH::uint COUNT = 16;
/// An ObjectLayer packs the layer index with whether the body moves: Jolt asks
/// which broad-phase tree a layer belongs to, and a bare index cannot say.
static constexpr JPH::ObjectLayer of(JPH::uint layer, bool moving) {
    return static_cast<JPH::ObjectLayer>((layer << 1) | (moving ? 1u : 0u));
}
static constexpr JPH::uint indexOf(JPH::ObjectLayer layer) { return layer >> 1; }
static constexpr bool isMoving(JPH::ObjectLayer layer) { return (layer & 1u) != 0; }
static constexpr JPH::ObjectLayer OBJECT_LAYER_COUNT = COUNT * 2;
}  // namespace Layers

namespace BroadPhase {
static constexpr JPH::BroadPhaseLayer STATIC(0);
static constexpr JPH::BroadPhaseLayer MOVING(1);
static constexpr JPH::uint COUNT(2);
}  // namespace BroadPhase

/// Per-layer masks: bit i of `masks[l]` means layer l wants to hear from layer i.
/// Both sides must agree, so one of them saying no is enough — the same rule the
/// 2D world's category/mask pair follows.
struct LayerMatrix {
    JPH::uint32 masks[Layers::COUNT];
    LayerMatrix() { for (JPH::uint32& m : masks) m = 0xFFFFFFFFu; }
    bool collide(JPH::uint a, JPH::uint b) const {
        if (a >= Layers::COUNT || b >= Layers::COUNT) return false;
        return (masks[a] & (1u << b)) != 0 && (masks[b] & (1u << a)) != 0;
    }
};

LayerMatrix& layerMatrix();

/// Two static bodies never test against each other whatever their layers say —
/// neither can move, so a contact between them can never do anything.
class ObjectLayerPairFilterImpl final : public JPH::ObjectLayerPairFilter {
public:
    bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
        if (!Layers::isMoving(a) && !Layers::isMoving(b)) return false;
        return layerMatrix().collide(Layers::indexOf(a), Layers::indexOf(b));
    }
};

class BroadPhaseLayerInterfaceImpl final : public JPH::BroadPhaseLayerInterface {
public:
    JPH::uint GetNumBroadPhaseLayers() const override { return BroadPhase::COUNT; }
    JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override {
        return Layers::isMoving(layer) ? BroadPhase::MOVING : BroadPhase::STATIC;
    }
#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
    const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer layer) const override {
        return layer == BroadPhase::STATIC ? "static" : "moving";
    }
#endif
};

class ObjectVsBroadPhaseLayerFilterImpl final : public JPH::ObjectVsBroadPhaseLayerFilter {
public:
    bool ShouldCollide(JPH::ObjectLayer a, JPH::BroadPhaseLayer b) const override {
        // A static body only ever needs the moving tree; a moving one needs both.
        return Layers::isMoving(a) || b == BroadPhase::MOVING;
    }
};

/// Everything one world owns. Built by physics3d_init, torn down by shutdown.
struct Context {
    JPH::PhysicsSystem* system = nullptr;
    JPH::TempAllocatorImpl* temp = nullptr;
    JPH::JobSystemSingleThreaded* jobs = nullptr;
    JPH::Factory* factory = nullptr;

    BroadPhaseLayerInterfaceImpl broadPhaseLayers;
    ObjectVsBroadPhaseLayerFilterImpl objectVsBroadPhase;
    ObjectLayerPairFilterImpl objectPairs;

    /// Body -> the entity that owns it, so a readback names who moved.
    std::unordered_map<uint32_t, uint32_t> entityOf;
    /// Refilled every step: (entity, px,py,pz, qx,qy,qz,qw) per active body.
    std::vector<float> transformBuffer;
    /// The last query's hits, in the shape its getter documents.
    std::vector<float> queryBuffer;

    /// Refilled every step by the contact listener. Enter carries the geometry
    /// (entityA, entityB, nx,ny,nz, px,py,pz); exit only the pair, because at
    /// that moment Jolt has both bodies locked and one of them may already be gone.
    std::vector<float> contactEnterBuffer;
    std::vector<float> contactExitBuffer;
    std::vector<float> sensorEnterBuffer;
    std::vector<float> sensorExitBuffer;

    /// Which bodies are sensors, remembered at registration: OnContactRemoved
    /// cannot ask a body anything, so a sensor that stopped overlapping would
    /// otherwise be indistinguishable from a solid one.
    std::unordered_set<uint32_t> sensorBodies;

    /// Joints, keyed by the entity whose component authored them — one per entity,
    /// the same ownership the 2D world uses.
    std::unordered_map<uint32_t, JPH::Ref<JPH::TwoBodyConstraint>> constraints;
    /// Bodies a joint asked not to collide, in groups: Jolt filters per body, not
    /// per constraint, so the only way to say it is "these bodies are one
    /// assembly" — and joining two assemblies has to merge their members.
    std::unordered_map<uint32_t, uint32_t> jointGroupOf;
    std::unordered_map<uint32_t, std::vector<uint32_t>> jointGroupMembers;
    /// How many joints hold each body in its assembly, so a body leaves the group
    /// when the last joint holding it goes and can collide with its siblings again.
    std::unordered_map<uint32_t, uint32_t> jointHolds;
    uint32_t nextJointGroup = 1;

    /// Characters are not bodies: a CharacterVirtual is swept against the world
    /// rather than solved in it, which is what lets it climb stairs and stay
    /// glued to a slope without inheriting momentum from whatever it stands on.
    std::unordered_map<uint32_t, std::unique_ptr<JPH::CharacterVirtual>> characters;
    /// A character is not a body, so its layer is not stored in one.
    std::unordered_map<uint32_t, uint32_t> characterLayers;
    uint32_t nextCharacterId = 1;
    /// Characters are swept against the WORLD, and the world does not contain
    /// them: without this they walk through each other, which is the one pair of
    /// shapes a player notices passing through.
    JPH::CharacterVsCharacterCollisionSimple characterVsCharacter;

    bool isValid() const { return system != nullptr; }
};

Context& ctx();

}  // namespace esengine::physics3d
