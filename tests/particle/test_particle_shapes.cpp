// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_particle_shapes.cpp — emission shapes as the DISTRIBUTIONS they are.
 *
 * A frame cannot answer "is this isotropic": a projection hides a bias along the
 * view axis. Header-only, so these run in the local harness.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/particle/ParticleShapes.hpp>
#include <algorithm>
#include <glm/gtc/quaternion.hpp>
#include <cmath>
#include <vector>

using namespace esengine;
using namespace esengine::particle;

// ============================================================================
// Spawn shapes — the distributions, asked as distributions
// ============================================================================

namespace {

// A cheap deterministic uniform, so a failure is a bug and never a seed.
struct Lcg {
    u32 s = 12345u;
    f32 operator()(f32 a, f32 b) {
        s = s * 1664525u + 1013904223u;
        return a + (b - a) * (static_cast<f32>((s >> 8) & 0xFFFFFFu) / 16777216.0f);
    }
};

ecs::ParticleEmitter emitterWith(ecs::EmitterShape shape) {
    ecs::ParticleEmitter e{};
    e.shape = static_cast<i32>(shape);
    e.shapeRadius = 100.0f;
    e.shapeAngle = 30.0f;
    return e;
}

constexpr u32 kSamples = 60000;

}  // namespace

TEST_CASE("sphere_directions_have_no_polar_bias") {
    Lcg rng;
    auto e = emitterWith(ecs::EmitterShape::Sphere);
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };

    // Six axis-aligned half-spaces. Uniform directions put half the samples in
    // each, and a latitude/longitude parameterisation does not: it crowds the
    // poles, which shows up as +Y/-Y holding more than their share.
    u32 pos[3] = {0, 0, 0};
    // Equal-area bands about the polar axis. Splitting the FULL range of y into
    // four equal slabs is the sharper question: a pole-crowding sampler fills the
    // outer slabs and starves the middle ones even while the halves stay even.
    u32 band[4] = {0, 0, 0, 0};
    for (u32 i = 0; i < kSamples; ++i) {
        const glm::vec3 d = sampleShape(e, rand).direction;
        CHECK(std::abs(glm::length(d) - 1.0f) < 1e-3f);
        if (d.x > 0.0f) ++pos[0];
        if (d.y > 0.0f) ++pos[1];
        if (d.z > 0.0f) ++pos[2];
        band[std::min(3, static_cast<i32>((d.y + 1.0f) * 2.0f))]++;
    }
    const f32 half = static_cast<f32>(kSamples) * 0.5f;
    for (u32 axis : pos) CHECK(std::abs(static_cast<f32>(axis) - half) < half * 0.03f);
    const f32 quarter = static_cast<f32>(kSamples) * 0.25f;
    for (u32 b : band) CHECK(std::abs(static_cast<f32>(b) - quarter) < quarter * 0.05f);
}

TEST_CASE("hemisphere_stays_in_its_half_and_is_not_a_flat_circle") {
    Lcg rng;
    auto e = emitterWith(ecs::EmitterShape::Hemisphere);
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };

    u32 offAxis = 0;   // any real depth at all — a Circle would have none
    f32 sumY = 0.0f;
    for (u32 i = 0; i < kSamples; ++i) {
        const glm::vec3 d = sampleShape(e, rand).direction;
        CHECK(d.y >= -1e-4f);          // the +Y half, and nothing outside it
        if (std::abs(d.z) > 0.05f) ++offAxis;
        sumY += d.y;
    }
    // A hemisphere that quietly degenerated into a ring in the XY plane would put
    // every sample at z == 0; a real one spreads through the third dimension.
    CHECK(offAxis > kSamples / 3);
    // Mean height of a uniform hemisphere is 1/2. A ring would read ~0.64, a
    // cosine-weighted lobe ~0.67 — both far outside this window.
    CHECK(std::abs(sumY / static_cast<f32>(kSamples) - 0.5f) < 0.02f);
}

TEST_CASE("cone_is_a_solid_angle_about_local_up") {
    Lcg rng;
    auto e = emitterWith(ecs::EmitterShape::Cone);
    e.shapeAngle = 30.0f;   // half-angle 15 degrees
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };

    const f32 cosHalf = std::cos(15.0f * math::DEG_TO_RAD);
    u32 offAxis = 0;
    for (u32 i = 0; i < kSamples; ++i) {
        const glm::vec3 d = sampleShape(e, rand).direction;
        CHECK(d.y >= cosHalf - 1e-3f);           // inside the cap, about +Y
        if (std::abs(d.z) > 0.02f) ++offAxis;
    }
    // A planar fan would leave z at zero for every sample.
    CHECK(offAxis > kSamples / 4);
}

