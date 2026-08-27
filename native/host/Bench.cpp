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

#include "Runtime.hpp"   // ESHOST_LOGI

namespace eshost {
namespace {

using Clock = std::chrono::steady_clock;

double msSince(const Clock::time_point& t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
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
    unsigned draws = 0, sprites = 0;
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
    ESHOST_LOGI("bench: {\"label\":\"%s\",\"warmup\":%ld,\"frames\":%zu,\"dt\":%.6f,"
                "\"update\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"pump\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"cpu\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"frame\":{\"min\":%.4f,\"p50\":%.4f,\"p90\":%.4f},"
                "\"draws\":%u,\"sprites\":%u,\"tickShareOfCpu\":%.4f}",
                // The FRAME span's count is the authority on how many frames were
                // sampled: a frame can be abandoned after it began and reach no other span.
                s.label.c_str(), s.warmup, s.frame.ms.size(), s.dt,
                at(s.update.ms, 0.0), at(s.update.ms, 0.5), at(s.update.ms, 0.9),
                at(s.pump.ms, 0.0), p50, at(s.pump.ms, 0.9),
                at(s.cpu.ms, 0.0), c50, at(s.cpu.ms, 0.9),
                at(s.frame.ms, 0.0), at(s.frame.ms, 0.5), at(s.frame.ms, 0.9),
                s.draws, s.sprites, share);
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
    ++s.seen;
    if (timing()) {
        s.frame.begin();
        s.cpu.begin();
    }
}

void benchUpdateBegin() { if (timing()) state().update.begin(); }
void benchUpdateEnd() { if (timing()) state().update.end(); }
void benchPumpBegin() { if (timing()) state().pump.begin(); }
void benchPumpEnd() { if (timing()) state().pump.end(); }
void benchBeforePresent() { if (timing()) state().cpu.end(); }

void benchNoteDraws(unsigned draws, unsigned sprites) {
    if (!timing()) return;
    state().draws = draws;
    state().sprites = sprites;
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
