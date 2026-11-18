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
 *
 *          The atlas is a 3D texture of BRICKS, the shape a sparse volumetric lightmap takes: a grid is cut into
 *          blocks of kBrickCells cells a side, each stored kBrickTexels texels a side so that a brick carries the
 *          probes on its far faces too and the hardware's trilinear filter never reaches past it. An indirection
 *          cell per brick says where its brick sits. A dense grid is every brick at one size; a sparse one will
 *          point a run of indirection cells at one coarse brick (the span its indirection texel carries).
 */
#pragma once

#include "../../core/Half.hpp"
#include "../../core/Revision.hpp"
#include "../../core/Types.hpp"
#include "../../core/Hash.hpp"
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
        /// Where its grid's indirection cells start in the atlas (a texel of the indirection page). -1 = not placed.
        glm::ivec3 indirection{-1};
    };

    /// Cells a brick spans along each axis, and the texels it is stored in: one more, for the probes on its far faces.
    /// The grid's own, so a sparse grid's bricks go into the atlas as they are.
    static constexpr i32 kBrickCells = ProbeVolume::kBrickCells;
    static constexpr i32 kBrickTexels = ProbeVolume::kBrickSide;
    /// Pages across the atlas: the nine coefficients', then the indirection's.
    static constexpr i32 kAtlasPages = 10;

    /** @brief Bricks along each axis of a grid: enough cells for every probe interval, one on a flat axis. */
    static glm::ivec3 bricksFor(const glm::ivec3& resolution) {
        glm::ivec3 n{1};
        for (int a = 0; a < 3; ++a) n[a] = std::max(1, (resolution[a] - 1 + kBrickCells - 1) / kBrickCells);
        return n;
    }

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
     * @brief What the frame's probe volumes say, as a number that changes whenever it does (see core/Revision.hpp): asked after the
     *        collect, it moves only when this frame's set differs from the one it last answered for.
     */
    u64 revision() const {
        u64 h = hash::kFnv64Offset;
        const auto mix = [&h](const void* data, usize bytes) { h = hash::fnv1aBytes(h, data, bytes); };
        for (const Volume& v : volumes_) {
            mix(&v.min, sizeof(v.min));
            mix(&v.max, sizeof(v.max));
            mix(&v.grid, sizeof(v.grid));
            mix(&v.grid->revision, sizeof(v.grid->revision));
        }
        if (revision_ == 0 || h != revision_hash_) {
            revision_hash_ = h;
            revision_ = nextRevision();
        }
        return revision_;
    }


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
        if (perPixel && best->indirection.x >= 0 && atlas_texture_ != 0) {
            writeGridRun(*best, out);
            return true;
        }
        if (g.sparse()) {
            sampleBricks(*best, p, out);
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
     * @brief The volume a whole object stands in, by its world box rather than its origin.
     * @details An imported level's meshes keep their origin where the file put it — often the world's origin, far from
     *          the walls they draw — so asking at the origin leaves a shed's walls in no volume at all. The box's centre
     *          is asked first; a box whose centre is in none reads the smallest volume it overlaps, at the point of that
     *          volume nearest its centre. Per pixel, every pixel then reads the grid where it stands anyway.
     */
    bool sampleBox(const glm::vec3& centre, const glm::vec3& half, ProbeConstants& out, bool perPixel = false) const {
        if (sample(centre, out, perPixel)) return true;
        const Volume* best = nullptr;
        f32 bestSize = 0.0f;
        for (const Volume& v : volumes_) {
            const glm::vec3 vc = (v.min + v.max) * 0.5f;
            const glm::vec3 vh = (v.max - v.min) * 0.5f;
            const glm::vec3 gap = glm::abs(centre - vc) - (half + vh);
            if (gap.x > 0.0f || gap.y > 0.0f || gap.z > 0.0f) continue;
            const f32 size = vh.x * vh.y * vh.z;
            if (!best || size < bestSize) { best = &v; bestSize = size; }
        }
        if (!best) return false;
        return sample(glm::clamp(centre, best->min, best->max), out, perPixel);
    }

    /**
     * @brief Places every volume's grid in the atlas. True when the atlas's texels changed and want uploading.
     *
     * @details The atlas is kAtlasPages pages side by side along x, each pageWidth() texels wide: page c holds
     *          coefficient c of every brick (rgb, and the sky's visibility in a), at the same place in each page,
     *          and the last page holds the indirection cells. Brick slots fill a page x first, then y, then z; each
     *          grid's indirection block is stacked down z in the last page. A grid that would push any side past
     *          @p maxSide keeps the per-object read. Two volumes reading the same grid share its bricks.
     */
    bool layoutAtlas(u32 maxSide) {
        const i32 side = static_cast<i32>(maxSide);
        const i32 maxSlotsX = side / (kAtlasPages * kBrickTexels);
        const i32 maxSlotsYZ = side / kBrickTexels;
        std::vector<u64> key;
        key.reserve(volumes_.size() * 2);
        placed_.clear();
        i32 bricks = 0;
        glm::ivec3 extent{0};
        for (usize i = 0; i < volumes_.size(); ++i) {
            Volume& v = volumes_[i];
            v.indirection = glm::ivec3(-1);
            bool shared = false;
            for (usize j = 0; j < i; ++j) {
                if (volumes_[j].grid == v.grid) { shared = true; break; }
            }
            if (shared) continue;
            const glm::ivec3 n = bricksFor(v.grid->resolution);
            // A sparse grid brings its own bricks; a dense one is every cell a brick.
            const i32 count = v.grid->sparse() ? static_cast<i32>(v.grid->bricks.size()) : n.x * n.y * n.z;
            const glm::ivec3 grown{std::max(extent.x, n.x), std::max(extent.y, n.y), extent.z + n.z};
            const Shape shape = shapeFor(bricks + count, maxSlotsX, maxSlotsYZ, grown);
            if (shape.slots.x == 0 || shape.pageWidth * kAtlasPages > side || shape.height > side || shape.depth > side) {
                continue;
            }
            placed_.push_back({v.grid, bricks, n, glm::ivec3(0, 0, extent.z), count});
            bricks += count;
            extent = grown;
            key.push_back(v.grid->revision);
            key.push_back(static_cast<u64>(extent.z));
        }
        shape_ = placed_.empty() ? Shape{} : shapeFor(bricks, maxSlotsX, maxSlotsYZ, extent);
        // Every indirection block sits in the last page, so its x starts at that page's first texel.
        for (Placed& p : placed_) p.indirection.x = (kAtlasPages - 1) * shape_.pageWidth;
        for (Volume& v : volumes_) {
            for (const Placed& p : placed_) {
                if (p.grid == v.grid) { v.indirection = p.indirection; break; }
            }
        }
        const u32 width = placed_.empty() ? 0u : static_cast<u32>(shape_.pageWidth * kAtlasPages);
        const u32 height = placed_.empty() ? 0u : static_cast<u32>(shape_.height);
        const u32 depth = placed_.empty() ? 0u : static_cast<u32>(shape_.depth);
        const bool changed = key != atlas_key_ || width != atlas_width_ || height != atlas_height_ || depth != atlas_depth_;
        atlas_key_ = std::move(key);
        atlas_width_ = width;
        atlas_height_ = height;
        atlas_depth_ = depth;
        return changed;
    }

    u32 atlasWidth() const { return atlas_width_; }
    u32 atlasHeight() const { return atlas_height_; }
    u32 atlasDepth() const { return atlas_depth_; }
    /** @brief What the atlas takes on the GPU: four half floats a texel, no mips. What a sparse grid saves is here. */
    u64 atlasBytes() const {
        return static_cast<u64>(atlas_width_) * atlas_height_ * atlas_depth_ * 4u * sizeof(u16);
    }
    /** @brief Texels across one page: the x distance from a coefficient's texel to the next one's. */
    u32 pageWidth() const { return static_cast<u32>(shape_.pageWidth); }
    /** @brief Bricks the atlas holds, across every grid placed. */
    u32 brickCount() const {
        u32 n = 0;
        for (const Placed& p : placed_) n += static_cast<u32>(p.count);
        return n;
    }

    /** @brief Where brick slot @p index's first texel sits in page 0. */
    glm::ivec3 slotOrigin(i32 index) const {
        const i32 sx = shape_.slots.x;
        const i32 sy = shape_.slots.y;
        return glm::ivec3(index % sx, (index / sx) % sy, index / (sx * sy)) * kBrickTexels;
    }

    /**
     * @brief The atlas's texels, RGBA half floats, slice after slice: a coefficient's rgb and the sky's visibility in a
     *        (0 for a grid baked without it), and in the indirection page a brick's first texel in xyz and its span in w.
     * @details A brick's texel t along an axis is the grid's probe brick * kBrickCells + t, clamped to the grid: the
     *          texels past a grid's last probe repeat it, and a read never weights them (it stops at the last probe).
     */
    void fillAtlas(std::vector<u16>& out) const {
        const usize w = atlas_width_;
        const usize h = atlas_height_;
        out.assign(w * h * atlas_depth_ * 4, 0);
        const auto texel = [&](i32 x, i32 y, i32 z) -> u16* {
            return &out[((static_cast<usize>(z) * h + static_cast<usize>(y)) * w + static_cast<usize>(x)) * 4];
        };
        const i32 page = shape_.pageWidth;
        for (const Placed& p : placed_) {
            const ProbeVolume& g = *p.grid;
            const glm::ivec3 r = g.resolution;
            const bool sky = g.hasSkyVisibility();
            if (g.sparse()) {
                const auto put = [&](u16* t, usize probe) {
                    const glm::vec3& sh = g.irradiance[probe];
                    t[0] = packHalf(sh.x);
                    t[1] = packHalf(sh.y);
                    t[2] = packHalf(sh.z);
                    t[3] = packHalf(sky ? g.skyVisibility[probe] : 0.0f);
                };
                for (usize b = 0; b < g.bricks.size(); ++b) {
                    const glm::ivec4 k = g.bricks[b];
                    const glm::ivec3 o = slotOrigin(p.firstBrick + static_cast<i32>(b));
                    for (i32 t = 0; t < ProbeVolume::kBrickProbes; ++t) {
                        const i32 tx = t % kBrickTexels, ty = (t / kBrickTexels) % kBrickTexels, tz = t / (kBrickTexels * kBrickTexels);
                        const usize probe = (b * static_cast<usize>(ProbeVolume::kBrickProbes) + static_cast<usize>(t)) * 9;
                        for (i32 c = 0; c < 9; ++c) put(texel(c * page + o.x + tx, o.y + ty, o.z + tz), probe + static_cast<usize>(c));
                    }
                    // Every finest-brick cell the brick covers names it, with its span.
                    for (i32 z = k.z; z < std::min(k.z + k.w, p.bricks.z); ++z) {
                        for (i32 y = k.y; y < std::min(k.y + k.w, p.bricks.y); ++y) {
                            for (i32 x = k.x; x < std::min(k.x + k.w, p.bricks.x); ++x) {
                                u16* ind = texel(p.indirection.x + x, p.indirection.y + y, p.indirection.z + z);
                                ind[0] = packHalf(static_cast<f32>(o.x));
                                ind[1] = packHalf(static_cast<f32>(o.y));
                                ind[2] = packHalf(static_cast<f32>(o.z));
                                ind[3] = packHalf(static_cast<f32>(k.w));
                            }
                        }
                    }
                }
                continue;
            }
            for (i32 bz = 0; bz < p.bricks.z; ++bz) {
                for (i32 by = 0; by < p.bricks.y; ++by) {
                    for (i32 bx = 0; bx < p.bricks.x; ++bx) {
                        const i32 index = p.firstBrick + bx + p.bricks.x * (by + p.bricks.y * bz);
                        const glm::ivec3 o = slotOrigin(index);
                        u16* ind = texel(p.indirection.x + bx, p.indirection.y + by, p.indirection.z + bz);
                        ind[0] = packHalf(static_cast<f32>(o.x));
                        ind[1] = packHalf(static_cast<f32>(o.y));
                        ind[2] = packHalf(static_cast<f32>(o.z));
                        ind[3] = packHalf(1.0f);
                        for (i32 tz = 0; tz < kBrickTexels; ++tz) {
                            const i32 pz = std::min(bz * kBrickCells + tz, r.z - 1);
                            for (i32 ty = 0; ty < kBrickTexels; ++ty) {
                                const i32 py = std::min(by * kBrickCells + ty, r.y - 1);
                                for (i32 tx = 0; tx < kBrickTexels; ++tx) {
                                    const i32 px = std::min(bx * kBrickCells + tx, r.x - 1);
                                    const usize probe = static_cast<usize>(px + r.x * (py + r.y * pz)) * 9;
                                    for (i32 c = 0; c < 9; ++c) {
                                        u16* t = texel(c * page + o.x + tx, o.y + ty, o.z + tz);
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
            }
        }
    }

    /** @brief The atlas texture this frame's per-pixel runs point into; 0 = none, and every draw reads per object. */
    void setAtlasTexture(u32 id) { atlas_texture_ = id; }
    u32 atlasTexture() const { return atlas_texture_; }

private:
    /**
     * @brief A run that says where the grid is rather than what it holds; the shaders' probeGridIrradiance reads it.
     * @details [0].w = 2 marks it. [1] = the box's min and the grid's last probe index along x, [2] = probes per world
     *          unit along each axis (resolution less one over the box's size; 0 on a flat axis) and the last index along
     *          y, [3] = the grid's first indirection texel and the last index along z, [4] = the atlas's inverse size
     *          and the page width. The reflection column and the sky flag stay where a per-object run has them.
     */
    void writeGridRun(const Volume& v, ProbeConstants& out) const {
        const ProbeVolume& g = *v.grid;
        const glm::vec3 e = v.max - v.min;
        const glm::vec3 r = glm::vec3(g.resolution);
        out = ProbeConstants{};
        out.irradiance[0].w = 2.0f;
        out.irradiance[1] = glm::vec4(v.min, r.x - 1.0f);
        out.irradiance[2] = glm::vec4(r.x > 1.0f ? (r.x - 1.0f) / e.x : 0.0f,
                                      r.y > 1.0f ? (r.y - 1.0f) / e.y : 0.0f,
                                      r.z > 1.0f ? (r.z - 1.0f) / e.z : 0.0f, r.y - 1.0f);
        out.irradiance[3] = glm::vec4(glm::vec3(v.indirection), r.z - 1.0f);
        out.irradiance[4] = glm::vec4(1.0f / static_cast<f32>(atlas_width_), 1.0f / static_cast<f32>(atlas_height_),
                                      1.0f / static_cast<f32>(atlas_depth_), static_cast<f32>(shape_.pageWidth));
        if (g.hasSkyVisibility()) out.reflection.z = 1.0f;
    }

    /** @brief The atlas's shape: brick slots along each axis, and the texels a page and the whole take. */
    struct Shape {
        glm::ivec3 slots{0};
        i32 pageWidth = 0;
        i32 height = 0;
        i32 depth = 0;
    };
    /** @brief A grid whose bricks start at slot firstBrick, and whose indirection block (`bricks` cells a side, one
     *         per finest-brick cell) starts at a texel. `count` is the slots it takes. */
    struct Placed {
        const ProbeVolume* grid = nullptr;
        i32 firstBrick = 0;
        glm::ivec3 bricks{1};
        glm::ivec3 indirection{0};
        i32 count = 0;
    };

    /**
     * @brief A sparse grid read on the CPU the way the shaders read it: the finest-brick cell under @p p names a
     *        brick, and the brick's own probes are blended trilinearly at its spacing.
     */
    void sampleBricks(const Volume& v, const glm::vec3& p, ProbeConstants& out) const {
        const ProbeVolume& g = *v.grid;
        const glm::ivec3 cells = g.cells();
        glm::vec3 grid{0.0f};
        for (int a = 0; a < 3; ++a) {
            const i32 n = g.resolution[a];
            if (n <= 1) continue;
            const f32 u = (p[a] - v.min[a]) / (v.max[a] - v.min[a]) * static_cast<f32>(n - 1);
            grid[a] = std::fmin(std::fmax(u, 0.0f), static_cast<f32>(n - 1));
        }
        glm::ivec3 cell;
        for (int a = 0; a < 3; ++a) cell[a] = std::min(static_cast<i32>(std::floor(grid[a] / kBrickCells)), cells[a] - 1);
        const i32 b = g.cellBrick[static_cast<usize>(cell.x) + static_cast<usize>(cells.x)
                                  * (static_cast<usize>(cell.y) + static_cast<usize>(cells.y) * static_cast<usize>(cell.z))];
        const glm::ivec4 k = g.bricks[static_cast<usize>(b)];
        i32 low[3];
        f32 frac[3];
        for (int a = 0; a < 3; ++a) {
            const f32 local = (grid[a] - static_cast<f32>(k[a] * kBrickCells)) / static_cast<f32>(k.w);
            low[a] = std::min(std::max(static_cast<i32>(std::floor(local)), 0), kBrickCells - 1);
            frac[a] = std::fmin(std::fmax(local - static_cast<f32>(low[a]), 0.0f), 1.0f);
        }
        const bool sky = g.hasSkyVisibility();
        out = ProbeConstants{};
        for (u32 corner = 0; corner < 8; ++corner) {
            const f32 w = ((corner & 1u) ? frac[0] : 1.0f - frac[0])
                        * ((corner & 2u) ? frac[1] : 1.0f - frac[1])
                        * ((corner & 4u) ? frac[2] : 1.0f - frac[2]);
            if (w <= 0.0f) continue;
            const i32 t = (low[0] + ((corner & 1u) ? 1 : 0))
                        + kBrickTexels * ((low[1] + ((corner & 2u) ? 1 : 0)) + kBrickTexels * (low[2] + ((corner & 4u) ? 1 : 0)));
            const usize base = (static_cast<usize>(b) * static_cast<usize>(ProbeVolume::kBrickProbes) + static_cast<usize>(t)) * 9;
            for (u32 c = 0; c < 9; ++c) {
                const glm::vec3& sh = g.irradiance[base + c];
                out.irradiance[c].x += sh.x * w;
                out.irradiance[c].y += sh.y * w;
                out.irradiance[c].z += sh.z * w;
            }
            if (sky) {
                out.reflection.y += g.skyVisibility[base] * w;
                for (u32 c = 1; c < 9; ++c) out.irradiance[c].w += g.skyVisibility[base + c] * w;
            }
        }
        out.irradiance[0].w = 1.0f;
        if (sky) out.reflection.z = 1.0f;
    }

    /**
     * @brief The shape of fewest texels that holds @p bricks slots and an indirection page of @p extent texels, with at
     *        most @p maxSlotsX slots across a page and @p maxSlotsYZ up and deep. Zero slots when none can hold them.
     * @details Every arrangement is tried (a few hundred at most): filling x first wastes a row of slots on a grid of a
     *          handful of bricks, and the atlas is uploaded whole.
     */
    static Shape shapeFor(i32 bricks, i32 maxSlotsX, i32 maxSlotsYZ, const glm::ivec3& extent) {
        Shape best;
        if (bricks <= 0 || maxSlotsX <= 0 || maxSlotsYZ <= 0) return best;
        i64 bestTexels = 0;
        for (i32 sx = 1; sx <= std::min(bricks, maxSlotsX); ++sx) {
            for (i32 sy = 1; sy <= std::min((bricks + sx - 1) / sx, maxSlotsYZ); ++sy) {
                const i32 sz = (bricks + sx * sy - 1) / (sx * sy);
                if (sz > maxSlotsYZ) continue;
                Shape s;
                s.slots = {sx, sy, sz};
                s.pageWidth = std::max(sx * kBrickTexels, extent.x);
                s.height = std::max(sy * kBrickTexels, extent.y);
                s.depth = std::max(sz * kBrickTexels, extent.z);
                const i64 texels = static_cast<i64>(s.pageWidth) * s.height * s.depth;
                if (best.slots.x == 0 || texels < bestTexels) { best = s; bestTexels = texels; }
            }
        }
        return best;
    }

    std::vector<Volume> volumes_;
    mutable u64 revision_ = 0;
    mutable u64 revision_hash_ = 0;
    std::vector<u64> atlas_key_;
    std::vector<Placed> placed_;
    Shape shape_;
    u32 atlas_width_ = 0;
    u32 atlas_height_ = 0;
    u32 atlas_depth_ = 0;
    u32 atlas_texture_ = 0;
};

}  // namespace esengine
