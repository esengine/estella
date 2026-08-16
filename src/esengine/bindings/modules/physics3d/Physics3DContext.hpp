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

#include <cstdint>
#include <unordered_map>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace esengine::physics3d {

namespace Layers {
static constexpr JPH::ObjectLayer STATIC = 0;
static constexpr JPH::ObjectLayer MOVING = 1;
static constexpr JPH::ObjectLayer COUNT = 2;
}  // namespace Layers

namespace BroadPhase {
static constexpr JPH::BroadPhaseLayer STATIC(0);
static constexpr JPH::BroadPhaseLayer MOVING(1);
static constexpr JPH::uint COUNT(2);
}  // namespace BroadPhase

/// Static bodies never test against each other; everything else tests everything.
class ObjectLayerPairFilterImpl final : public JPH::ObjectLayerPairFilter {
public:
    bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
        return a == Layers::STATIC ? b == Layers::MOVING : true;
    }
};

class BroadPhaseLayerInterfaceImpl final : public JPH::BroadPhaseLayerInterface {
public:
    BroadPhaseLayerInterfaceImpl() {
        objectToBroadPhase_[Layers::STATIC] = BroadPhase::STATIC;
        objectToBroadPhase_[Layers::MOVING] = BroadPhase::MOVING;
    }
    JPH::uint GetNumBroadPhaseLayers() const override { return BroadPhase::COUNT; }
    JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override {
        return objectToBroadPhase_[layer];
    }
#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
    const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer layer) const override {
        return layer == BroadPhase::STATIC ? "static" : "moving";
    }
#endif
private:
    JPH::BroadPhaseLayer objectToBroadPhase_[Layers::COUNT];
};

class ObjectVsBroadPhaseLayerFilterImpl final : public JPH::ObjectVsBroadPhaseLayerFilter {
public:
    bool ShouldCollide(JPH::ObjectLayer a, JPH::BroadPhaseLayer b) const override {
        return a == Layers::STATIC ? b == BroadPhase::MOVING : true;
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

    bool isValid() const { return system != nullptr; }
};

Context& ctx();

}  // namespace esengine::physics3d
