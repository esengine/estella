// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"
#include "../draw/BatchVertex.hpp"
#include "../../resource/Handle.hpp"

#include <vector>

namespace esengine {

namespace particle { class ParticleWorlds; }

class ParticlePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}


    void setWorlds(particle::ParticleWorlds* worlds) { worlds_ = worlds; }

    // An emitter inside a UI tree draws where that tree says it does — the reason
    // a UI particle is a first-class thing here rather than an extension — so it
    // follows the tree into the screen domain too.
    bool drawsScreenUI() const override { return true; }
    void collect(RenderCollectContext& ctx) override;
    const char* collectScope() const override { return "render.collect.particle"; }

private:
    particle::ParticleWorlds* worlds_ = nullptr;
    u32 particle_shader_id_ = 0;  // PARTICLE_INSTANCE program (GPU instancing)
    /// The shader resource behind it — held so a device rebuild, which runs
    /// init() again, can release the one the dead context owned.
    resource::ShaderHandle particle_shader_handle_;
    /// The same program premultiplying its output, for an emitter that blends as Multiply or Screen: those take the colour as it
    /// is, so a clear texel of a straight-alpha texture must come out black, or it whitens what is behind it.
    u32 particle_premultiplied_id_ = 0;
    resource::ShaderHandle particle_premultiplied_handle_;

    // Reused per-frame scratch for per-particle trail ribbons.
    std::vector<glm::vec3> trail_center_;   ///< Centerline (world), oldest→head.
    std::vector<BatchVertex> trail_verts_;  ///< 2 verts per centerline point.
    std::vector<u32> trail_indices_;        ///< 6 indices per segment.
};

}  // namespace esengine
