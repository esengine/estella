#define CUTE_TILED_NO_EXTERNAL_TILESET_WARNING
#define CUTE_TILED_IMPLEMENTATION
#include "cute_tiled.h"

#include "TiledMapLoader.hpp"
#include "TilemapSystem.hpp"

#include <cstring>

namespace esengine {
namespace tilemap {

u32 TiledMapLoader::loadFromMemory(const char* data, u32 size) {
    auto* map = cute_tiled_load_map_from_memory(data, static_cast<int>(size), nullptr);
    if (!map) {
        return 0;
    }

    u32 handle = next_handle_++;
    auto& pending = maps_[handle];
    pending.raw_map = map;
    pending.finalized = false;

    pending.result.width = static_cast<u32>(map->width);
    pending.result.height = static_cast<u32>(map->height);
    pending.result.tile_width = static_cast<u32>(map->tilewidth);
    pending.result.tile_height = static_cast<u32>(map->tileheight);
    pending.result.infinite = map->infinite != 0;

    for (auto* ts = map->tilesets; ts; ts = ts->next) {
        TiledTilesetInfo info;
        info.first_gid = static_cast<u32>(ts->firstgid);

        if (ts->source.ptr && ts->source.ptr[0] != '\0') {
            info.name = "";
            info.image = "";
            info.tile_width = 0;
            info.tile_height = 0;
            info.columns = 0;
            info.tile_count = 0;

            ExternalTilesetEntry entry;
            entry.map_tileset = ts;
            entry.loaded = nullptr;
            entry.source = ts->source.ptr;
            pending.external_tilesets.push_back(std::move(entry));
        } else {
            info.name = ts->name.ptr ? ts->name.ptr : "";
            info.image = ts->image.ptr ? ts->image.ptr : "";
            info.tile_width = static_cast<u32>(ts->tilewidth);
            info.tile_height = static_cast<u32>(ts->tileheight);
            info.columns = static_cast<u32>(ts->columns);
            info.tile_count = static_cast<u32>(ts->tilecount);
        }

        pending.result.tilesets.push_back(std::move(info));
    }

    return handle;
}

u32 TiledMapLoader::getExternalTilesetCount(u32 handle) const {
    auto it = maps_.find(handle);
    if (it == maps_.end()) {
        return 0;
    }
    return static_cast<u32>(it->second.external_tilesets.size());
}

std::string TiledMapLoader::getExternalTilesetSource(u32 handle, u32 index) const {
    auto it = maps_.find(handle);
    if (it == maps_.end() || index >= it->second.external_tilesets.size()) {
        return "";
    }
    return it->second.external_tilesets[index].source;
}

bool TiledMapLoader::loadExternalTileset(u32 handle, u32 index,
                                          const char* data, u32 size) {
    auto it = maps_.find(handle);
    if (it == maps_.end() || index >= it->second.external_tilesets.size()) {
        return false;
    }

    auto& entry = it->second.external_tilesets[index];
    if (entry.loaded) {
        return true;
    }

    auto* tileset = cute_tiled_load_external_tileset_from_memory(
        data, static_cast<int>(size), nullptr);
    if (!tileset) {
        return false;
    }

    entry.loaded = tileset;

    u32 firstGid = static_cast<u32>(entry.map_tileset->firstgid);
    for (auto& tsInfo : it->second.result.tilesets) {
        if (tsInfo.first_gid == firstGid && tsInfo.tile_count == 0) {
            tsInfo.name = tileset->name.ptr ? tileset->name.ptr : "";
            tsInfo.image = tileset->image.ptr ? tileset->image.ptr : "";
            tsInfo.tile_width = static_cast<u32>(tileset->tilewidth);
            tsInfo.tile_height = static_cast<u32>(tileset->tileheight);
            tsInfo.columns = static_cast<u32>(tileset->columns);
            tsInfo.tile_count = static_cast<u32>(tileset->tilecount);
            break;
        }
    }

    return true;
}

u16 TiledMapLoader::convertGid(int gid, const std::vector<TiledTilesetInfo>& tilesets) {
    if (gid == 0) {
        return EMPTY_TILE;
    }

    int flipH = 0, flipV = 0, flipD = 0;
    cute_tiled_get_flags(gid, &flipH, &flipV, &flipD);
    int rawGid = cute_tiled_unset_flags(gid);

    u16 localId = 0;
    for (auto it = tilesets.rbegin(); it != tilesets.rend(); ++it) {
        if (static_cast<u32>(rawGid) >= it->first_gid) {
            localId = static_cast<u16>(rawGid - static_cast<int>(it->first_gid) + 1);
            break;
        }
    }

    if (localId == 0) {
        return EMPTY_TILE;
    }

    u16 result = localId & TILE_ID_MASK;
    if (flipH) { result |= TILE_FLIP_H; }
    if (flipV) { result |= TILE_FLIP_V; }
    if (flipD) { result |= TILE_FLIP_D; }

    return result;
}

void TiledMapLoader::collectLayers(cute_tiled_map_t* map, TiledMapData& result,
                                    const std::vector<TiledTilesetInfo>& tilesets) {
    auto processLayer = [&](auto& self, auto* layer) -> void {
        for (; layer; layer = layer->next) {
            if (layer->type.ptr && std::strcmp(layer->type.ptr, "group") == 0) {
                self(self, layer->layers);
                continue;
            }

            if (layer->type.ptr && std::strcmp(layer->type.ptr, "objectgroup") == 0) {
                TiledObjectGroupInfo groupInfo;
                groupInfo.name = layer->name.ptr ? layer->name.ptr : "";
                for (auto* obj = layer->objects; obj; obj = obj->next) {
                    TiledObjectInfo objInfo;
                    objInfo.x = obj->x;
                    objInfo.y = obj->y;
                    objInfo.width = obj->width;
                    objInfo.height = obj->height;
                    objInfo.rotation = obj->rotation;
                    objInfo.ellipse = obj->ellipse != 0;
                    objInfo.point = obj->point != 0;
                    objInfo.vert_count = obj->vert_count;
                    if (obj->vert_count > 0 && obj->vertices) {
                        objInfo.vertices.assign(obj->vertices,
                            obj->vertices + obj->vert_count * 2);
                    }
                    groupInfo.objects.push_back(std::move(objInfo));
                }
                result.object_groups.push_back(std::move(groupInfo));
                continue;
            }

            if (!layer->type.ptr || std::strcmp(layer->type.ptr, "tilelayer") != 0) {
                continue;
            }

            TiledLayerInfo info;
            info.name = layer->name.ptr ? layer->name.ptr : "";
            info.width = static_cast<u32>(layer->width);
            info.height = static_cast<u32>(layer->height);
            info.visible = layer->visible != 0;
            info.opacity = layer->opacity;
            info.tint_color = layer->tintcolor;
            info.parallax_x = layer->parallaxx;
            info.parallax_y = layer->parallaxy;

            if (layer->chunks) {
                info.infinite = true;
                for (auto* chunk = layer->chunks; chunk; chunk = chunk->next) {
                    TiledChunkInfo ci;
                    ci.x = chunk->x;
                    ci.y = chunk->y;
                    ci.width = static_cast<u32>(chunk->width);
                    ci.height = static_cast<u32>(chunk->height);
                    auto count = static_cast<u32>(chunk->data_count);
                    ci.tiles.resize(count);
                    for (u32 i = 0; i < count; ++i) {
                        ci.tiles[i] = convertGid(chunk->data[i], tilesets);
                    }
                    info.chunks.push_back(std::move(ci));
                }
            } else if (layer->data && layer->data_count > 0) {
                auto tileCount = static_cast<u32>(layer->data_count);
                info.tiles.resize(tileCount);
                for (u32 i = 0; i < tileCount; ++i) {
                    info.tiles[i] = convertGid(layer->data[i], tilesets);
                }
            } else {
                continue;
            }

            result.layers.push_back(std::move(info));
        }
    };

    processLayer(processLayer, map->layers);
}

bool TiledMapLoader::finalize(u32 handle) {
    auto it = maps_.find(handle);
    if (it == maps_.end() || it->second.finalized) {
        return false;
    }

    auto& pending = it->second;

    for (const auto& ext : pending.external_tilesets) {
        if (!ext.loaded) {
            return false;
        }
    }

    collectLayers(pending.raw_map, pending.result, pending.result.tilesets);

    for (auto& ext : pending.external_tilesets) {
        if (ext.loaded) {
            cute_tiled_free_external_tileset(ext.loaded);
            ext.loaded = nullptr;
        }
    }
    cute_tiled_free_map(pending.raw_map);
    pending.raw_map = nullptr;
    pending.finalized = true;

    return true;
}

void TiledMapLoader::freeMap(u32 handle) {
    auto it = maps_.find(handle);
    if (it == maps_.end()) {
        return;
    }

    auto& pending = it->second;
    if (!pending.finalized) {
        for (auto& ext : pending.external_tilesets) {
            if (ext.loaded) {
                cute_tiled_free_external_tileset(ext.loaded);
            }
        }
        if (pending.raw_map) {
            cute_tiled_free_map(pending.raw_map);
        }
    }

    maps_.erase(it);
}

const TiledMapData* TiledMapLoader::getMap(u32 handle) const {
    auto it = maps_.find(handle);
    if (it == maps_.end() || !it->second.finalized) {
        return nullptr;
    }
    return &it->second.result;
}

}  // namespace tilemap
}  // namespace esengine
