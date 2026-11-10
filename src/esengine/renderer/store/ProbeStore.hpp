// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ProbeStore.hpp
 * @brief   Which baked grid a point stands in, and what it says there.
 *
 * @details The frame's LightProbeVolume components, as bounds plus the grid each
 *          one reads. Filled during collection and read during collection — a
 *          volume is borrowed, not copied, so nothing here outlives the frame
 *          that gathered it.
 *
 *          Two ways a draw reads one. Per object: the nine coefficients where the
 *          draw stands, read here on the CPU — one value for the whole mesh. Per
 *          pixel: the grid itself, packed into the frame's probe atlas, and the
 *          draw's run says where in it — so one merged mesh spanning a shed and
 *          the yard outside is dark under the roof and lit in the open.
 */
#pragma once

#include "../../core/Half.hpp"
#include "../../core/Types.hpp"
#include "../../resource/ProbeVolume.hpp"
#include "./ProbeConstants.hpp"

#include <algorithm>
#include <cmath>
#include <glm/glm.hpp>
#include <vector>

namespace esengine {

/** @brief The frame's probe volumes, and the trilinear read through them. */
class ProbeStore {
public:
    /** @brief One volume: a world box, and the grid solved inside it. */
    struct Volume {
        glm::vec3 min{0.0f};
        glm::vec3 max{0.0f};
        const ProbeVolume* grid = nullptr;
        /// Where its grid sits in the atlas: the texel its coefficient 0, probe (0,0,0) is at. -1 = not placed.
        i32 atlasX = -1;
        i32 atlasY = -1;
    };

    void clear() { volumes_.clear(); }

    /** @brief Takes a volume, or ignores one no point can be inside. A grid whose
     *         coefficients do not match its resolution is not half-usable. */
    void add(const glm::vec3& min, const glm::vec3& max, const ProbeVolume* grid) {
        if (!grid || !grid->isValid()) return;
        if (max.x <= min.x || max.y <= min.y || max.z <= min.z) return;
        volumes_.push_back({min, max, grid});
    }

    bool empty() const { return volumes_.empty(); }
    u32 count() const { return static_cast<u32>(volumes_.size()); }

    /**
     * @brief The irradiance at @p p, read trilinearly. False = no volume holds it.
     * @details Probes sit on the box's CORNERS, so a volume's own bounds are
     *          covered by its own probes and a read never extrapolates. Where two
     *          volumes overlap the SMALLER wins: a room inside a hall was baked to
     *          say something the hall's spacing could not.
     */
    bool sample(const glm::vec3& p, ProbeConstants& out, bool perPixel = false) const {
        const Volume* best = nullptr;
        f32 bestSize = 0.0f;
        for (const Volume& v : volumes_) {
            if (p.x < v.min.x || p.x > v.max.x || p.y < v.min.y || p.y > v.max.y
                || p.z < v.min.z || p.z > v.max.z) continue;
            const glm::vec3 e = v.max - v.min;
            const f32 size = e.x * e.y * e.z;
            if (!best || size < bestSize) { best = &v; bestSize = size; }
        }
        if (!best) return false;

        const ProbeVolume& g = *best->grid;
        if (perPixel && best->atlasX >= 0 && atlas_texture_ != 0) {
            writeGridRun(*best, out);
            return true;
        }
        i32 low[3] = {0, 0, 0};
        i32 high[3] = {0, 0, 0};
        f32 frac[3] = {0.0f, 0.0f, 0.0f};
        for (u32 a = 0; a < 3; ++a) {
            const i32 n = g.resolution[static_cast<int>(a)];
            if (n <= 1) continue;
            const f32 span = best->max[static_cast<int>(a)] - best->min[static_cast<int>(a)];
            f32 u = (p[static_cast<int>(a)] - best->min[static_cast<int>(a)]) / span
                  * static_cast<f32>(n - 1);
            u = std::fmin(std::fmax(u, 0.0f), static_cast<f32>(n - 1));
            i32 i0 = static_cast<i32>(std::floor(u));
            if (i0 > n - 2) i0 = n - 2;
            low[a] = i0;
            high[a] = i0 + 1;
            frac[a] = u - static_cast<f32>(i0);
        }

        const i32 strideY = g.resolution.x;
        const i32 strideZ = g.resolution.x * g.resolution.y;
        const bool sky = g.hasSkyVisibility();
        out = ProbeConstants{};
        for (u32 corner = 0; corner < 8; ++corner) {
            const f32 w = ((corner & 1u) ? frac[0] : 1.0f - frac[0])
                        * ((corner & 2u) ? frac[1] : 1.0f - frac[1])
                        * ((corner & 4u) ? frac[2] : 1.0f - frac[2]);
            if (w <= 0.0f) continue;
            const i32 x = (corner & 1u) ? high[0] : low[0];
            const i32 y = (corner & 2u) ? high[1] : low[1];
            const i32 z = (corner & 4u) ? high[2] : low[2];
            const usize base = static_cast<usize>(x + y * strideY + z * strideZ) * 9;
            for (u32 c = 0; c < 9; ++c) {
                const glm::vec3& sh = g.irradiance[base + c];
                out.irradiance[c].x += sh.x * w;
                out.irradiance[c].y += sh.y * w;
                out.irradiance[c].z += sh.z * w;
            }
            // The sky's visibility rides the spare channels: [1..8].w and reflection.y for the first.
            if (sky) {
                out.reflection.y += g.skyVisibility[base] * w;
                for (u32 c = 1; c < 9; ++c) out.irradiance[c].w += g.skyVisibility[base + c] * w;
            }
        }
        out.irradiance[0].w = 1.0f;
        if (sky) out.reflection.z = 1.0f;
        return true;
    }