TEST_CASE("point_and_box_keep_the_planar_aim_2d_content_authored") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    for (auto shape : {ecs::EmitterShape::Point, ecs::EmitterShape::Box}) {
        auto e = emitterWith(shape);
        e.angleSpreadMin = 90.0f;
        e.angleSpreadMax = 90.0f;
        const glm::vec3 d = sampleShape(e, rand).direction;
        // 90 degrees in the local plane is +Y, exactly where it always pointed.
        CHECK(d.y > 0.999f);
        CHECK(std::abs(d.z) < 1e-5f);
    }
}

TEST_CASE("box_fills_its_volume_and_a_flat_one_stays_flat") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    auto e = emitterWith(ecs::EmitterShape::Box);
    e.shapeSize = glm::vec3(200.0f, 100.0f, 0.0f);
    for (u32 i = 0; i < 2000; ++i) {
        const glm::vec3 p = sampleShape(e, rand).position;
        CHECK(std::abs(p.x) <= 100.0f);
        CHECK(std::abs(p.y) <= 50.0f);
        CHECK(p.z == 0.0f);   // a depthless box is the rectangle 2D always had
    }
    e.shapeSize.z = 60.0f;
    u32 withDepth = 0;
    for (u32 i = 0; i < 2000; ++i) {
        if (std::abs(sampleShape(e, rand).position.z) > 1.0f) ++withDepth;
    }
    CHECK(withDepth > 1800);
}

// ============================================================================
// The emitter's own frame
// ============================================================================

TEST_CASE("a rotated emitter carries its cone with it") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    auto e = emitterWith(ecs::EmitterShape::Cone);
    e.shapeAngle = 20.0f;

    // 90 degrees about X takes local +Y onto world +Z. An emitter whose rotation
    // is read as a single angle about the view axis cannot express this at all:
    // it would keep firing along +Y however the emitter is turned.
    const EmitterFrame turned{glm::vec3(0.0f),
                              glm::angleAxis(math::HALF_PI, glm::vec3(1.0f, 0.0f, 0.0f)),
                              glm::vec3(1.0f)};
    const EmitterFrame still{};

    glm::vec3 meanStill(0.0f), meanTurned(0.0f);
    for (u32 i = 0; i < kSamples; ++i) {
        meanStill += worldDirOf(sampleShape(e, rand).direction, still);
        meanTurned += worldDirOf(sampleShape(e, rand).direction, turned);
    }
    meanStill /= static_cast<f32>(kSamples);
    meanTurned /= static_cast<f32>(kSamples);

    CHECK(meanStill.y > 0.97f);                 // unturned: up
    CHECK(meanTurned.z > 0.97f);                // turned: along +Z
    CHECK(std::abs(meanTurned.y) < 0.03f);      // and nothing left pointing up
}

TEST_CASE("scale sizes the shape and leaves the aim alone") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    auto e = emitterWith(ecs::EmitterShape::Box);
    e.shapeSize = glm::vec3(100.0f, 100.0f, 100.0f);
    const EmitterFrame big{glm::vec3(7.0f, 0.0f, 0.0f), glm::quat(1, 0, 0, 0), glm::vec3(3.0f)};

    f32 maxExtent = 0.0f;
    for (u32 i = 0; i < 4000; ++i) {
        const SpawnSample s = sampleShape(e, rand);
        const glm::vec3 w = worldPointOf(s.position, big);
        maxExtent = std::max(maxExtent, std::abs(w.x - big.position.x));
        // Translation must not reach the aim, or where the emitter STANDS would
        // decide which way its particles fly.
        CHECK(std::abs(glm::length(worldDirOf(s.direction, big)) - 1.0f) < 1e-4f);
    }
    CHECK(maxExtent > 140.0f);   // 50 * 3 = 150, so a scaled box is really bigger
    CHECK(maxExtent <= 150.1f);
}

// ============================================================================
// Arc and thickness — a part of the way round, a part of the way in
// ============================================================================

