// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"
#include "../draw/BatchVertex.hpp"

#include "../../tilemap/TilemapSystem.hpp"

#include <unordered_map>
#include <vector>

namespace esengine {

namespace tilemap { class TilemapSystem; }

class TilemapRenderPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override;

    void setTilemapSystem(tilemap::TilemapSystem* system) { tilemap_system_ = system; }

    void collect(RenderCollectContext& ctx) override;
    const char* collectScope() const override { return "render.collect.tilemap"; }

private:
    // One batch per tileset slot. Vertices stay layer-local and untinted;
    // rotation, origin, parallax and tint apply at frame merge without cache rebuilds.
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
        // Animation-TABLE revision this cache was built at; every chunk rebuilds
        // once when the table changes so a static chunk can become animated.
        u32 built_anim_table_revision = 0;
        // Which build of this chunk's mesh a strip was made from: a counter the plugin hands out, so a strip is stale exactly when a chunk in it
        // was rebuilt after it (the newest serial among its chunks is not the one it recorded).
        u64 mesh_serial = 0;
    };

    // A layer slot with its texture resolved for the current frame.
    struct ResolvedSlot {
        u32 glTexId = 0;
        f32 uvW = 0.0f;
        f32 uvH = 0.0f;
        // Atlas margin (border before the first tile) and per-tile step
        // (tileSize + spacing), in UV units. For a gapless atlas offset=0 and
        // step==uvW/uvH; a Tiled tileset with margin/spacing shifts each cell so
        // it samples its own texels instead of the adjacent tile's.
        f32 uvOffsetX = 0.0f;
        f32 uvStepX = 0.0f;
        f32 uvOffsetY = 0.0f;
        f32 uvStepY = 0.0f;
        // How far a tile-corner UV is pulled in from the cell rect. Zero when the
        // tileset is extruded (the atlas guarantees no crossing, so UV rect ==
        // geometry rect); half a texel on a packed atlas, which stretches the tile.
        f32 insetU = 0.0f;
        f32 insetV = 0.0f;
        // How many tiles the texture actually holds, at this layer's cell size.
        // A tile id past them has no texels of its own, and sampling outside the
        // atlas returns some other tile — so it is skipped instead.
        u32 atlasCols = 0;
        u32 atlasRows = 0;
        bool valid = false;
        bool operator==(const ResolvedSlot&) const = default;
    };

    struct LayoutInputs {
        f32 tileWidth = 0;
        f32 tileHeight = 0;
        tilemap::GridType gridType = tilemap::GridType::Orthogonal;
        f32 hexSideLength = 0;
        bool staggerAxisX = false;
        bool staggerIndexEven = false;
        bool operator==(const LayoutInputs&) const = default;
    };

    using ChunkMap = std::unordered_map<tilemap::ChunkCoord, ChunkCache, tilemap::ChunkCoordHash>;

    // Geometry the GPU keeps between frames. A layer whose grid sits where it did (no parallax, same tint, same place) draws from here, so a frame
    // in which no chunk changed uploads nothing and copies no vertex. The unit is a STRIP: one row of chunks, thirty-two of them wide, in
    // world space. A strip rather than a block of chunks because the merged draw this replaces laid tiles out chunk row by chunk row, and
    // tiles that overlap (a tall tile over its neighbour, an isometric map) are drawn in that order: strips drawn row by row, slot by slot,
    // reproduce it, and a square block of chunks would not.
    static constexpr i32 STRIP_CHUNKS = 32;
    /// What the strips of every layer may hold before the ones not drawn lately are given back.
    static constexpr u64 STRIP_BYTES_BUDGET = 96ull * 1024 * 1024;
    struct StripKey {
        i32 sx = 0;
        i32 cy = 0;
        bool operator==(const StripKey&) const = default;
    };
    struct StripKeyHash {
        usize operator()(const StripKey& key) const {
            return std::hash<i64>{}((static_cast<i64>(key.sx) << 32) ^ static_cast<i64>(static_cast<u32>(key.cy)));
        }
    };
    /// Where and how a strip's vertices were placed: everything the world-space geometry depends on besides the chunks themselves.
    struct Placement {
        f32 adjX = 0, adjY = 0, originX = 0, originY = 0, offsetX = 0, offsetY = 0, angle = 0, depth = 0;
        u32 color = 0;
        bool operator==(const Placement&) const = default;
    };
    struct StripSlot {
        BufferHandle vbo = BufferHandle::Invalid;
        BufferHandle ibo = BufferHandle::Invalid;
        u32 vertexCount = 0;
        u32 indexCount = 0;
        u32 vboBytes = 0;
        u32 iboBytes = 0;
    };
    struct Strip {
        std::vector<StripSlot> slots;  // by the layer's render-slot order
        Placement placement;
        u64 stamp = 0;                 // newest mesh serial among the chunks it was built from
        u32 chunkCount = 0;            // how many chunks that was
        u64 deviceGeneration = 0;      // the device its buffers belong to
        u64 lastUsed = 0;              // the collect that last drew it
        bool built = false;
    };

    struct LayerCache {
        u32 generation = 0;
        LayoutInputs layout;
        std::vector<tilemap::TilesetSlot> tilesets;
        std::vector<ResolvedSlot> resolved;
        ChunkMap chunks;
        std::unordered_map<StripKey, Strip, StripKeyHash> strips;
        // Where the layer was placed the last time it was collected, and until which collect it counts as MOVING. A layer faded, tinted or carried
        // along is placed anew every frame, and a strip is made of every chunk in a row of them, many times what is on screen: for such a layer
        // the vertices are built per frame for the visible chunks, as before, until it has stood still for a while.
        Placement lastPlacement;
        bool lastPlacementKnown = false;
        u64 movingUntil = 0;
        /// The layer's count of chunks taken out when its caches were last cleared of the ones that are gone.
        u32 chunksErasedSeen = 0;
    };
    using LayerChunkMap = std::unordered_map<Entity, LayerCache>;

    void rebuildChunk(const tilemap::TilemapSystem::LayerData& layer,
                      const tilemap::ChunkData& chunk, tilemap::ChunkCoord coord,
                      const std::vector<tilemap::TilesetSlot>& slots,
                      const std::vector<ResolvedSlot>& resolved,
                      Entity entity, ChunkCache& cache);

    /// The chunk's mesh, rebuilt first when what it was built from has moved on.
    ChunkCache& ensureChunk(const tilemap::TilemapSystem::LayerData& layer, const tilemap::ChunkData& chunkData,
                            tilemap::ChunkCoord coord, const std::vector<tilemap::TilesetSlot>& slots,
                            const std::vector<ResolvedSlot>& resolved, Entity entity, ChunkMap& chunkCaches);
    /// Gives a strip's buffers back (when they belong to the live device) and forgets them.
    void releaseStrip(GfxDevice& device, Strip& strip);
    void releaseLayer(LayerCache& layer);
    /// Gives back strips no recent collect drew, while the strips of every layer hold more than the budget.
    void evictStrips(GfxDevice& device);

    tilemap::TilemapSystem* tilemap_system_ = nullptr;
    u32 batch_shader_id_ = 0;
    LayerChunkMap layer_caches_;
    GfxDevice* device_ = nullptr;
    u64 mesh_serial_ = 0;
    u64 collect_serial_ = 0;
    u64 strip_bytes_ = 0;
    std::vector<BatchVertex> strip_vertices_scratch_;
    std::vector<u32> strip_indices_scratch_;
    std::vector<Strip*> visible_strips_scratch_;

    // Per-frame scratch reused across layers/frames so collect allocates nothing
    // in the steady state.
    std::vector<tilemap::TilesetSlot> single_slot_scratch_;
    std::vector<ResolvedSlot> resolved_scratch_;
    std::vector<std::vector<BatchVertex>> slot_vertices_scratch_;
    std::vector<std::vector<u32>> slot_indices_scratch_;
};

}  // namespace esengine
