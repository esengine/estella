// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Render interpolation of physics poses. The snapshot pair and the lerp belong to
// the module rather than the SDK — they run over every dynamic body every frame,
// which the no-JIT budget bars from the JS path (docs/REARCH_NATIVE.md §3.2) — so
// the semantics the SDK used to own are pinned here: the midpoint, a first-frame
// body that must not smear, the ±π short arc, and matching a body to its previous
// pose after the body set changed.
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "esengine/bindings/PhysicsBindings.hpp"
#include "esengine/bindings/PhysicsContext.hpp"

#include <cmath>
#include <cstdint>
#include <vector>

namespace {

constexpr float kPi = 3.14159265358979323846f;

void resetSnapshots() {
    g_ctx.posePrev.clear();
    g_ctx.poseCur.clear();
    g_ctx.poseInterpolated.clear();
    g_ctx.posePrevIndex.clear();
}

void appendPose(std::vector<float>& buf, uint32_t entityId, float x, float y, float angle) {
    pushEntityBits(buf, entityId);
    buf.push_back(x);
    buf.push_back(y);
    buf.push_back(angle);
}

const float* interpolate(float alpha) {
    return reinterpret_cast<const float*>(physics_getInterpolatedTransforms(alpha));
}

uint32_t entityAt(const float* buf, size_t body) {
    uint32_t id;
    std::memcpy(&id, buf + body * 4, sizeof(uint32_t));
    return id;
}

}  // namespace

TEST_CASE("lerps prev to cur by alpha") {
    resetSnapshots();
    appendPose(g_ctx.posePrev, 7, 0.0f, 0.0f, 0.0f);
    appendPose(g_ctx.poseCur, 7, 4.0f, 8.0f, 0.0f);

    const float* out = interpolate(0.5f);
    REQUIRE(physics_getInterpolatedCount() == 1);
    CHECK(entityAt(out, 0) == 7u);
    CHECK(out[1] == doctest::Approx(2.0f));
    CHECK(out[2] == doctest::Approx(4.0f));
}

TEST_CASE("alpha of 1 reproduces a direct post-step sync") {
    resetSnapshots();
    appendPose(g_ctx.posePrev, 3, -1.0f, 5.0f, 0.25f);
    appendPose(g_ctx.poseCur, 3, 2.0f, 9.0f, 1.25f);

    const float* out = interpolate(1.0f);
    CHECK(out[1] == doctest::Approx(2.0f));
    CHECK(out[2] == doctest::Approx(9.0f));
    CHECK(out[3] == doctest::Approx(1.25f));
}

TEST_CASE("a body on its first frame does not smear") {
    resetSnapshots();
    // No previous snapshot at all: the body was created this step.
    appendPose(g_ctx.poseCur, 11, 5.0f, 6.0f, 0.75f);

    const float* out = interpolate(0.5f);
    CHECK(out[1] == doctest::Approx(5.0f));
    CHECK(out[2] == doctest::Approx(6.0f));
    CHECK(out[3] == doctest::Approx(0.75f));
}

TEST_CASE("angle takes the short way across the plus-minus pi wrap") {
    resetSnapshots();
    appendPose(g_ctx.posePrev, 1, 0.0f, 0.0f, kPi - 0.1f);
    appendPose(g_ctx.poseCur, 1, 0.0f, 0.0f, -kPi + 0.1f);

    const float* out = interpolate(0.5f);
    // Crossing pi, not sweeping back through zero.
    CHECK(std::fabs(out[3]) == doctest::Approx(kPi).epsilon(0.01));
}

TEST_CASE("a body keeps its own previous pose when the body set changed") {
    resetSnapshots();
    // Previous step held two bodies; the first was destroyed, so entity 9 has moved
    // to index 0 and the fast same-index match no longer lines up.
    appendPose(g_ctx.posePrev, 4, 100.0f, 100.0f, 0.0f);
    appendPose(g_ctx.posePrev, 9, 0.0f, 0.0f, 0.0f);
    appendPose(g_ctx.poseCur, 9, 10.0f, 20.0f, 0.0f);

    const float* out = interpolate(0.5f);
    REQUIRE(physics_getInterpolatedCount() == 1);
    CHECK(entityAt(out, 0) == 9u);
    // Interpolated against entity 9's own previous pose, not entity 4's.
    CHECK(out[1] == doctest::Approx(5.0f));
    CHECK(out[2] == doctest::Approx(10.0f));
}

TEST_CASE("no bodies yields an empty buffer") {
    resetSnapshots();
    interpolate(0.5f);
    CHECK(physics_getInterpolatedCount() == 0);
}
