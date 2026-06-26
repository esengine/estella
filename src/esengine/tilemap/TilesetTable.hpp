// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilesetTable.hpp
 * @brief   Per-layer tileset table + GID→tileset resolution (dependency-free).
 *
 * A layer can reference several tilesets (as Tiled maps do). Tile ids are global
 * and contiguous across tilesets (matching Tiled GIDs): each tileset starts at a
 * `first_id`, so an id resolves to (tileset, local index) via the largest
 * `first_id <= id`. A single-tileset layer is just one slot with first_id == 1.
 */
#pragma once

#include <cstdint>
#include <vector>

namespace esengine {
namespace tilemap {

struct TilesetSlot {
    uint16_t first_id = 1;        // global tile-id at which this tileset begins (Tiled firstgid)
    uint32_t texture_handle = 0;  // resource::TextureHandle id
    uint32_t columns = 1;         // tiles per row in the tileset texture
};

/**
 * Index of the slot owning @p id — the one with the largest first_id <= id.
 * Returns -1 if none (id below the first slot, or empty table). @p slots must be
 * sorted ascending by first_id (TilemapSystem::setTilesets guarantees this).
 */
inline int resolveTilesetSlot(const std::vector<TilesetSlot>& slots, uint16_t id) {
    int found = -1;
    for (std::size_t i = 0; i < slots.size(); ++i) {
        if (id >= slots[i].first_id) {
            found = static_cast<int>(i);
        } else {
            break;
        }
    }
    return found;
}

}  // namespace tilemap
}  // namespace esengine
