#pragma once

#include "../core/Types.hpp"

#include <glm/glm.hpp>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {
namespace tilemap {

static constexpr u16 EMPTY_TILE = 0;
static constexpr u32 CHUNK_SIZE = 16;

static constexpr u16 TILE_ID_MASK = 0x1FFF;
static constexpr u16 TILE_FLIP_H  = 0x2000;
static constexpr u16 TILE_FLIP_V  = 0x4000;
static constexpr u16 TILE_FLIP_D  = 0x8000;

enum class GridType : u8 {
    Orthogonal = 0,
    Isometric = 1,
    StaggeredIsometric = 2,
};

struct AnimFrame {
    u16 tile_id;
    u16 duration_ms;
};

struct TileAnimation {
    std::vector<AnimFrame> frames;
    u32 total_duration_ms = 0;
};

struct TileRange {
    i32 min_x = 0;
    i32 min_y = 0;
    i32 max_x = 0;
    i32 max_y = 0;
    bool empty() const { return min_x >= max_x || min_y >= max_y; }
};

TileRange computeVisibleRange(f32 camLeft, f32 camBottom, f32 camRight, f32 camTop,
                              f32 originX, f32 originY,
                              f32 tileWidth, f32 tileHeight,
                              u32 mapWidth, u32 mapHeight);

class TilemapSystem {
public:
    void initLayer(Entity entity, u32 width, u32 height,
                   f32 tileWidth, f32 tileHeight);
    void destroyLayer(Entity entity);
    bool hasLayer(Entity entity) const;

    void setTile(Entity entity, i32 x, i32 y, u16 tileId);
    u16 getTile(Entity entity, i32 x, i32 y) const;
    void fillRect(Entity entity, i32 x, i32 y, u32 w, u32 h, u16 tileId);
    void setTiles(Entity entity, const u16* tiles, u32 count);

    void setTileAnimation(Entity entity, u16 tileId,
                          const AnimFrame* frames, u32 frameCount);
    void advanceAnimations(Entity entity, f32 dtMs);
    u16 resolveAnimatedTile(Entity entity, u16 tileId) const;

    void setTileProperty(Entity entity, u16 tileId,
                         const std::string& key, const std::string& value);
    const char* getTileProperty(Entity entity, u16 tileId,
                                const std::string& key) const;

    void flipTile(Entity entity, i32 x, i32 y, bool flipH, bool flipV, bool flipD);
    void rotateTile(Entity entity, i32 x, i32 y, i32 degrees);

    void setGridType(Entity entity, GridType type);

    struct LayerData {
        u32 width = 0;
        u32 height = 0;
        f32 tile_width = 0;
        f32 tile_height = 0;
        std::vector<u16> tiles;

        u32 texture_handle = 0;
        u32 tileset_columns = 1;
        f32 uv_tile_width = 0;
        f32 uv_tile_height = 0;
        i32 sort_layer = 0;
        f32 depth = 0;
        glm::vec4 tint{1.0f, 1.0f, 1.0f, 1.0f};
        f32 opacity = 1.0f;
        glm::vec2 parallax_factor{1.0f, 1.0f};
        bool visible = true;
        Entity origin_entity = INVALID_ENTITY;
        GridType grid_type = GridType::Orthogonal;

        std::unordered_map<u16, TileAnimation> tile_animations;
        f32 elapsed_ms = 0;

        std::unordered_map<u16, std::unordered_map<std::string, std::string>> tile_properties;
    };

    const LayerData* getLayerData(Entity entity) const;
    LayerData* getLayerDataMut(Entity entity);

    void setRenderProps(Entity entity, u32 textureHandle, u32 tilesetColumns,
                        f32 uvTileW, f32 uvTileH,
                        i32 sortLayer, f32 depth,
                        f32 parallaxX, f32 parallaxY);
    void setTint(Entity entity, f32 r, f32 g, f32 b, f32 a, f32 opacity);
    void setVisible(Entity entity, bool visible);
    void setOriginEntity(Entity layerKey, Entity originEntity);

    void tileToWorld(Entity entity, i32 tx, i32 ty,
                     f32 originX, f32 originY, f32& outX, f32& outY) const;
    void worldToTile(Entity entity, f32 wx, f32 wy,
                     f32 originX, f32 originY, i32& outTx, i32& outTy) const;

    using LayerMap = std::unordered_map<Entity, LayerData>;
    const LayerMap& allLayers() const { return layers_; }

private:
    LayerMap layers_;
};

}  // namespace tilemap
}  // namespace esengine
