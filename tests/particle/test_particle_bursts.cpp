// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_particle_bursts.cpp — a burst schedule fires each burst once per pass of the clock, and a looping emitter passes every duration.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/particle/ParticleBursts.hpp>

using namespace esengine;
using namespace esengine::particle;

namespace {
/// Runs the clock in fixed steps the way the system does, and totals what the schedule released.
u32 run(const std::vector<ScheduledBurst>& schedule, f32 length, f32 duration, bool looping, f32 dt = 1.0f / 60.0f) {
    u32 total = 0;
    f32 prev = -1.0f, clock = 0.0f;
    while (clock < length) {
        clock += dt;
        total += burstsDue(schedule, prev, clock, duration, looping);
        prev = clock;
    }
    return total;
}
}  // namespace

TEST_CASE("a burst at zero fires on the first step, once") {
    const std::vector<ScheduledBurst> s{{0.0f, 7}};
    CHECK(burstsDue(s, -1.0f, 1.0f / 60.0f, 5.0f, false) == 7);
    CHECK(burstsDue(s, 1.0f / 60.0f, 2.0f / 60.0f, 5.0f, false) == 0);
}

TEST_CASE("each burst of a schedule fires once as the clock passes it") {
    const std::vector<ScheduledBurst> s{{0.0f, 5}, {0.5f, 3}, {1.2f, 2}};
    CHECK(run(s, 4.0f, 5.0f, false) == 10);
}

TEST_CASE("a burst after the end of a one-shot emitter never fires") {
    const std::vector<ScheduledBurst> s{{9.0f, 4}};
    CHECK(run(s, 4.0f, 5.0f, false) == 0);
}

TEST_CASE("a looping emitter repeats the schedule every duration") {
    const std::vector<ScheduledBurst> s{{0.5f, 3}};
    // 2.1 s of a 1 s loop passes 0.5, 1.5 (and starts a third pass at 2.0, not yet at 2.5)
    CHECK(run(s, 2.1f, 1.0f, true) == 6);
}

TEST_CASE("a step that spans a whole cycle still releases every burst") {
    const std::vector<ScheduledBurst> s{{0.25f, 1}, {0.75f, 1}};
    CHECK(burstsDue(s, 0.0f, 2.0f, 1.0f, true) == 4);
}

TEST_CASE("an empty schedule releases nothing") {
    CHECK(burstsDue({}, -1.0f, 3.0f, 1.0f, true) == 0);
}