TEST_CASE("the whole arc and full thickness ask for the draws the shapes always asked for") {
    // A seeded effect must play the same after the fields exist. The expression shapes are unchanged, so asking for
    // the same ranges, as many of them, is what keeps every draw the same. (The order two operands of `*` are drawn in
    // is the compiler's, which is why this compares the ranges as a set rather than a sequence.)
    struct Range { f32 lo, hi; bool operator<(const Range& o) const { return lo != o.lo ? lo < o.lo : hi < o.hi; } };
    for (const auto shape : {ecs::EmitterShape::Circle, ecs::EmitterShape::Cone, ecs::EmitterShape::Sphere,
                             ecs::EmitterShape::Hemisphere}) {
        auto e = emitterWith(shape);
        std::vector<Range> asked;
        std::function<f32(f32, f32)> rand = [&](f32 lo, f32 hi) { asked.push_back({lo, hi}); return (lo + hi) * 0.5f; };
        (void)sampleShape(e, rand);
        std::vector<Range> want;
        const f32 r = e.shapeRadius;
        if (shape == ecs::EmitterShape::Circle) {
            want = {{0.0f, math::TWO_PI}, {0.0f, r}};
        } else {
            const f32 half = shape == ecs::EmitterShape::Cone ? e.shapeAngle * 0.5f * math::DEG_TO_RAD
                           : shape == ecs::EmitterShape::Sphere ? math::PI : math::HALF_PI;
            want = {{std::cos(half), 1.0f}, {0.0f, math::TWO_PI}, {std::cos(half), 1.0f}, {0.0f, math::TWO_PI},
                    shape == ecs::EmitterShape::Cone ? Range{0.0f, r} : Range{0.0f, 1.0f}};
        }
        std::sort(asked.begin(), asked.end());
        std::sort(want.begin(), want.end());
        REQUIRE(asked.size() == want.size());
        for (size_t i = 0; i < want.size(); ++i) {
            CHECK(asked[i].lo == doctest::Approx(want[i].lo));
            CHECK(asked[i].hi == doctest::Approx(want[i].hi));
        }
    }
}

TEST_CASE("a quarter arc keeps a circle in its first quadrant") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    auto e = emitterWith(ecs::EmitterShape::Circle);
    e.shapeArc = 90.0f;
    u32 outside = 0;
    f32 widest = 0.0f;
    for (u32 i = 0; i < kSamples; ++i) {
        const glm::vec3 p = sampleShape(e, rand).position;
        if (p.x < -1e-3f || p.y < -1e-3f) ++outside;
        widest = std::max(widest, std::atan2(p.y, p.x));
    }
    CHECK(outside == 0u);
    CHECK(widest > 1.5f);  // and it reaches across the whole quarter, not part of it
}

TEST_CASE("an arc turns a sphere about its axis") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    auto e = emitterWith(ecs::EmitterShape::Sphere);
    e.shapeArc = 180.0f;   // phi in [0, pi): z = sin(phi) is never negative
    u32 behind = 0;
    for (u32 i = 0; i < kSamples; ++i) {
        const SpawnSample s = sampleShape(e, rand);
        if (s.position.z < -1e-3f || s.direction.z < -1e-3f) ++behind;
    }
    CHECK(behind == 0u);
}

TEST_CASE("no thickness is the rim alone: a ring from a circle, a shell from a sphere") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    for (const auto shape : {ecs::EmitterShape::Circle, ecs::EmitterShape::Sphere, ecs::EmitterShape::Hemisphere}) {
        auto e = emitterWith(shape);
        e.shapeThickness = 0.0f;
        f32 nearest = 1e9f, farthest = 0.0f;
        for (u32 i = 0; i < 5000; ++i) {
            const f32 r = glm::length(sampleShape(e, rand).position);
            nearest = std::min(nearest, r);
            farthest = std::max(farthest, r);
        }
        CHECK(nearest > 99.9f);
        CHECK(farthest < 100.1f);
    }
}

TEST_CASE("half the thickness is the outer half of the radius, and a shell stays uniform through its volume") {
    Lcg rng;
    std::function<f32(f32, f32)> rand = [&](f32 a, f32 b) { return rng(a, b); };
    auto e = emitterWith(ecs::EmitterShape::Sphere);
    e.shapeThickness = 0.5f;
    // Uniform in volume between r = 50 and 100: the share inside r is (r^3 - 50^3) / (100^3 - 50^3).
    u32 inner = 0;
    f32 nearest = 1e9f;
    for (u32 i = 0; i < kSamples; ++i) {
        const f32 r = glm::length(sampleShape(e, rand).position);
        nearest = std::min(nearest, r);
        if (r < 75.0f) ++inner;
    }
    const f32 expected = (75.0f * 75.0f * 75.0f - 50.0f * 50.0f * 50.0f) / (100.0f * 100.0f * 100.0f - 50.0f * 50.0f * 50.0f);
    CHECK(nearest > 49.9f);
    CHECK(std::abs(static_cast<f32>(inner) / kSamples - expected) < 0.01f);
}
