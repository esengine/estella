// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_particle_stretch.cpp — a stretched particle lies along its velocity and grows with speed.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/particle/ParticleStretch.hpp>

using namespace esengine;
using namespace esengine::particle;

namespace {
constexpr f32 kPi = 3.14159265359f;
// Where a quad's +Y points once turned by `rotation`.
glm::vec2 upAfter(f32 rotation) { return {-std::sin(rotation), std::cos(rotation)}; }
}  // namespace

TEST_CASE("the quad's +Y points along the velocity, whichever way it goes") {
    for (const glm::vec2 v : {glm::vec2{3, 0}, glm::vec2{0, 2}, glm::vec2{-1, -1}, glm::vec2{4, -3}}) {
        const StretchedQuad q = stretchedQuad(v, 0.0f, 10.0f, 1.0f, 0.0f);
        const glm::vec2 up = upAfter(q.rotation);
        const glm::vec2 dir = glm::normalize(v);
        CHECK(up.x == doctest::Approx(dir.x).epsilon(1e-4));
        CHECK(up.y == doctest::Approx(dir.y).epsilon(1e-4));
    }
}

TEST_CASE("the length is the size times lengthScale plus the speed times velocityScale") {
    const StretchedQuad q = stretchedQuad({3, 4}, 0.0f, 10.0f, 2.0f, 0.5f);   // speed 5
    CHECK(q.length == doctest::Approx(10.0f * 2.0f + 5.0f * 0.5f));
}

TEST_CASE("a particle at rest keeps its own rotation and its own size") {
    const StretchedQuad q = stretchedQuad({0, 0}, 0.7f, 10.0f, 3.0f, 9.0f);
    CHECK(q.rotation == doctest::Approx(0.7f));
    CHECK(q.length == doctest::Approx(10.0f));
}

TEST_CASE("a particle moving straight up needs no turn") {
    const StretchedQuad q = stretchedQuad({0, 5}, 1.0f, 1.0f, 1.0f, 0.0f);
    CHECK(q.rotation == doctest::Approx(0.0f).epsilon(1e-4));
    (void)kPi;
}

TEST_CASE("seen head-on down the z axis, a velocity on screen is its own x and y, bit for bit") {
    for (const glm::vec3 v : {glm::vec3{3, -2, 7}, glm::vec3{-0.125f, 9.5f, 0}, glm::vec3{1e-3f, 4e5f, -2}}) {
        const glm::vec2 seen = velocityOnScreen(v, {0, 0, 1});
        CHECK(seen.x == v.x);
        CHECK(seen.y == v.y);
    }
}

TEST_CASE("seen from the side, a particle running along z lies across the screen") {
    const glm::vec2 seen = velocityOnScreen({0, 0, 5}, {40, 0, 0});
    CHECK(std::abs(seen.x) == doctest::Approx(5.0f));
    CHECK(seen.y == doctest::Approx(0.0f).epsilon(1e-6));
    const StretchedQuad q = stretchedQuad(seen, 0.0f, 1.0f, 2.0f, 0.5f);
    CHECK(q.length == doctest::Approx(1.0f * 2.0f + 5.0f * 0.5f));
}

TEST_CASE("a particle coming straight at the viewer is not drawn long") {
    const glm::vec2 seen = velocityOnScreen({0, 0, -8}, {0, 0, 30});
    CHECK(glm::length(seen) == doctest::Approx(0.0f).epsilon(1e-6));
    CHECK(stretchedQuad(seen, 0.3f, 2.0f, 4.0f, 1.0f).length == doctest::Approx(2.0f));
}

TEST_CASE("looking straight down, the quad still has a side to lie along") {
    const glm::vec2 seen = velocityOnScreen({3, 0, 4}, {0, 50, 0});
    CHECK(glm::length(seen) == doctest::Approx(5.0f));
}
