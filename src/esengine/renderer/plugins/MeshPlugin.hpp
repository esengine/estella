// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <array>
#include "../RenderTypePlugin.hpp"
#include "../draw/BatchVertex.hpp"
#include "../../resource/Handle.hpp"

#include <vector>

namespace esengine {

/**
 * @brief Scene-level 2D mesh renderer (Mesh2D component).
 * @details Streams component-local geometry through the unified Batch face each
 *          frame — CPU-transformed like every 2D renderable — so meshes sort, clip,
 *          light, and multi-texture-merge exactly like sprites. The whole plugin is
 *          "vertices + BatchDrawKey + append": no bottom-layer changes.
 */
class MeshPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void collect(RenderCollectContext& ctx) override;

private:
    std::vector<BatchVertex> scratch_;  ///< Reused per mesh; amortizes the transform buffer.
    /// Resident-geometry programs, indexed by {has normals, lit, normal-mapped}:
    /// what the geometry carries and what the draw asked for are separate
    /// questions. Compiled on first use — a scene draws one or two of the five.
    std::array<u32, 8> mesh_programs_{};
    std::array<bool, 8> mesh_compiled_{};
    /// The shader RESOURCES behind those ids, kept because init() runs again
    /// after a device rebuild: with no handle to release, each rebuild left a
    /// dead shader in the pool and one more program the host never freed.
    std::array<resource::ShaderHandle, 8> mesh_shaders_{};
    u32 meshProgram(RenderFrameContext& ctx, bool normals, bool lit, bool normalMapped);
    bool warned_material_ = false;  ///< A material on resident geometry is said once.
};

}  // namespace esengine
