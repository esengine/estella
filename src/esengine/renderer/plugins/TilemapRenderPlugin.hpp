#pragma once

#include "../RenderTypePlugin.hpp"

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
    struct TileVertex {
        glm::vec2 position;
        u32 color;
        glm::vec2 texCoord;
    };

    static u32 packColor(const glm::vec4& c);

    tilemap::TilemapSystem* tilemap_system_ = nullptr;
    u32 batch_shader_id_ = 0;

    std::vector<TileVertex> vertices_;
    std::vector<u16> indices_;
};

}  // namespace esengine
