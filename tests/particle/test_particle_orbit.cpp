// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_particle_orbit.cpp — orbital and radial velocity: where a particle is after a step, and that the orbit
 *        does not depend on the frame rate. Header-only.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/particle/ParticleOrbit.hpp>
#include <esengine/particle/ParticleStretch.hpp>

using namespace esengine;
using namespace esengine::particle;

namespace {
const glm::quat kStill{1.0f, 0.0f, 0.0f, 0.0f};
bool closeTo(glm::vec3 a, glm::vec3 b, f32 tol = 1e-3f) { return glm::length(a - b) < tol; }
}  // namespace

TEST_CASE("a quarter turn a second about Z carries +X to +Y") {
    const glm::vec3 p = orbitStep({100.0f, 0.0f, 0.0f}, glm::vec3(0.0f), kStill, {0.0f, 0.0f, 90.0f}, 0.0f, 1.0f);
    CHECK(closeTo(p, {0.0f, 100.0f, 0.0f}));
}

TEST_CASE("the orbit is about the centre given, not the origin") {
    const glm::vec3 c{10.0f, 20.0f, 30.0f};
    const glm::vec3 p = orbitStep(c + glm::vec3(5.0f, 0.0f, 0.0f), c, kStill, {0.0f, 0.0f, 180.0f}, 0.0f, 1.0f);
    CHECK(closeTo(p, c + glm::vec3(-5.0f, 0.0f, 0.0f)));
}

TEST_CASE("the axes are the emitter's: a circle laid flat swirls in the ground plane") {
    // Turned -90 degrees about X, the emitter's local Z points along world +Y.
    const glm::quat flat = glm::angleAxis(-math::HALF_PI, glm::vec3(1.0f, 0.0f, 0.0f));
    const glm::vec3 p = orbitStep({100.0f, 0.0f, 0.0f}, glm::vec3(0.0f), flat, {0.0f, 0.0f, 90.0f}, 0.0f, 1.0f);
    CHECK(std::abs(p.y) < 1e-3f);                       // stays on the ground
    CHECK(std::abs(glm::length(p) - 100.0f) < 1e-3f);   // and on its circle
    CHECK(std::abs(p.x) < 1e-3f);                       // a quarter of the way round
}

TEST_CASE("the orbit does not change with the frame rate") {
    glm::vec3 fine{100.0f, 0.0f, 0.0f};
    for (int i = 0; i < 240; ++i) fine = orbitStep(fine, glm::vec3(0.0f), kStill, {0.0f, 0.0f, 90.0f}, 0.0f, 1.0f / 240.0f);
    const glm::vec3 coarse = orbitStep({100.0f, 0.0f, 0.0f}, glm::vec3(0.0f), kStill, {0.0f, 0.0f, 90.0f}, 0.0f, 1.0f);
    CHECK(closeTo(fine, coarse, 1e-2f));
}

TEST_CASE("radial velocity moves along the line from the centre") {
    CHECK(closeTo(orbitStep({100.0f, 0.0f, 0.0f}, glm::vec3(0.0f), kStill, glm::vec3(0.0f), 50.0f, 1.0f), {150.0f, 0.0f, 0.0f}));
    CHECK(closeTo(orbitStep({0.0f, 0.0f, 80.0f}, glm::vec3(0.0f), kStill, glm::vec3(0.0f), -30.0f, 1.0f), {0.0f, 0.0f, 50.0f}));
}

TEST_CASE("drawing in stops at the centre instead of passing through it") {
    CHECK(closeTo(orbitStep({10.0f, 0.0f, 0.0f}, glm::vec3(0.0f), kStill, glm::vec3(0.0f), -500.0f, 1.0f), glm::vec3(0.0f)));
    // And a particle at the centre stays there: it has no line to move along.
    CHECK(closeTo(orbitStep(glm::vec3(0.0f), glm::vec3(0.0f), kStill, {0.0f, 0.0f, 90.0f}, 100.0f, 1.0f), glm::vec3(0.0f)));
}

TEST_CASE("only the ground and upright modes change how the quad is oriented") {
    ecs::ParticleEmitter e{};
    e.renderMode = static_cast<i32>(ecs::ParticleRenderMode::Billboard);
    CHECK(renderAlignment(e) == 0u);
    e.renderMode = static_cast<i32>(ecs::ParticleRenderMode::Stretched);
    CHECK(renderAlignment(e) == 0u);
    e.renderMode = static_cast<i32>(ecs::ParticleRenderMode::Horizontal);
    CHECK(renderAlignment(e) == 1u);
    e.renderMode = static_cast<i32>(ecs::ParticleRenderMode::Vertical);
    CHECK(renderAlignment(e) == 2u);
}
