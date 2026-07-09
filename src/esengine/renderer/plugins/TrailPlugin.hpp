// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"
#include "../BatchVertex.hpp"

#include <vector>

namespace esengine {

namespace trail { class TrailSystem; }

/** @brief One centerline sample: world position + normalized age (0 head, 1 tail). */
struct TrailCenter {
    glm::vec2 pos{0.0f, 0.0f};
    f32 age01 = 0.0f;
};

/**
 * @brief Motion-trail renderer (TrailRenderer component).
 * @details Reads the per-entity point history from TrailSystem and turns it into a
 *          tapered, fading triangle-strip ribbon streamed through the unified Batch
 *          face each frame — CPU-generated verts, exactly like Mesh2D, so trails sort,
 *          clip, and multi-texture-merge like sprites. The RHI is triangle-only, so a
 *          ribbon (not a GPU line-strip) is the whole trick: no bottom-layer changes.
 */
class TrailPlugin : public RenderTypePlugin {
public:
    void setTrailSystem(trail::TrailSystem* system) { trail_system_ = system; }

    void collect(RenderCollectContext& ctx) override;

private:
    trail::TrailSystem* trail_system_ = nullptr;
    std::vector<TrailCenter> scratch_center_;   ///< Reused centerline (anchors + live head).
    std::vector<BatchVertex> scratch_verts_;    ///< Reused ribbon vertices (2 per centerline point).
    std::vector<u32> scratch_indices_;          ///< Reused ribbon indices (6 per segment).
};

}  // namespace esengine
