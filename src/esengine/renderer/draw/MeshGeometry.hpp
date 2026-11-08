// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MeshGeometry.hpp
 * @brief   Shared mesh LOD eligibility and local bounds for drawing and shadow fitting.
 */
#pragma once

#include "../lod/LodSelection.hpp"
#include "../../ecs/components/LODGroup.hpp"
#include "../../ecs/components/MeshRenderer.hpp"
#include "../../resource/Mesh.hpp"
#include "../../resource/ResourceManager.hpp"
#include <algorithm>

namespace esengine {

/** Bounds include every usable level so selecting a different level cannot change the selection metric. */
struct LodLevels {
    const Mesh* mesh[lod::kMaxStandIns + 1]{};
    lod::LevelSet set;
    glm::vec3 localMin{0.0f};
    glm::vec3 localMax{0.0f};
    bool gap = false;
    bool disordered = false;
    bool skinMismatch = false;
};

/** False when neither a usable stand-in nor a valid cull size can replace the base mesh. */
inline bool gatherLodLevels(resource::ResourceManager& resources, const ecs::LODGroup& group,
                            const Mesh& base, LodLevels& out) {
    out = LodLevels{};
    out.mesh[0] = &base;
    out.localMin = base.localMin;
    out.localMax = base.localMax;
    out.set.cull = group.cullSize;
    out.set.hysteresis = group.hysteresis;

    const resource::MeshHandle handles[lod::kMaxStandIns] = {group.lod1, group.lod2, group.lod3};
    const f32 sizes[lod::kMaxStandIns] = {group.lod1Size, group.lod2Size, group.lod3Size};
    for (u8 i = 0; i < lod::kMaxStandIns; ++i) {
        const Mesh* standIn = handles[i].isValid() ? resources.getMesh(handles[i]) : nullptr;
        if (!standIn || !standIn->isDrawable()) {
            // A missing level ends the reachable prefix, even if later slots are populated.
            for (u8 j = static_cast<u8>(i + 1); j < lod::kMaxStandIns; ++j) {
                if (handles[j].isValid()) out.gap = true;
            }
            break;
        }
        if (base.isSkinned() && standIn->inverseBind.size() != base.inverseBind.size()) {
            out.skinMismatch = true;
            break;
        }
        if (i > 0 && sizes[i] >= sizes[i - 1]) out.disordered = true;
        out.mesh[i + 1] = standIn;
        out.set.takeOver[i] = sizes[i];
        out.set.count = static_cast<u8>(i + 1);
        out.localMin = glm::min(out.localMin, standIn->localMin);
        out.localMax = glm::max(out.localMax, standIn->localMax);
    }
    // A cull size alone cannot validate a group whose first stand-in has an incompatible skeleton.
    return out.set.count > 0 || (out.set.cull > 0.0f && !out.skinMismatch);
}

/** A placement's coarse mesh shares the base draw layout; an incompatible mesh cannot affect its bounds. */
inline const Mesh* placementCoarseMesh(resource::ResourceManager& resources, const Mesh& base,
                                       const ecs::MeshInstances& placements) {
    const Mesh* coarse = placements.lod1Mesh.isValid() ? resources.getMesh(placements.lod1Mesh) : nullptr;
    return coarse && coarse->isDrawable() && coarse->hasNormals == base.hasNormals
        && coarse->hasTangents == base.hasTangents && coarse->hasLightmapUV == base.hasLightmapUV ? coarse : nullptr;
}

/** Displacement is local to the geometry and must be included before any placement or parent transform. */
inline void meshLocalBounds(const Mesh& base, const Mesh* coarse, f32 displacement,
                             glm::vec3& lo, glm::vec3& hi) {
    const glm::vec3 padding(std::max(displacement, 0.0f));
    lo = (coarse ? glm::min(base.localMin, coarse->localMin) : base.localMin) - padding;
    hi = (coarse ? glm::max(base.localMax, coarse->localMax) : base.localMax) + padding;
}

}  // namespace esengine
