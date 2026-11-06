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
 * subtracted for the signed distance; the 1D transform is exact and O(n), and
 * skips the sites that cannot change a byte of the result (see edt1d).
 */
#include "SdfGenerator.hpp"

#include <vector>
#include <cmath>
#include <algorithm>

namespace esengine::text {
namespace {

constexpr f32 kInf = 1e20f;
/** Texels of scratch kept between calls: a glyph at a time, a few hundred of them, but not a one-off giant's worth for good. */
constexpr usize kKeptScratch = 1u << 20;

struct Scratch {
    std::vector<f32> outer, inner, d, z;
    std::vector<i32> v;
};

/**
 * 1D squared-distance transform (Felzenszwalb & Huttenlocher): d[q] =
 * min_p((q-p)² + f[p]), f read every `stride` floats. The additive seed cost f is
 * what lets partially covered texels contribute fractional distances. v/z are the
 * parabola lower-envelope scratch (v: site indices, z: envelope boundaries).
 *
 * Only the sites that can matter enter the envelope, which is where a glyph's time
 * goes. One at or past `limit` is farther than anything the field encodes (a texel
 * that only it could answer has clamped either way). A zero strictly inside a run
 * of zeros answers for itself alone: past the run, an end of it is nearer. Returns
 * false when no site is left, with d untouched: the line stays as it was.
 */
bool edt1d(const f32* f, usize stride, f32* d, i32* v, f32* z, i32 n, f32 limit) {
    i32 k = -1;
    for (i32 q = 0; q < n; ++q) {
        const f32 fq = f[static_cast<usize>(q) * stride];
        if (fq >= limit) continue;
        if (fq == 0.0f && q > 0 && q + 1 < n
            && f[static_cast<usize>(q - 1) * stride] == 0.0f && f[static_cast<usize>(q + 1) * stride] == 0.0f) {
            continue;
        }
        if (k < 0) {
            k = 0;
            v[0] = q;
            z[0] = -kInf;
            z[1] = kInf;
            continue;
        }
        const f32 sq = fq + static_cast<f32>(q) * q;
        f32 s;
        while (true) {
            const i32 p = v[k];
            s = (sq - (f[static_cast<usize>(p) * stride] + static_cast<f32>(p) * p)) / (2.0f * (q - p));
            if (s > z[k]) break;
            --k;
        }
        ++k;
        v[k] = q;
        z[k] = s;
        z[k + 1] = kInf;
    }
    if (k < 0) return false;
    k = 0;
    for (i32 q = 0; q < n; ++q) {
        if (f[static_cast<usize>(q) * stride] == 0.0f) {
            d[q] = 0.0f;
            continue;
        }
        while (z[k + 1] < static_cast<f32>(q)) ++k;
        const f32 dx = static_cast<f32>(q - v[k]);
        d[q] = dx * dx + f[static_cast<usize>(v[k]) * stride];
    }
    return true;
}

/** 2D squared EDT in place: columns then rows, sharing the 1D scratch. */
void edt2d(f32* grid, i32 w, i32 h, Scratch& s, f32 limit) {
    for (i32 x = 0; x < w; ++x) {
        if (!edt1d(grid + x, static_cast<usize>(w), s.d.data(), s.v.data(), s.z.data(), h, limit)) continue;
        for (i32 y = 0; y < h; ++y) grid[static_cast<usize>(y) * w + x] = s.d[static_cast<usize>(y)];
    }
    for (i32 y = 0; y < h; ++y) {
        f32* row = grid + static_cast<usize>(y) * w;
        if (!edt1d(row, 1, s.d.data(), s.v.data(), s.z.data(), w, limit)) continue;
        std::copy_n(s.d.data(), w, row);
    }
}

}  // namespace

void sdfFromAlpha(const u8* alpha, u8* out, u32 width, u32 height, f32 spread) {
    if (!alpha || !out || width == 0 || height == 0) return;

    const i32 w = static_cast<i32>(width);
    const i32 h = static_cast<i32>(height);
    const usize n = static_cast<usize>(w) * static_cast<usize>(h);
    const usize m = static_cast<usize>(std::max(w, h));

    static thread_local Scratch scratch;
    Scratch& s = scratch;
    if (s.outer.size() < n) {
        s.outer.resize(n);
        s.inner.resize(n);
    }
    if (s.d.size() < m) {
        s.d.resize(m);
        s.v.resize(m);
        s.z.resize(m + 1);
    }
    f32* outer = s.outer.data();
    f32* inner = s.inner.data();

    // Squared distance to the glyph interior (outer) and exterior (inner).
    // Coverage seeds: a fully covered texel is interior (outer seed 0); a
    // fully empty one is exterior (inner seed 0); a partial texel sits within
    // half a texel of the edge, on the side its coverage says.
    for (usize i = 0; i < n; ++i) {
        const u8 c = alpha[i];
        if (c == 255) {
            outer[i] = 0.0f;
            inner[i] = kInf;
        } else if (c == 0) {
            outer[i] = kInf;
            inner[i] = 0.0f;
        } else {
            const f32 a = static_cast<f32>(c) / 255.0f;
            const f32 dOut = std::max(0.0f, 0.5f - a);  // toward the interior side
            const f32 dIn = std::max(0.0f, a - 0.5f);   // toward the exterior side
            outer[i] = dOut * dOut;
            inner[i] = dIn * dIn;
        }
    }

    // Past spread + 1 the byte has clamped: wherever one field is that far, the texel is fully on one side and the other is 0.
    const f32 limit = (spread > 0.0f) ? (spread + 1.0f) * (spread + 1.0f) : kInf;
    edt2d(outer, w, h, s, limit);
    edt2d(inner, w, h, s, limit);

    const f32 scale = (spread > 0.0f) ? (127.0f / spread) : 127.0f;
    for (usize i = 0; i < n; ++i) {
        // + inside, − outside, ~0 at the (sub-texel) edge. Most texels have one side at exactly 0.
        const f32 toOut = inner[i] == 0.0f ? 0.0f : std::sqrt(inner[i]);
        const f32 toIn = outer[i] == 0.0f ? 0.0f : std::sqrt(outer[i]);
        const f32 v = 128.5f + (toOut - toIn) * scale;
        out[i] = v <= 0.0f ? u8(0) : v >= 255.0f ? u8(255) : static_cast<u8>(v);
    }

    if (n > kKeptScratch) {
        s.outer = {};
        s.inner = {};
        s.d = {};
        s.v = {};
        s.z = {};
    }
}

}  // namespace esengine::text
