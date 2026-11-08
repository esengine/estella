// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "media/audio_watchdog.hpp"

#include <cstdio>

static int g_failures = 0;
#define CHECK(cond, msg)                                         \
    do {                                                         \
        if (cond) std::printf("ok:   %s\n", msg);                \
        else { std::printf("FAIL: %s\n", msg); ++g_failures; }   \
    } while (0)

using eshost::AudioWatchdog;
using Action = AudioWatchdog::Action;

static void testHealthyDeviceIsLeftAlone() {
    AudioWatchdog w;
    w.want(true, 0);
    uint64_t callbacks = 0;
    bool acted = false;
    for (double t = 0; t < 10000; t += 16) {
        callbacks += 1;
        acted |= w.tick(t, callbacks) != Action::None;
    }
    CHECK(!acted, "a device whose callback keeps running is never touched");
}

static void testSuspendedDeviceIsLeftAlone() {
    AudioWatchdog w;
    w.want(false, 0);
    bool acted = false;
    for (double t = 0; t < 60000; t += 16) acted |= w.tick(t, 7) != Action::None;
    CHECK(!acted, "a suspended device is silent on purpose and never touched");
}

static void testResumeGivesTheDeviceGraceAfterABackground() {
    AudioWatchdog w;
    w.want(true, 0);
    w.tick(16, 1);
    w.want(false, 32);
    w.want(true, 200000);
    CHECK(w.tick(200016, 1) == Action::None, "the first frame back from a long background does not count the background as silence");
    CHECK(w.tick(200000 + AudioWatchdog::kGraceMs - 1, 1) == Action::None, "nor does anything inside the grace");
    CHECK(w.tick(200000 + AudioWatchdog::kGraceMs + 1, 1) == Action::Restart, "a device that never comes back after resuming is restarted");
}

static void testEscalatesToRebuildAndBacksOff() {
    AudioWatchdog w;
    w.want(true, 0);
    double t = 0;
    Action actions[6];
    double times[6];
    for (int i = 0; i < 6; ++i) {
        Action a = Action::None;
        while (a == Action::None) { t += 16; a = w.tick(t, 0); }
        actions[i] = a;
        times[i] = t;
    }
    CHECK(actions[0] == Action::Restart && actions[1] == Action::Restart, "the first two tries restart the device");
    CHECK(actions[2] == Action::Rebuild && actions[5] == Action::Rebuild, "after that the device is rebuilt, and it keeps trying");
    CHECK(times[2] - times[1] > times[1] - times[0], "tries space out");
    CHECK(times[5] - times[4] <= AudioWatchdog::kMaxBackoffMs + 16, "but never further apart than the cap");
}

static void testRecoveryIsReportedOnceAndResets() {
    AudioWatchdog w;
    w.want(true, 0);
    double t = 0;
    while (w.tick(t += 16, 0) == Action::None) {}
    CHECK(w.failures() == 1, "a try is counted");
    w.tick(t += 16, 5);
    CHECK(w.takeRecovered(), "callbacks resuming after a try is reported as a recovery");
    CHECK(!w.takeRecovered(), "once");
    CHECK(w.failures() == 0, "and the count starts over");
}

int main() {
    testHealthyDeviceIsLeftAlone();
    testSuspendedDeviceIsLeftAlone();
    testResumeGivesTheDeviceGraceAfterABackground();
    testEscalatesToRebuildAndBacksOff();
    testRecoveryIsReportedOnceAndResets();
    if (g_failures) { std::printf("%d FAILURE(S)\n", g_failures); return 1; }
    std::printf("ALL AUDIO-WATCHDOG TESTS PASSED\n");
    return 0;
}
