// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ProbeVolume.hpp
 * @brief   A baked environment sampled on a grid, rather than held at one value.
 */
#pragma once

#include "../core/Types.hpp"
#include "../core/Revision.hpp"
#include "../math/Math.hpp"

#include <algorithm>
#include <atomic>
#include <vector>

namespace esengine {

/**
 * @brief Irradiance at a grid of points — an @ref Environment sampled, not held.
 *
 * @details Two shapes. DENSE: nine coefficients per probe of the grid, running x fastest then y then z, the order a
 *          bake writes and a trilinear read assumes. SPARSE: the grid cut into bricks of kBrickCells finest cells a
 *          side, each brick at a span of 1, 2, 4... finest-brick cells and carrying kBrickProbes probes (its far faces
 *          included) at its own spacing — fine where light changes against geometry, coarse in the air. Either way
 *          `resolution` is the FINEST grid's probe count, which is what places a point in it. Where the grid STANDS
 *          is the component's, so moving a volume moves the light it holds and one bake can be read at a second
 *          placement.
 */
class ProbeVolume {
public:
    /** @brief Cells a brick spans along each axis at its own spacing, and the probes it carries (its far faces too). */
    static constexpr i32 kBrickCells = 4;
    static constexpr i32 kBrickSide = kBrickCells + 1;
    static constexpr i32 kBrickProbes = kBrickSide * kBrickSide * kBrickSide;

    /** @brief Probes along each axis of the finest grid. One on an axis is a constant along it —
     *         which is what an Environment already is — so a flat volume is the
     *         same case and not a second one. */
    glm::ivec3 resolution{0};

    /** @brief Nine RGB coefficients per probe: in grid order when dense, brick after brick (each brick's probes x
     *         fastest) when sparse. */
    std::vector<glm::vec3> irradiance;

    /** @brief How much of the sky each probe sees: nine coefficients per probe, cosine-convolved like the
     *         irradiance (1 everywhere is open sky), laid out as the irradiance is. Empty for a grid baked without
     *         sky occlusion, whose irradiance then holds the sky as it was at the bake; with it, the irradiance
     *         holds the lights and bounces alone and the frame's sky is added through this. */
    std::vector<f32> skyVisibility;

    /** @brief Sparse only: each brick's first finest-brick cell (xyz) and its span in those cells (w). Empty for a
     *         dense grid. Set through setBricks, which checks they tile the grid. */
    std::vector<glm::ivec4> bricks;

    /** @brief Sparse only: which brick covers each finest-brick cell, x fastest. Built by setBricks. */
    std::vector<i32> cellBrick;

    /** @brief Changes whenever the coefficients do (a new grid, its sky visibility set): what the frame's probe
     *         atlas keys on, so it uploads a grid once and again only when the grid itself changed. Unique across
     *         grids, so a released grid whose memory a new one reuses is never mistaken for it. */
    u64 revision = 0;

    static u64 nextRevision() { return esengine::nextRevision(); }

    bool sparse() const { return !bricks.empty(); }

    /** @brief Finest-brick cells along each axis: enough for every probe interval, one on a flat axis. */
    static glm::ivec3 cellsFor(const glm::ivec3& res) {
        glm::ivec3 n{1};
        for (int a = 0; a < 3; ++a) n[a] = res[a] > 1 ? (res[a] - 1 + kBrickCells - 1) / kBrickCells : 1;
        return n;
    }
    glm::ivec3 cells() const { return cellsFor(resolution); }

    bool hasSkyVisibility() const {
        return !skyVisibility.empty() && skyVisibility.size() == static_cast<usize>(probeCount()) * 9;
    }

    /** @brief The probes the coefficients hold: the grid's for a dense one, kBrickProbes a brick for a sparse one. */
    u32 probeCount() const {
        if (resolution.x <= 0 || resolution.y <= 0 || resolution.z <= 0) return 0;
        if (sparse()) return static_cast<u32>(bricks.size()) * static_cast<u32>(kBrickProbes);
        return static_cast<u32>(resolution.x) * static_cast<u32>(resolution.y)
             * static_cast<u32>(resolution.z);
    }

    bool isValid() const {
        const u32 probes = probeCount();
        if (probes == 0 || irradiance.size() != static_cast<usize>(probes) * 9) return false;
        if (!sparse()) return true;
        const glm::ivec3 c = cells();
        return cellBrick.size() == static_cast<usize>(c.x) * static_cast<usize>(c.y) * static_cast<usize>(c.z);
    }

    /**
     * @brief Makes the grid sparse with these bricks. False, and the grid left dense, unless they tile it: every span
     *        a power of two, every brick starting on a multiple of its span inside the grid, and every finest-brick
     *        cell covered by exactly one brick.
     */
    bool setBricks(std::vector<glm::ivec4> list) {
        bricks.clear();
        cellBrick.clear();
        const glm::ivec3 c = cells();
        if (list.empty() || resolution.x <= 0 || resolution.y <= 0 || resolution.z <= 0) return false;
        std::vector<i32> owner(static_cast<usize>(c.x) * static_cast<usize>(c.y) * static_cast<usize>(c.z), -1);
        for (usize b = 0; b < list.size(); ++b) {
            const glm::ivec4 k = list[b];
            const i32 span = k.w;
            if (span <= 0 || (span & (span - 1)) != 0) return false;
            for (int a = 0; a < 3; ++a) {
                if (k[a] < 0 || k[a] >= c[a] || k[a] % span != 0) return false;
            }
            for (i32 z = k.z; z < std::min(k.z + span, c.z); ++z) {
                for (i32 y = k.y; y < std::min(k.y + span, c.y); ++y) {
                    for (i32 x = k.x; x < std::min(k.x + span, c.x); ++x) {
                        i32& o = owner[static_cast<usize>(x) + static_cast<usize>(c.x) * (static_cast<usize>(y) + static_cast<usize>(c.y) * static_cast<usize>(z))];
                        if (o >= 0) return false;
                        o = static_cast<i32>(b);
                    }
                }
            }
        }
        for (const i32 o : owner) if (o < 0) return false;
        bricks = std::move(list);
        cellBrick = std::move(owner);
        return true;
    }
};

}  // namespace esengine
