// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The native hosts' frame pacer (native/host/FramePacer.hpp): the game's
 *        cap held as a cadence, the web loop's rule, and the floor that keeps a
 *        loop whose present stopped blocking from spinning. Header-only and
 *        clock-free in its inputs, so the rule is tested here rather than on a
 *        device.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "FramePacer.hpp"

using eshost::FramePacer;
using Clock = FramePacer::Clock;
using std::chrono::microseconds;
using std::chrono::milliseconds;

namespace {
const Clock::time_point T0 = Clock::time_point{} + std::chrono::hours(1);
Clock::time_point at(double ms) { return T0 + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double, std::milli>(ms)); }
double ms(Clock::duration d) { return std::chrono::duration<double, std::milli>(d).count(); }
}  // namespace

TEST_CASE("with no cap the present paces, and only the floor holds a frame back") {
    FramePacer p;
    CHECK(p.untilDue(at(0)) == Clock::duration::zero());
    p.frameStarted(at(0));
    // A present that blocked: the next frame is due at once.
    CHECK(p.untilDue(at(16.7)) == Clock::duration::zero());
    // One that did not (a surface going away): held to the floor, 1/240 s after the last start.
    CHECK(ms(p.untilDue(at(0.5))) == doctest::Approx(1000.0 / FramePacer::kFloorFps - 0.5).epsilon(0.01));
}

TEST_CASE("a display-stepped host asks for the cap alone") {
    FramePacer p;
    p.frameStarted(at(0));
    CHECK(p.untilDue(at(2.0), /*floor=*/false) == Clock::duration::zero());
    p.setTarget(30.0f);
    p.frameStarted(at(10));
    CHECK(ms(p.untilDue(at(26.7), false)) == doctest::Approx(16.67).epsilon(0.01));
}

TEST_CASE("a bench lifts the floor and the cap") {
    FramePacer p;
    p.setUnbounded(true);
    p.frameStarted(at(0));
    CHECK(p.untilDue(at(0.1)) == Clock::duration::zero());
    p.setTarget(60.0f);
    p.frameStarted(at(1));
    CHECK(p.untilDue(at(1.1)) == Clock::duration::zero());
}

TEST_CASE("a cap is a cadence, not a gap") {
    FramePacer p;
    p.setTarget(30.0f);
    p.frameStarted(at(0));
    // Due 33.3 ms after the first start, whenever the frame itself ended.
    CHECK(ms(p.untilDue(at(20))) == doctest::Approx(13.33).epsilon(0.01));
    // A frame that starts a little late does not push the next one late: the cadence is kept.
    p.frameStarted(at(35));
    CHECK(ms(p.untilDue(at(40))) == doctest::Approx(26.67).epsilon(0.01));
    // Within the jitter of due counts as due (a millisecond-granular wait wakes a little early).
    CHECK(p.untilDue(at(66.0)) == Clock::duration::zero());
}

TEST_CASE("after a stall the cadence restarts from the late frame") {
    FramePacer p;
    p.setTarget(60.0f);
    p.frameStarted(at(0));
    p.frameStarted(at(200));   // a stall: far more than one interval behind
    // Not a burst of catch-up frames: the next is one interval after the late one.
    CHECK(ms(p.untilDue(at(201))) == doctest::Approx(15.67).epsilon(0.01));
}

TEST_CASE("changing the cap restarts the cadence") {
    FramePacer p;
    p.setTarget(30.0f);
    p.frameStarted(at(0));
    p.setTarget(60.0f);
    CHECK(p.target() == 60.0f);
    // No stale 33 ms deadline: only the floor applies until the next frame starts the new cadence.
    CHECK(p.untilDue(at(10)) == Clock::duration::zero());
    p.frameStarted(at(10));
    CHECK(ms(p.untilDue(at(11))) == doctest::Approx(15.67).epsilon(0.01));
    CHECK(ms(p.budget()) == doctest::Approx(16.67).epsilon(0.01));
    p.setTarget(0.0f);
    CHECK(ms(p.budget()) == doctest::Approx(16.67).epsilon(0.01));
}
