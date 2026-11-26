// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_light_pulse.cpp — a light's pulse: the range it moves in, that it moves, and that it moves smoothly.
 *        Header-only.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/renderer/LightPulse.hpp>

#include <algorithm>
#include <limits>

using namespace esengine;

namespace {
ecs::Light pulsing(ecs::LightPulse kind, f32 rate, f32 depth) {
    ecs::Light l{};
    l.pulse = static_cast<i32>(kind);
    l.pulseRate = rate;
    l.pulseDepth = depth;
    return l;
}
}  // namespace

TEST_CASE("no pulse, no rate or no depth leaves the intensity alone") {
    for (f32 t : {0.0f, 0.3f, 7.9f}) {
        CHECK(lightPulseFactor(pulsing(ecs::LightPulse::None, 2.0f, 0.5f), t, 1u) == 1.0f);
        CHECK(lightPulseFactor(pulsing(ecs::LightPulse::Sine, 0.0f, 0.5f), t, 1u) == 1.0f);
        CHECK(lightPulseFactor(pulsing(ecs::LightPulse::Flicker, 2.0f, 0.0f), t, 1u) == 1.0f);
    }
}

TEST_CASE("each kind stays between full and 1 - depth, and reaches across that range") {
    for (const auto kind : {ecs::LightPulse::Sine, ecs::LightPulse::Flicker}) {
        const ecs::Light l = pulsing(kind, 3.0f, 0.6f);
        f32 low = 2.0f, high = -1.0f;
        for (int i = 0; i < 6000; ++i) {
            const f32 f = lightPulseFactor(l, static_cast<f32>(i) / 600.0f, 7u);
            low = std::min(low, f);
            high = std::max(high, f);
        }
        CHECK(low >= 0.4f - 1e-4f);
        CHECK(high <= 1.0f + 1e-4f);
        CHECK(high - low > 0.35f);   // it really moves, over most of what it may
    }
}

TEST_CASE("a sine pulse repeats at its rate") {
    const ecs::Light l = pulsing(ecs::LightPulse::Sine, 2.0f, 1.0f);
    for (f32 t : {0.1f, 0.37f, 1.9f}) CHECK(std::abs(lightPulseFactor(l, t, 3u) - lightPulseFactor(l, t + 0.5f, 3u)) < 1e-3f);
}

TEST_CASE("finite clocks and rates always produce a finite pulse in range") {
    const f32 large = std::numeric_limits<f32>::max();
    for (const auto kind : {ecs::LightPulse::Sine, ecs::LightPulse::Flicker}) {
        for (const f32 t : {-large, -1.0e20f, 1.0e20f, large}) {
            for (const f32 rate : {2.0f, large}) {
                const f32 factor = lightPulseFactor(pulsing(kind, rate, 0.6f), t, 5u);
                CHECK(std::isfinite(factor));
                CHECK(factor >= 0.4f - 1e-6f);
                CHECK(factor <= 1.0f);
            }
        }
    }
}

TEST_CASE("a long-running sine pulse keeps the same phase as its fractional cycle") {
    const ecs::Light l = pulsing(ecs::LightPulse::Sine, 2.5f, 1.0f);
    const f32 referenceTime = 0.25f;
    for (const f32 t : {1'000'000.25f, -999'999.75f}) {
        CHECK(lightPulseFactor(l, t, 3u) == doctest::Approx(lightPulseFactor(l, referenceTime, 3u)).epsilon(1e-4));
    }
}
TEST_CASE("a flicker moves without jumps") {
    const ecs::Light l = pulsing(ecs::LightPulse::Flicker, 4.0f, 1.0f);
    f32 widest = 0.0f;
    for (int i = 0; i < 3000; ++i) {
        const f32 t = static_cast<f32>(i) / 1000.0f;
        widest = std::max(widest, std::abs(lightPulseFactor(l, t + 0.001f, 5u) - lightPulseFactor(l, t, 5u)));
    }
    CHECK(widest < 0.05f);   // a millisecond never moves it by a visible step
}

TEST_CASE("lights placed together do not beat in step") {
    const ecs::Light l = pulsing(ecs::LightPulse::Sine, 1.0f, 1.0f);
    CHECK(std::abs(lightPulseFactor(l, 0.0f, 1u) - lightPulseFactor(l, 0.0f, 2u)) > 1e-3f);
}
