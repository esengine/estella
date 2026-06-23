// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"

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
};

}  // namespace esengine
