// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../ecs/components/Light.hpp"

#include <algorithm>
#include <cmath>

namespace esengine {

namespace light_pulse_detail {

inline f32 hashUnit(u32 v) {
    u32 h = v * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    h = (h >> 22u) ^ h;
    return static_cast<f32>(h >> 8u) * (1.0f / 16777216.0f);
}

/// Smooth noise in [0, 1] along @p x: a value per whole step, eased between.
inline f32 valueNoise(f64 x, u32 seed) {
    // The hash addresses a 32-bit lattice. Bound the cell before narrowing.
    constexpr f64 period = 4294967296.0;
    if (std::abs(x) >= period) x = std::fmod(x, period);
    const f64 cell = std::floor(x);
    const f32 f = static_cast<f32>(x - cell);
    const f32 ease = f * f * (3.0f - 2.0f * f);
    const u32 i = static_cast<u32>(static_cast<i64>(cell));
    const f32 a = hashUnit(i ^ (seed * 2654435761u));
    const f32 b = hashUnit((i + 1u) ^ (seed * 2654435761u));
    return a + (b - a) * ease;
}

}  // namespace light_pulse_detail

/**
 * @brief What a light's `intensity` is multiplied by at @p seconds into the frame clock: 1 at the top of a pulse,
 *        1 - pulseDepth at the bottom. @p seed is the light's own (its entity), so lights placed together do not
 *        beat in step. A light with no pulse, no rate or no depth is 1 always.
 */
inline f32 lightPulseFactor(const ecs::Light& light, f32 seconds, u32 seed) {
    const auto kind = static_cast<ecs::LightPulse>(light.pulse);
    if (kind == ecs::LightPulse::None) return 1.0f;
    const f32 rate = std::isfinite(light.pulseRate) ? std::max(light.pulseRate, 0.0f) : 0.0f;
    const f32 depth = std::isfinite(light.pulseDepth) ? std::clamp(light.pulseDepth, 0.0f, 1.0f) : 0.0f;
    if (rate <= 0.0f || depth <= 0.0f || !std::isfinite(seconds)) return 1.0f;
    const f64 cycles = static_cast<f64>(seconds) * static_cast<f64>(rate);
    f32 dip = 0.0f;  // 0 at full brightness, 1 at the bottom
    if (kind == ecs::LightPulse::Sine) {
        constexpr f32 turn = 6.28318530718f;
        const f32 cycle = static_cast<f32>(cycles - std::floor(cycles));
        const f32 phase = (cycle + light_pulse_detail::hashUnit(seed)) * turn;
        dip = 0.5f - 0.5f * std::cos(phase);
    } else {
        // Two octaves: the slow wander a flame has, and the quicker jitter on top of it.
        dip = 0.65f * light_pulse_detail::valueNoise(cycles, seed)
            + 0.35f * light_pulse_detail::valueNoise(cycles * 2.7 + 17.0, seed + 1u);
    }
    return 1.0f - depth * std::clamp(dip, 0.0f, 1.0f);
}

}  // namespace esengine