    /**
     * @brief Places every volume's grid in the atlas. True when the atlas's texels changed and want uploading.
     *
     * @details A grid is a block nine coefficient tiles wide (each resX x resY, one per coefficient) and resZ
     *          slices tall, the blocks stacked down the atlas. Within a tile the hardware filters x and y and never
     *          across a tile's edge (a read sits between the first and last probe's texel centres), and the shader
     *          blends the two slices around its z. A grid that would not fit @p maxSize keeps the per-object read.
     *          Two volumes reading the same grid share its block.
     */
    bool layoutAtlas(u32 maxSize) {
        std::vector<u64> key;
        key.reserve(volumes_.size());
        u32 width = 0;
        u32 height = 0;
        for (usize i = 0; i < volumes_.size(); ++i) {
            Volume& v = volumes_[i];
            v.atlasX = -1;
            v.atlasY = -1;
            for (usize j = 0; j < i; ++j) {
                if (volumes_[j].grid == v.grid) { v.atlasX = volumes_[j].atlasX; v.atlasY = volumes_[j].atlasY; break; }
            }
            if (v.atlasX >= 0) continue;
            const glm::ivec3 r = v.grid->resolution;
            const u32 w = 9u * static_cast<u32>(r.x);
            const u32 h = static_cast<u32>(r.y) * static_cast<u32>(r.z);
            if (w > maxSize || height + h > maxSize) continue;
            v.atlasX = 0;
            v.atlasY = static_cast<i32>(height);
            height += h;
            width = std::max(width, w);
            key.push_back(v.grid->revision);
            key.push_back(static_cast<u64>(v.atlasY));
        }
        const bool changed = key != atlas_key_ || width != atlas_width_ || height != atlas_height_;
        atlas_key_ = std::move(key);
        atlas_width_ = width;
        atlas_height_ = height;
        return changed;
    }

    u32 atlasWidth() const { return atlas_width_; }
    u32 atlasHeight() const { return atlas_height_; }

    /** @brief The atlas's texels, RGBA half floats: a coefficient's rgb, and the sky's visibility in a (0 for a grid
     *         baked without it). Laid out as layoutAtlas placed them. */
    void fillAtlas(std::vector<u16>& out) const {
        out.assign(static_cast<usize>(atlas_width_) * atlas_height_ * 4, 0);
        for (usize i = 0; i < volumes_.size(); ++i) {
            const Volume& v = volumes_[i];
            if (v.atlasX < 0) continue;
            bool repeat = false;
            for (usize j = 0; j < i; ++j) repeat = repeat || volumes_[j].grid == v.grid;
            if (repeat) continue;
            const ProbeVolume& g = *v.grid;
            const i32 rx = g.resolution.x;
            const i32 ry = g.resolution.y;
            const i32 rz = g.resolution.z;
            const bool sky = g.hasSkyVisibility();
            for (i32 z = 0; z < rz; ++z) {
                for (i32 y = 0; y < ry; ++y) {
                    for (i32 x = 0; x < rx; ++x) {
                        const usize probe = static_cast<usize>(x + y * rx + z * rx * ry) * 9;
                        const usize row = static_cast<usize>(v.atlasY + z * ry + y);
                        for (i32 c = 0; c < 9; ++c) {
                            const usize col = static_cast<usize>(v.atlasX + c * rx + x);
                            u16* t = &out[(row * atlas_width_ + col) * 4];
                            const glm::vec3& sh = g.irradiance[probe + static_cast<usize>(c)];
                            t[0] = packHalf(sh.x);
                            t[1] = packHalf(sh.y);
                            t[2] = packHalf(sh.z);
                            t[3] = packHalf(sky ? g.skyVisibility[probe + static_cast<usize>(c)] : 0.0f);
                        }
                    }
                }
            }
        }
    }

    /** @brief The atlas texture this frame's per-pixel runs point into; 0 = none, and every draw reads per object. */
    void setAtlasTexture(u32 id) { atlas_texture_ = id; }
    u32 atlasTexture() const { return atlas_texture_; }

private:
    /**
     * @brief A run that says where the grid is rather than what it holds; the shaders' probeGridIrradiance reads it.
     * @details [0].w = 2 marks it. [1] = the box's min and resX, [2] = probes per world unit along each axis (resolution
     *          less one over the box's size; 0 on a flat axis) and resY, [3] = the block's first texel and the atlas's
     *          inverse size, [4].x = resZ. The reflection column and the sky flag stay where a per-object run has them.
     */
    void writeGridRun(const Volume& v, ProbeConstants& out) const {
        const ProbeVolume& g = *v.grid;
        const glm::vec3 e = v.max - v.min;
        const glm::vec3 r = glm::vec3(g.resolution);
        out = ProbeConstants{};
        out.irradiance[0].w = 2.0f;
        out.irradiance[1] = glm::vec4(v.min, r.x);
        out.irradiance[2] = glm::vec4(r.x > 1.0f ? (r.x - 1.0f) / e.x : 0.0f,
                                      r.y > 1.0f ? (r.y - 1.0f) / e.y : 0.0f,
                                      r.z > 1.0f ? (r.z - 1.0f) / e.z : 0.0f, r.y);
        out.irradiance[3] = glm::vec4(static_cast<f32>(v.atlasX), static_cast<f32>(v.atlasY),
                                      1.0f / static_cast<f32>(atlas_width_), 1.0f / static_cast<f32>(atlas_height_));
        out.irradiance[4] = glm::vec4(r.z, 0.0f, 0.0f, 0.0f);
        if (g.hasSkyVisibility()) out.reflection.z = 1.0f;
    }

    std::vector<Volume> volumes_;
    std::vector<u64> atlas_key_;
    u32 atlas_width_ = 0;
    u32 atlas_height_ = 0;
    u32 atlas_texture_ = 0;
};

}  // namespace esengine
