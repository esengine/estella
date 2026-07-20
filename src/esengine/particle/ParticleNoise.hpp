// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ParticleNoise.hpp
 * @brief   Deterministic curl-noise flow field for the particle Noise/Turbulence
 *          module — a pure-CPU, header-only vector field the sim advects particles
 *          along, exactly like gravity is a force in the same loop. No GPU path,
 *          no external tables, so it runs byte-identically on every platform
 *          (WeChat mini-game included).
 * @details The field is the 2D curl of a fractal-Brownian scalar potential, i.e.
 *          `flow = (∂ψ/∂y, -∂ψ/∂x)`. A curl field is divergence-free, so particles
 *          never pile up in sinks or thin out at sources the way a raw noise vector
 *          field does — the classic "swirly but even" turbulence look.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

#include <cmath>

namespace esengine::particle::noise {

// A cheap integer hash → [0,1). Self-contained (no 256-entry permutation table)
// so the field is fully determined by the lattice coordinate and nothing else.
inline f32 hash2(i32 x, i32 y) {
    u32 h = static_cast<u32>(x) * 374761393u + static_cast<u32>(y) * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    return static_cast<f32>(h) * (1.0f / 4294967295.0f);
}

// Pseudo-random unit gradient at a lattice point (angle picked from the hash).
inline glm::vec2 grad2(i32 x, i32 y) {
    f32 a = hash2(x, y) * math::TWO_PI;
    return glm::vec2(std::cos(a), std::sin(a));
}

// Perlin quintic fade — C² continuous, so the finite-difference curl below is smooth.
inline f32 fade(f32 t) { return t * t * t * (t * (t * 6.0f - 15.0f) + 10.0f); }

// Classic 2D gradient (Perlin) noise, output ~[-1, 1].
inline f32 perlin2(glm::vec2 p) {
    glm::vec2 pi = glm::floor(p);
    glm::vec2 pf = p - pi;
    auto x0 = static_cast<i32>(pi.x);
    auto y0 = static_cast<i32>(pi.y);

    f32 n00 = glm::dot(grad2(x0, y0), pf - glm::vec2(0.0f, 0.0f));
    f32 n10 = glm::dot(grad2(x0 + 1, y0), pf - glm::vec2(1.0f, 0.0f));
    f32 n01 = glm::dot(grad2(x0, y0 + 1), pf - glm::vec2(0.0f, 1.0f));
    f32 n11 = glm::dot(grad2(x0 + 1, y0 + 1), pf - glm::vec2(1.0f, 1.0f));

    f32 ux = fade(pf.x);
    f32 uy = fade(pf.y);
    f32 nx0 = math::lerp(n00, n10, ux);
    f32 nx1 = math::lerp(n01, n11, ux);
    return math::lerp(nx0, nx1, uy);
}

// Fractal-Brownian sum: `octaves` layers at doubling frequency / halving amplitude.
// octaves == 1 is plain Perlin; more octaves add the fine detail that reads as
// "turbulence". Normalised so the result stays ~[-1, 1] regardless of octave count.
inline f32 fbm2(glm::vec2 p, i32 octaves) {
    f32 sum = 0.0f, amp = 1.0f, freq = 1.0f, norm = 0.0f;
    i32 n = octaves < 1 ? 1 : (octaves > 8 ? 8 : octaves);
    for (i32 i = 0; i < n; ++i) {
        sum += amp * perlin2(p * freq);
        norm += amp;
        freq *= 2.0f;
        amp *= 0.5f;
    }
    return norm > 0.0f ? sum / norm : 0.0f;
}

// Divergence-free 2D flow: curl of the fbm scalar potential via central differences.
// The result is a ~unit-scale velocity direction+magnitude the sim scales by the
// emitter's noiseStrength. `sample` is already in noise space (position × frequency,
// plus the scroll offset), so callers fold frequency/scroll in before calling.
inline glm::vec2 curl(glm::vec2 sample, i32 octaves) {
    constexpr f32 e = 0.1f;  // finite-difference epsilon, a fraction of a lattice cell
    f32 dpdx = fbm2(sample + glm::vec2(e, 0.0f), octaves) -
               fbm2(sample - glm::vec2(e, 0.0f), octaves);
    f32 dpdy = fbm2(sample + glm::vec2(0.0f, e), octaves) -
               fbm2(sample - glm::vec2(0.0f, e), octaves);
    // curl(ψ) = (∂ψ/∂y, -∂ψ/∂x); the 0.25 tames the /(2e) gain so noiseStrength
    // reads roughly as a peak advection speed in px/s.
    return glm::vec2(dpdy, -dpdx) * (0.25f / (2.0f * e));
}

}  // namespace esengine::particle::noise
