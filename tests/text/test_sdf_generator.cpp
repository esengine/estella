// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The glyph SDF generator skips the sites of its distance transform that
 *        cannot change a byte of the result. These hold it, byte for byte, against
 *        the transform with no shortcuts, on shapes that exercise each skip.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "esengine/text/SdfGenerator.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <vector>

using esengine::u8;
using esengine::text::sdfFromAlpha;

namespace {

constexpr float kInf = 1e20f;

/** The plain Felzenszwalb–Huttenlocher transform: every site enters the envelope. */
void plain1d(const float* f, float* d, int* v, float* z, int n) {
    int k = 0;
    v[0] = 0;
    z[0] = -kInf;
    z[1] = kInf;
    for (int q = 1; q < n; ++q) {
        float s;
        while (true) {
            const int p = v[k];
            s = (f[q] + float(q) * q - (f[p] + float(p) * p)) / (2.0f * (q - p));
            if (s > z[k]) break;
            --k;
        }
        ++k;
        v[k] = q;
        z[k] = s;
        z[k + 1] = kInf;
    }
    k = 0;
    for (int q = 0; q < n; ++q) {
        while (z[k + 1] < float(q)) ++k;
        const float dx = float(q - v[k]);
        d[q] = dx * dx + f[v[k]];
    }
}

void plain2d(std::vector<float>& g, int w, int h) {
    const int m = std::max(w, h);
    std::vector<float> f(m), d(m), z(m + 1);
    std::vector<int> v(m);
    for (int x = 0; x < w; ++x) {
        for (int y = 0; y < h; ++y) f[y] = g[size_t(y) * w + x];
        plain1d(f.data(), d.data(), v.data(), z.data(), h);
        for (int y = 0; y < h; ++y) g[size_t(y) * w + x] = d[y];
    }
    for (int y = 0; y < h; ++y) {
        plain1d(&g[size_t(y) * w], d.data(), v.data(), z.data(), w);
        std::copy_n(d.data(), w, &g[size_t(y) * w]);
    }
}

std::vector<u8> plainSdf(const std::vector<u8>& alpha, int w, int h, float spread) {
    const size_t n = size_t(w) * h;
    std::vector<float> outer(n), inner(n);
    for (size_t i = 0; i < n; ++i) {
        const float a = alpha[i] / 255.0f;
        if (a >= 1.0f) { outer[i] = 0; inner[i] = kInf; }
        else if (a <= 0.0f) { outer[i] = kInf; inner[i] = 0; }
        else {
            const float dOut = std::max(0.0f, 0.5f - a), dIn = std::max(0.0f, a - 0.5f);
            outer[i] = dOut * dOut;
            inner[i] = dIn * dIn;
        }
    }
    plain2d(outer, w, h);
    plain2d(inner, w, h);
    const float scale = spread > 0 ? 127.0f / spread : 127.0f;
    std::vector<u8> out(n);
    for (size_t i = 0; i < n; ++i) {
        // Clamped before it is rounded: a grid with no exterior reads about 1e10 here, past a 32-bit long.
        const long b = std::lround(std::clamp(128.0f + (std::sqrt(inner[i]) - std::sqrt(outer[i])) * scale, -1.0f, 256.0f));
        out[i] = (u8)std::clamp(b, 0L, 255L);
    }
    return out;
}

void holdAgainstPlain(const std::vector<u8>& alpha, int w, int h, float spread) {
    std::vector<u8> out(alpha.size(), 77);
    sdfFromAlpha(alpha.data(), out.data(), (esengine::u32)w, (esengine::u32)h, spread);
    const std::vector<u8> want = plainSdf(alpha, w, h, spread);
    int worst = 0;
    for (size_t i = 0; i < out.size(); ++i) worst = std::max(worst, std::abs(int(out[i]) - int(want[i])));
    CHECK(worst == 0);
}

/** Antialiased disc: every edge direction, partial texels all round. */
void disc(std::vector<u8>& a, int w, int h, float cx, float cy, float r) {
    for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) {
        const float d = std::hypot(x + 0.5f - cx, y + 0.5f - cy) - r;
        const float c = std::clamp(0.5f - d, 0.0f, 1.0f);
        a[size_t(y) * w + x] = std::max(a[size_t(y) * w + x], (u8)std::lround(c * 255));
    }
}

}  // namespace

