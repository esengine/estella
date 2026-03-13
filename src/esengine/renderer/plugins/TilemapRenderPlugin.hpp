#pragma once

#include "../RenderTypePlugin.hpp"
#include "../BatchVertex.hpp"

#include <vector>

namespace esengine {

namespace tilemap { class TilemapSystem; }

class TilemapRenderPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    void setTilemapSystem(tilemap::TilemapSystem* system) { tilemap_system_ = system; }

    void collect(
        ecs::Registry& registry,
        const Frustum& frustum,
        const ClipState& clips,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        RenderFrameContext& ctx
    ) override;

private:
    tilemap::TilemapSystem* tilemap_system_ = nullptr;
    u32 batch_shader_id_ = 0;

    std::vector<BatchVertex> vertices_;
    std::vector<u16> indices_;
};

}  // namespace esengine
