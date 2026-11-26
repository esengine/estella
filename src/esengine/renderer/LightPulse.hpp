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
inline f32 valueNoise(f32 x, u32 seed) {
    const f32 cell = std::floor(x);
    const f32 f = x - cell;
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
    const f32 rate = std::isfinite(light.pulseRate) ? std::max(light.pulseRate, 0.0f) : 0.0f;
    const f32 depth = std::isfinite(light.pulseDepth) ? std::clamp(light.pulseDepth, 0.0f, 1.0f) : 0.0f;
    if (kind == ecs::LightPulse::None || rate <= 0.0f || depth <= 0.0f || !std::isfinite(seconds)) return 1.0f;
    f32 dip = 0.0f;  // 0 at full brightness, 1 at the bottom
    if (kind == ecs::LightPulse::Sine) {
        const f32 phase = light_pulse_detail::hashUnit(seed) * 6.28318530718f;
        dip = 0.5f - 0.5f * std::cos(6.28318530718f * rate * seconds + phase);
    } else {
        // Two octaves: the slow wander a flame has, and the quicker jitter on top of it.
        const f32 x = seconds * rate;
        dip = 0.65f * light_pulse_detail::valueNoise(x, seed) + 0.35f * light_pulse_detail::valueNoise(x * 2.7f + 17.0f, seed + 1u);
    }
    return 1.0f - depth * std::clamp(dip, 0.0f, 1.0f);
}

}  // namespace esengine