TEST_CASE("every skip gives the plain transform's bytes") {
    const int w = 120, h = 96;
    const size_t n = size_t(w) * h;

    SUBCASE("nothing: every line has no site in one field") {
        holdAgainstPlain(std::vector<u8>(n, 0), w, h, 12.0f);
    }
    SUBCASE("everything covered") {
        holdAgainstPlain(std::vector<u8>(n, 255), w, h, 12.0f);
    }
    SUBCASE("a single partial texel") {
        std::vector<u8> a(n, 0);
        a[size_t(40) * w + 60] = 90;
        holdAgainstPlain(a, w, h, 12.0f);
    }
    SUBCASE("hard-edged bars: long runs of zeros in both fields") {
        std::vector<u8> a(n, 0);
        for (int y = 10; y < 22; ++y) for (int x = 8; x < 110; ++x) a[size_t(y) * w + x] = 255;
        for (int y = 40; y < 90; ++y) for (int x = 50; x < 54; ++x) a[size_t(y) * w + x] = 255;
        holdAgainstPlain(a, w, h, 12.0f);
    }
    SUBCASE("ink touching every border") {
        std::vector<u8> a(n, 0);
        for (int x = 0; x < w; ++x) { a[x] = 255; a[size_t(h - 1) * w + x] = 255; }
        for (int y = 0; y < h; ++y) { a[size_t(y) * w] = 200; a[size_t(y) * w + w - 1] = 40; }
        holdAgainstPlain(a, w, h, 12.0f);
    }
    SUBCASE("antialiased discs, near and far apart past the spread") {
        std::vector<u8> a(n, 0);
        disc(a, w, h, 20, 20, 12);
        disc(a, w, h, 95, 70, 18);
        disc(a, w, h, 30, 80, 3);
        holdAgainstPlain(a, w, h, 12.0f);
        holdAgainstPlain(a, w, h, 3.0f);
        holdAgainstPlain(a, w, h, 40.0f);
    }
    SUBCASE("noise: partial texels everywhere") {
        std::vector<u8> a(n);
        unsigned seed = 12345;
        for (size_t i = 0; i < n; ++i) {
            seed = seed * 1103515245u + 12345u;
            a[i] = (seed >> 16) & 7 ? 0 : (u8)((seed >> 8) & 255);
        }
        holdAgainstPlain(a, w, h, 12.0f);
    }
    SUBCASE("no spread") {
        std::vector<u8> a(n, 0);
        disc(a, w, h, 60, 48, 20);
        holdAgainstPlain(a, w, h, 0.0f);
    }
}

TEST_CASE("sizes in turn share the kept scratch without leaking between them") {
    std::vector<u8> big(size_t(200) * 200, 0);
    disc(big, 200, 200, 100, 100, 60);
    holdAgainstPlain(big, 200, 200, 12.0f);
    std::vector<u8> small(size_t(16) * 24, 0);
    disc(small, 16, 24, 8, 12, 5);
    holdAgainstPlain(small, 16, 24, 4.0f);
    holdAgainstPlain(big, 200, 200, 12.0f);
    // Past what is kept: the scratch is dropped, and the next call has to come back with its own.
    std::vector<u8> huge(size_t(1100) * 1000, 0);
    disc(huge, 1100, 1000, 500, 500, 300);
    holdAgainstPlain(huge, 1100, 1000, 8.0f);
    holdAgainstPlain(small, 16, 24, 4.0f);
}
