// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"
#include "../BatchVertex.hpp"

#include <vector>

namespace esengine {

namespace particle { class ParticleSystem; }

class ParticlePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    u32 skipFlag() const override { return 2; }

    void setParticleSystem(particle::ParticleSystem* system) { particle_system_ = system; }

    void collect(RenderCollectContext& ctx) override;

private:
    particle::ParticleSystem* particle_system_ = nullptr;
    u32 particle_shader_id_ = 0;  // PARTICLE_INSTANCE program (GPU instancing)

    // Reused per-frame scratch for per-particle trail ribbons.
    std::vector<glm::vec2> trail_center_;   ///< Centerline (world), oldest→head.
    std::vector<BatchVertex> trail_verts_;  ///< 2 verts per centerline point.
    std::vector<u32> trail_indices_;        ///< 6 indices per segment.
};

}  // namespace esengine
