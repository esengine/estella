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
    u32 batch_shader_id_ = 0;
};

}  // namespace esengine
