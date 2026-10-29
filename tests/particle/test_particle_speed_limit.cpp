// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_particle_speed_limit.cpp — a speed limit pulls a fast particle back, at a rate that does not depend on the frame rate.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/particle/ParticleSpeedLimit.hpp>

using namespace esengine;
using namespace esengine::particle;

TEST_CASE("a particle within the limit is left alone") {
    const glm::vec3 v{3, 4, 0};   // speed 5
    CHECK(limitedVelocity(v, 5.0f, 1.0f, 0.016f) == v);
    CHECK(limitedVelocity(v, 9.0f, 0.5f, 0.016f) == v);
}

TEST_CASE("a limit of zero is no limit") {
    const glm::vec3 v{30, 40, 0};
    CHECK(limitedVelocity(v, 0.0f, 1.0f, 0.016f) == v);
}

TEST_CASE("full dampening clamps to the limit at once and keeps the direction") {
    const glm::vec3 out = limitedVelocity({30, 40, 0}, 10.0f, 1.0f, 0.016f);
    CHECK(glm::length(out) == doctest::Approx(10.0f));
    CHECK(out.x / out.y == doctest::Approx(0.75f));
}

TEST_CASE("partial dampening removes part of the excess, and never goes under the limit") {
    // speed 20, limit 10, one 1/60 s frame at dampen 0.25: a quarter of the excess goes
    const glm::vec3 out = limitedVelocity({20, 0, 0}, 10.0f, 0.25f, 1.0f / 60.0f);
    CHECK(out.x == doctest::Approx(10.0f + 10.0f * 0.75f));
    glm::vec3 v{20, 0, 0};
    for (int i = 0; i < 600; ++i) v = limitedVelocity(v, 10.0f, 0.25f, 1.0f / 60.0f);
    CHECK(glm::length(v) >= 10.0f - 1e-4f);
    CHECK(glm::length(v) == doctest::Approx(10.0f).epsilon(1e-3));
}

TEST_CASE("the braking per second is the same at 30 and at 120 frames per second") {
    glm::vec3 slow{20, 0, 0}, fast{20, 0, 0};
    for (int i = 0; i < 30; ++i) slow = limitedVelocity(slow, 10.0f, 0.1f, 1.0f / 30.0f);
    for (int i = 0; i < 120; ++i) fast = limitedVelocity(fast, 10.0f, 0.1f, 1.0f / 120.0f);
    CHECK(slow.x == doctest::Approx(fast.x).epsilon(1e-3));
}
