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
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../resource/ProbeVolume.hpp"
#include "./ProbeConstants.hpp"

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
    bool sample(const glm::vec3& p, ProbeConstants& out) const {
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
        }
        out.irradiance[0].w = 1.0f;
        return true;
    }

private:
    std::vector<Volume> volumes_;
};

}  // namespace esengine
