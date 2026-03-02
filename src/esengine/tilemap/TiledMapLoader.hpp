#pragma once

#include "../core/Types.hpp"

#include <string>
#include <unordered_map>
#include <vector>

struct cute_tiled_map_t;
struct cute_tiled_tileset_t;

namespace esengine {
namespace tilemap {

struct TiledLayerInfo {
    std::string name;
    u32 width;
    u32 height;
    bool visible;
    std::vector<u16> tiles;
};

struct TiledTilesetInfo {
    std::string name;
    std::string image;
    u32 first_gid;
    u32 tile_width;
    u32 tile_height;
    u32 columns;
    u32 tile_count;
};

struct TiledMapData {
    u32 width;
    u32 height;
    u32 tile_width;
    u32 tile_height;
    std::vector<TiledLayerInfo> layers;
    std::vector<TiledTilesetInfo> tilesets;
};

class TiledMapLoader {
public:
    u32 loadFromMemory(const char* data, u32 size);

    u32 getExternalTilesetCount(u32 handle) const;
    std::string getExternalTilesetSource(u32 handle, u32 index) const;

    bool loadExternalTileset(u32 handle, u32 index,
                             const char* data, u32 size);

    bool finalize(u32 handle);

    void freeMap(u32 handle);
    const TiledMapData* getMap(u32 handle) const;

private:
    struct ExternalTilesetEntry {
        cute_tiled_tileset_t* map_tileset;
        cute_tiled_tileset_t* loaded;
        std::string source;
    };

    struct PendingMap {
        cute_tiled_map_t* raw_map;
        TiledMapData result;
        bool finalized;
        std::vector<ExternalTilesetEntry> external_tilesets;
    };

    std::unordered_map<u32, PendingMap> maps_;
    u32 next_handle_ = 1;

    static u16 convertGid(int gid, const std::vector<TiledTilesetInfo>& tilesets);
    static void collectLayers(cute_tiled_map_t* map, TiledMapData& result,
                              const std::vector<TiledTilesetInfo>& tilesets);
};

}  // namespace tilemap
}  // namespace esengine
