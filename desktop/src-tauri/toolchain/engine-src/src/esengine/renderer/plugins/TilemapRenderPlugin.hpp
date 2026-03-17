#pragma once

#include "../RenderTypePlugin.hpp"
#include "../BatchVertex.hpp"

#include "../../tilemap/TilemapSystem.hpp"

#include <unordered_map>
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
    struct ChunkCache {
        std::vector<BatchVertex> vertices;
        std::vector<u16> indices;
        bool has_animated_tiles = false;
    };

    using ChunkMap = std::unordered_map<tilemap::ChunkCoord, ChunkCache, tilemap::ChunkCoordHash>;
    using LayerChunkMap = std::unordered_map<Entity, ChunkMap>;

    void rebuildChunk(const tilemap::TilemapSystem::LayerData& layer,
                      const tilemap::ChunkData& chunk, tilemap::ChunkCoord coord,
                      f32 originX, f32 originY, u32 packedColor,
                      Entity entity, ChunkCache& cache);

    tilemap::TilemapSystem* tilemap_system_ = nullptr;
    u32 batch_shader_id_ = 0;
    LayerChunkMap layer_caches_;

    std::vector<BatchVertex> vertices_;
    std::vector<u16> indices_;
};

}  // namespace esengine
