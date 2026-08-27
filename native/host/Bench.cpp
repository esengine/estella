// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Bench.cpp
 * @brief   The frame clock and its report. See Bench.hpp for what and why.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bench.hpp"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#else
#include <ctime>
#endif

#include "Runtime.hpp"   // ESHOST_LOGI

namespace eshost {
namespace {

using Clock = std::chrono::steady_clock;

double msSince(const Clock::time_point& t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

/**
 * Milliseconds of CPU this thread has actually burned, or -1 where the platform
 * will not say. A frame that WAITED reads exactly like a frame that worked, and
 * this is the only thing in the report that tells the two apart.
 */
double threadCpuMs() {
#if defined(_WIN32)
    FILETIME creation, exit, kernel, user;
    if (GetThreadTimes(GetCurrentThread(), &creation, &exit, &kernel, &user) == 0) return -1.0;
    const auto ticks = [](const FILETIME& t) {
        return (static_cast<unsigned long long>(t.dwHighDateTime) << 32) | t.dwLowDateTime;
    };
    return static_cast<double>(ticks(kernel) + ticks(user)) / 1e4;  // 100 ns ticks
#elif defined(CLOCK_THREAD_CPUTIME_ID)
    timespec ts{};
    if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts) != 0) return -1.0;
    return static_cast<double>(ts.tv_sec) * 1e3 + static_cast<double>(ts.tv_nsec) / 1e6;
#else
    return -1.0;
#endif
}

/** A span's samples, and the three numbers worth reading off them. */
struct Span {
    std::vector<double> ms;
    Clock::time_point begun{};
    void begin() { begun = Clock::now(); }
    void end() { ms.push_back(msSince(begun)); }
};

struct BenchState {
    bool asked = false;
    bool reported = false;
    bool quitAfter = true;
    long warmup = 120;
    long frames = 0;
    double dt = 1.0 / 60.0;
    std::string label;
    long seen = 0;          // frames entered, warmup included
    Span update, pump, cpu, frame;
    /** CPU actually burned inside the timed `cpu` spans, against their wall. A
     *  frame throttled by the compositor spends its span waiting, and every other
     *  number in the report reads that wait as cost. */
    double busyCpuMs = 0.0, busyWallMs = 0.0, cpuAtSpanBegin = -1.0;
    unsigned draws = 0, sprites = 0;
    /** This frame's running totals, and the last timed frame's — the same shape
     *  `draws` has, so the report reads one frame rather than an average that
     *  hides a system which stopped being dispatched to halfway through. */
    unsigned aotCandidates = 0, aotCandidatesFrame = 0;
    unsigned aotPacked = 0, aotPackedFrame = 0;
};

long envLong(const char* name, long fallback) {
    const char* v = std::getenv(name);
    if (v == nullptr || v[0] == '\0') return fallback;
    const long n = std::strtol(v, nullptr, 10);
    return n >= 0 ? n : fallback;
}

BenchState& state() {
    static BenchState s = [] {
        BenchState init;
        const char* frames = std::getenv("ESTELLA_BENCH_FRAMES");
        init.frames = envLong("ESTELLA_BENCH_FRAMES", 0);
        init.asked = frames != nullptr && frames[0] != '\0' && init.frames > 0;
        init.warmup = envLong("ESTELLA_BENCH_WARMUP", 120);
        if (const char* dt = std::getenv("ESTELLA_BENCH_DT")) {
            const double v = std::strtod(dt, nullptr);
            if (v > 0.0) init.dt = v;
        }
        if (const char* label = std::getenv("ESTELLA_BENCH_LABEL")) init.label = label;
        if (const char* quit = std::getenv("ESTELLA_BENCH_QUIT")) init.quitAfter = quit[0] != '0';
        if (init.asked) {
            init.update.ms.reserve(static_cast<size_t>(init.frames));
            init.pump.ms.reserve(static_cast<size_t>(init.frames));
            init.cpu.ms.reserve(static_cast<size_t>(init.frames));
            init.frame.ms.reserve(static_cast<size_t>(init.frames));
        }
        return init;
    }();
    return s;
}

/** Whether this frame is one of the timed ones. Warmup frames run identically —
 *  they are simply not sampled — so nothing about the loop changes at the seam. */
bool timing() {
    const BenchState& s = state();
    return s.asked && !s.reported && s.seen > s.warmup;
}

/** Quantile by position on the sorted samples, no interpolation: these are
 *  timings, and the value at a position is one that was actually observed. */
double at(std::vector<double> v, double q) {
    if (v.empty()) return 0.0;
    std::sort(v.begin(), v.end());
    size_t i = static_cast<size_t>(q * static_cast<double>(v.size() - 1) + 0.5);
    if (i >= v.size()) i = v.size() - 1;
    return v[i];
}

/** One JSON line, because a runner has to parse this and a human has to read it. */
void report() {
    BenchState& s = state();
    s.reported = true;
    const double p50 = at(s.pump.ms, 0.5);
    const double c50 = at(s.cpu.ms, 0.5);
    // The share a compiler can reach, and it is `pump` over `cpu`: `update` only
    // schedules the tick. Against `cpu`, never against `frame` — a present sleeps
    // out the rest of the refresh interval, which measures the panel.
    const double share = c50 > 0.0 ? p50 / c50 : 0.0;
    // -1, not 0: "the platform would not say" and "the frame did nothing but
    // wait" are different answers and a consumer has to be able to refuse both.
    const double busy = s.busyWallMs > 0.0 ? s.busyCpuMs / s.busyWallMs : -1.0;
    ESHOST_LOGI("bench: {\"label\":\"%s\",\"warmup\":%ld,\"frames\":%zu,\"dt\":%.6f,"
                "\"update\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"pump\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"cpu\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"frame\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"draws\":%u,\"sprites\":%u,\"aotCandidates\":%u,\"aotPacked\":%u,"
                "\"tickShareOfCpu\":%.4f,\"busy\":%.4f}",
                // The FRAME span's count is the authority on how many frames were
                // sampled: a frame can be abandoned after it began and reach no other span.
                s.label.c_str(), s.warmup, s.frame.ms.size(), s.dt,
                at(s.update.ms, 0.0), at(s.update.ms, 0.5), at(s.update.ms, 0.9),
                at(s.pump.ms, 0.0), p50, at(s.pump.ms, 0.9),
                at(s.cpu.ms, 0.0), c50, at(s.cpu.ms, 0.9),
                at(s.frame.ms, 0.0), at(s.frame.ms, 0.5), at(s.frame.ms, 0.9),
                s.draws, s.sprites, s.aotCandidatesFrame, s.aotPackedFrame, share, busy);
}

}  // namespace

