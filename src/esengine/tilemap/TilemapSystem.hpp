#pragma once

#include "../core/Types.hpp"

#include <glm/glm.hpp>
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

    struct LayerData {
        u32 width = 0;
        u32 height = 0;
        f32 tile_width = 0;
        f32 tile_height = 0;
        std::vector<u16> tiles;
    };

    const LayerData* getLayerData(Entity entity) const;

private:
    std::unordered_map<Entity, LayerData> layers_;
};

}  // namespace tilemap
}  // namespace esengine
