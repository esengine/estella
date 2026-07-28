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
    void collect(RenderCollectContext& ctx) override;

private:
    std::vector<BatchVertex> scratch_;  ///< Reused per mesh; amortizes the transform buffer.
};

}  // namespace esengine