bool benchWanted() { return state().asked; }

double benchDelta(double wall) {
    const BenchState& s = state();
    // The fixed step covers the warmup too: a scene that spent its warmup moving at
    // one rate and its timed frames at another is two scenes.
    return (s.asked && !s.reported) ? s.dt : wall;
}

void benchFrameBegin() {
    BenchState& s = state();
    if (!s.asked || s.reported) return;
    // Reset before the frame, not after: several compiled systems each add to
    // these and the totals are what one frame did.
    s.aotCandidates = 0;
    s.aotPacked = 0;
    ++s.seen;
    if (timing()) {
        s.frame.begin();
        s.cpu.begin();
        s.cpuAtSpanBegin = threadCpuMs();
    }
}

void benchUpdateBegin() { if (timing()) state().update.begin(); }
void benchUpdateEnd() { if (timing()) state().update.end(); }
void benchPumpBegin() { if (timing()) state().pump.begin(); }
void benchPumpEnd() { if (timing()) state().pump.end(); }
void benchBeforePresent() {
    if (!timing()) return;
    BenchState& s = state();
    s.cpu.end();
    const double now = threadCpuMs();
    if (s.cpuAtSpanBegin >= 0.0 && now >= 0.0) {
        s.busyCpuMs += now - s.cpuAtSpanBegin;
        s.busyWallMs += s.cpu.ms.back();
    }
}

void benchNoteDraws(unsigned draws, unsigned sprites) {
    if (!timing()) return;
    state().draws = draws;
    state().sprites = sprites;
}

void benchNoteAotCandidates(unsigned candidates, unsigned packed) {
    BenchState& s = state();
    if (!s.asked || s.reported) return;
    s.aotCandidates += candidates;
    s.aotPacked += packed;
    // Kept even during warmup: cheap, and it means the report has numbers even
    // if the last timed frame happened to dispatch to nothing.
    s.aotCandidatesFrame = s.aotCandidates;
    s.aotPackedFrame = s.aotPacked;
}

bool benchFrameEnd() {
    BenchState& s = state();
    if (!s.asked || s.reported) return false;
    if (!timing()) return false;
    s.frame.end();
    if (static_cast<long>(s.frame.ms.size()) < s.frames) return false;
    report();
    return s.quitAfter;
}

}  // namespace eshost
