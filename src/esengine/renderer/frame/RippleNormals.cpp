// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RippleNormals.hpp"

#include <algorithm>
#include <cmath>

namespace esengine {

namespace {

constexpr u32 WAVES = 96;
constexpr f32 TAU = 6.28318530718f;
/// The root mean square of a field's slope along one axis.
constexpr f32 SLOPE_RMS = 0.22f;

struct Wave { f32 kx, kz, slope, phase; };

u32 next(u32& state) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
}

f32 unit(u32& state) { return static_cast<f32>(next(state) >> 8) / 16777216.0f; }

/// Whole numbers of cycles across the texture, so the field tiles; many of them at every heading, so no two draw a lattice. A wave's
/// slope falls with its frequency as a wind sea's does (height by k^-2, slope by k^-1).
std::vector<Wave> spectrum(u32 seed) {
    std::vector<Wave> waves;
    waves.reserve(WAVES);
    u32 state = seed;
    while (waves.size() < WAVES) {
        const i32 kx = static_cast<i32>(next(state) % 81) - 40;
        const i32 kz = static_cast<i32>(next(state) % 81) - 40;
        const f32 k = std::sqrt(static_cast<f32>(kx * kx + kz * kz));
        if (k < static_cast<f32>(RIPPLE_NORMALS_LONGEST) || k > 40.0f) continue;
        waves.push_back({static_cast<f32>(kx), static_cast<f32>(kz), 1.0f / k, unit(state) * TAU});
    }
    return waves;
}

void field(u32 seed, std::vector<f32>& sx, std::vector<f32>& sz) {
    const u32 n = RIPPLE_NORMALS_SIZE;
    const std::vector<Wave> waves = spectrum(seed);
    f64 power = 0.0;
    for (u32 y = 0; y < n; ++y) {
        for (u32 x = 0; x < n; ++x) {
            const f32 u = static_cast<f32>(x) / static_cast<f32>(n), v = static_cast<f32>(y) / static_cast<f32>(n);
            f32 ax = 0.0f, az = 0.0f;
            for (const Wave& w : waves) {
                const f32 c = std::cos(TAU * (w.kx * u + w.kz * v) + w.phase) * w.slope;
                const f32 k = std::sqrt(w.kx * w.kx + w.kz * w.kz);
                ax += c * w.kx / k;
                az += c * w.kz / k;
            }
            sx[y * n + x] = ax;
            sz[y * n + x] = az;
            power += static_cast<f64>(ax) * ax + static_cast<f64>(az) * az;
        }
    }
    const f32 gain = SLOPE_RMS / std::sqrt(static_cast<f32>(power / (2.0 * n * n)));
    for (f32& v : sx) v *= gain;
    for (f32& v : sz) v *= gain;
}

u8 pack(f32 v) { return static_cast<u8>(std::clamp(v * 0.5f + 0.5f, 0.0f, 1.0f) * 255.0f + 0.5f); }

}  // namespace

std::vector<u8> buildRippleNormals() {
    const u32 n = RIPPLE_NORMALS_SIZE;
    std::vector<f32> ax(n * n), az(n * n), bx(n * n), bz(n * n);
    field(0x9E3779B9u, ax, az);
    field(0x7F4A7C15u, bx, bz);
    std::vector<u8> pixels(n * n * 4);
    for (u32 i = 0; i < n * n; ++i) {
        const f32 la = 1.0f / std::sqrt(1.0f + ax[i] * ax[i] + az[i] * az[i]);
        const f32 lb = 1.0f / std::sqrt(1.0f + bx[i] * bx[i] + bz[i] * bz[i]);
        pixels[i * 4 + 0] = pack(ax[i] * la);
        pixels[i * 4 + 1] = pack(az[i] * la);
        pixels[i * 4 + 2] = pack(bx[i] * lb);
        pixels[i * 4 + 3] = pack(bz[i] * lb);
    }
    return pixels;
}

}  // namespace esengine
