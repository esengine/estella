// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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

    void collect(RenderCollectContext& ctx) override;

private:
    // Per-tileset-slot geometry for one chunk. A multi-tileset layer splits a
    // chunk's tiles across slots (one texture each) so each becomes its own batch.
    // Vertices are layer-local and untinted: origin, parallax offset and tint are
    // applied when merging into the frame's batch, so moving, tinting or
    // parallax-scrolling a layer never invalidates the cache.
    struct SlotMesh {
        std::vector<BatchVertex> vertices;
        std::vector<u32> indices;
    };
    struct ChunkCache {
        std::vector<SlotMesh> slots;  // indexed by the layer's render-slot order
        bool has_animated_tiles = false;
        // Revision of the content chunk this cache was last built from. Compared
        // against ChunkData::revision so we rebuild only on real edits — the
        // renderer reads this snapshot stamp and never writes to content.
        u32 built_revision = 0;
        // Animation-frame revision this cache was built at; an animated chunk
        // rebuilds when a visible frame flips, not every frame.
        u32 built_anim_revision = 0;
    };

    // A layer slot with its texture resolved for the current frame.
    struct ResolvedSlot {
        u32 glTexId = 0;
        f32 uvW = 0.0f;
        f32 uvH = 0.0f;
        // Half a texel in UV space. Tile-corner UVs are inset by this so
        // interpolated samples never cross into the neighboring atlas tile —
        // the classic packed-atlas seam fix, for both linear and nearest
        // (which otherwise rounds across the boundary at fractional zoom).
        f32 insetU = 0.0f;
        f32 insetV = 0.0f;
        bool valid = false;
    };

    using ChunkMap = std::unordered_map<tilemap::ChunkCoord, ChunkCache, tilemap::ChunkCoordHash>;
    using LayerChunkMap = std::unordered_map<Entity, ChunkMap>;

    void rebuildChunk(const tilemap::TilemapSystem::LayerData& layer,
                      const tilemap::ChunkData& chunk, tilemap::ChunkCoord coord,
                      const std::vector<tilemap::TilesetSlot>& slots,
                      const std::vector<ResolvedSlot>& resolved,
                      Entity entity, ChunkCache& cache);

    tilemap::TilemapSystem* tilemap_system_ = nullptr;
    u32 batch_shader_id_ = 0;
    LayerChunkMap layer_caches_;
};

}  // namespace esengine
