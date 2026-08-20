// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ShadowAtlas.hpp
 * @brief   Who owns which square of the one shadow texture.
 * @details The RHI has no array textures, so every shadow map a frame renders shares
 *          one atlas — and something has to say where each lands. That was four
 *          hard-coded quadrants, which is why exactly one light could cast.
 *
 *          A tile's rect leaves here as DATA the shader indexes, not an expression it
 *          recomputes, so tiles of different sizes cost the shader nothing: what a
 *          light reads is an origin and a side either way.
 */
#pragma once

#include "../../core/Types.hpp"
#include "./LightConstants.hpp"

#include <glm/glm.hpp>

#include <vector>

namespace esengine {

/** @brief One tile's square, in atlas texels. */
struct ShadowTile {
    u32 x = 0;
    u32 y = 0;
    u32 size = 0;
};

/**
 * @brief A square texture divided into a grid of cells, handed out as square blocks.
 *
 * @details Cell-aligned rather than free-form: a block of n x n cells can only start
 *          on a multiple of n, which is what keeps allocation a scan instead of a
 *          packing problem, and what makes the order it produces reproducible.
 */
class ShadowAtlas {
public:
    ShadowAtlas(u32 atlasSize, u32 cellSize)
        : size_(atlasSize), cell_(cellSize > 0 ? cellSize : 1),
          cols_(atlasSize / (cellSize > 0 ? cellSize : 1)) {
        used_.assign(static_cast<usize>(cols_) * cols_, false);
    }

    /** @brief Gives the whole atlas back. Called once per frame, before any claim. */
    void reset() {
        tiles_.clear();
        used_.assign(used_.size(), false);
    }

    /**
     * @brief Claims @p count tiles of @p cells x @p cells cells each.
     * @return The first tile's index, or -1 when the atlas or the tile budget has no
     *         room for all of them — all or nothing, so a caller never renders half a
     *         cascade set and leaves the rest reading someone else's depths.
     */
    i32 allocate(u32 count, u32 cells) {
        if (count == 0 || cells == 0 || cells > cols_) return -1;
        if (tiles_.size() + count > MAX_SHADOW_TILES) return -1;
        const usize before = tiles_.size();
        for (u32 i = 0; i < count; ++i) {
            if (!claim(cells)) {
                tiles_.resize(before);
                rebuildUsed();
                return -1;
            }
        }
        return static_cast<i32>(before);
    }

    u32 tileCount() const { return static_cast<u32>(tiles_.size()); }
    const ShadowTile& tile(u32 index) const { return tiles_[index]; }

    /**
     * @brief Tile @p index as a fraction of the atlas: (origin.x, origin.y, side, 0).
     * @details The origin is the low corner in the convention the atlas is RENDERED
     *          in, which is GL's. A backend that samples the other way up turns it
     *          over where it samples — see the WGSL twin of shadowFactor3D.
     */
    glm::vec4 unitRect(u32 index) const {
        const ShadowTile& t = tiles_[index];
        const f32 inv = 1.0f / static_cast<f32>(size_);
        return {static_cast<f32>(t.x) * inv, static_cast<f32>(t.y) * inv,
                static_cast<f32>(t.size) * inv, 0.0f};
    }

private:
    bool claim(u32 cells) {
        for (u32 cy = 0; cy + cells <= cols_; cy += cells) {
            for (u32 cx = 0; cx + cells <= cols_; cx += cells) {
                if (!free(cx, cy, cells)) continue;
                mark(cx, cy, cells, true);
                tiles_.push_back({cx * cell_, cy * cell_, cells * cell_});
                return true;
            }
        }
        return false;
    }

    bool free(u32 cx, u32 cy, u32 cells) const {
        for (u32 y = cy; y < cy + cells; ++y) {
            for (u32 x = cx; x < cx + cells; ++x) {
                if (used_[static_cast<usize>(y) * cols_ + x]) return false;
            }
        }
        return true;
    }

    void mark(u32 cx, u32 cy, u32 cells, bool value) {
        for (u32 y = cy; y < cy + cells; ++y) {
            for (u32 x = cx; x < cx + cells; ++x) {
                used_[static_cast<usize>(y) * cols_ + x] = value;
            }
        }
    }

    void rebuildUsed() {
        used_.assign(used_.size(), false);
        for (const ShadowTile& t : tiles_) {
            mark(t.x / cell_, t.y / cell_, t.size / cell_, true);
        }
    }

    u32 size_;
    u32 cell_;
    u32 cols_;
    std::vector<ShadowTile> tiles_;
    std::vector<bool> used_;
};

}  // namespace esengine
