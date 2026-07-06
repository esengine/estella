// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    text/SdfGenerator.cpp
 * @brief   Exact signed distance field from an antialiased coverage bitmap.
 *
 * Felzenszwalb–Huttenlocher separable squared-distance transform with
 * coverage-derived fractional seeds (tiny-sdf lineage): a partially covered
 * texel seeds the transform with (0.5 − α)², placing the edge at sub-texel
 * accuracy so magnified glyphs stay smooth. Interior and exterior fields are
 * subtracted for the signed distance; the 1D transform is exact and O(n).
 */
#include "SdfGenerator.hpp"

#include <vector>
#include <cmath>
#include <algorithm>

namespace esengine::text {
namespace {

constexpr f32 kInf = 1e20f;

/**
 * 1D squared-distance transform (Felzenszwalb & Huttenlocher): d[q] =
 * min_p((q-p)² + f[p]). The additive seed cost f is what lets partially
 * covered texels contribute fractional distances. v/z are the parabola
 * lower-envelope scratch (v: site indices, z: envelope boundaries).
 */
void edt1d(f32* f, f32* d, i32* v, f32* z, i32 n) {
    i32 k = 0;
    v[0] = 0;
    z[0] = -kInf;
    z[1] = kInf;
    for (i32 q = 1; q < n; ++q) {
        f32 s;
        while (true) {
            const i32 p = v[k];
            s = (f[q] + static_cast<f32>(q) * q - (f[p] + static_cast<f32>(p) * p))
              / (2.0f * (q - p));
            if (s > z[k]) break;
            --k;
        }
        ++k;
        v[k] = q;
        z[k] = s;
        z[k + 1] = kInf;
    }
    k = 0;
    for (i32 q = 0; q < n; ++q) {
        while (z[k + 1] < static_cast<f32>(q)) ++k;
        const f32 dx = static_cast<f32>(q - v[k]);
        d[q] = dx * dx + f[v[k]];
    }
}

/** 2D squared EDT in place: columns then rows, sharing the 1D scratch. */
void edt2d(std::vector<f32>& grid, i32 w, i32 h,
           std::vector<f32>& f, std::vector<f32>& d,
           std::vector<i32>& v, std::vector<f32>& z) {
    for (i32 x = 0; x < w; ++x) {
        for (i32 y = 0; y < h; ++y) f[static_cast<usize>(y)] = grid[static_cast<usize>(y) * w + x];
        edt1d(f.data(), d.data(), v.data(), z.data(), h);
        for (i32 y = 0; y < h; ++y) grid[static_cast<usize>(y) * w + x] = d[static_cast<usize>(y)];
    }
    for (i32 y = 0; y < h; ++y) {
        f32* row = grid.data() + static_cast<usize>(y) * w;
        edt1d(row, d.data(), v.data(), z.data(), w);
        std::copy_n(d.data(), w, row);
    }
}

}  // namespace

void sdfFromAlpha(const u8* alpha, u8* out, u32 width, u32 height, f32 spread) {
    if (!alpha || !out || width == 0 || height == 0) return;

    const i32 w = static_cast<i32>(width);
    const i32 h = static_cast<i32>(height);
    const usize n = static_cast<usize>(w) * static_cast<usize>(h);
    const i32 m = std::max(w, h);

    // Squared distance to the glyph interior (outer) and exterior (inner).
    // Coverage seeds: a fully covered texel is interior (outer seed 0); a
    // fully empty one is exterior (inner seed 0); a partial texel sits within
    // half a texel of the edge, on the side its coverage says.
    std::vector<f32> outer(n);
    std::vector<f32> inner(n);
    for (usize i = 0; i < n; ++i) {
        const f32 a = static_cast<f32>(alpha[i]) / 255.0f;
        if (a >= 1.0f) {
            outer[i] = 0.0f;
            inner[i] = kInf;
        } else if (a <= 0.0f) {
            outer[i] = kInf;
            inner[i] = 0.0f;
        } else {
            const f32 dOut = std::max(0.0f, 0.5f - a);  // toward the interior side
            const f32 dIn = std::max(0.0f, a - 0.5f);   // toward the exterior side
            outer[i] = dOut * dOut;
            inner[i] = dIn * dIn;
        }
    }

    std::vector<f32> f(static_cast<usize>(m));
    std::vector<f32> d(static_cast<usize>(m));
    std::vector<i32> v(static_cast<usize>(m));
    std::vector<f32> z(static_cast<usize>(m) + 1);
    edt2d(outer, w, h, f, d, v, z);
    edt2d(inner, w, h, f, d, v, z);

    const f32 scale = (spread > 0.0f) ? (127.0f / spread) : 127.0f;
    for (usize i = 0; i < n; ++i) {
        // + inside, − outside, ~0 at the (sub-texel) edge.
        const f32 signedDist = std::sqrt(inner[i]) - std::sqrt(outer[i]);
        const i32 b = static_cast<i32>(std::lround(128.0f + signedDist * scale));
        out[i] = static_cast<u8>(std::clamp(b, 0, 255));
    }
}

}  // namespace esengine::text
