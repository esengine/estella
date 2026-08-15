// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"
#include "../draw/BatchVertex.hpp"

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
    u32 mesh_shader_id_ = 0;      ///< Resident geometry with a per-object transform.
    u32 mesh_lit_shader_id_ = 0;  ///< The same for geometry carrying normals.
    bool warned_material_ = false;  ///< A material on resident geometry is said once.
};

}  // namespace esengine
