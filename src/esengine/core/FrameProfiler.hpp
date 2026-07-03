// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
/**
 * @file    FrameProfiler.hpp
 * @brief   Per-frame CPU scope timing for the editor profiler (C++ side).
 *
 * `ES_PROFILE_SCOPE("render.submit")` times its block and accumulates the ms into
 * a per-frame table — the C++ counterpart of the editor's TS `PerfMonitor.measure`
 * and the analog of UE's SCOPE_CYCLE_COUNTER / TRACE_CPUPROFILER_EVENT_SCOPE. Both
 * feed ONE per-frame breakdown: the TS layer reads these scopes over a binding and
 * shows them as `cpp.*` rows alongside its own zones, so a spike inside the engine
 * (culling vs draw submission vs a physics step) is named, not a black box.
 *
 * `commit()` snapshots the frame (called once at the end of the render) into a
 * stable buffer the binding reads. Header-only + near-free when disabled (the
 * scope short-circuits), so it can live on in the editor with no measurable cost.
 */
#include <vector>
#include <string>
#include <cstring>
#include <cstdio>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

namespace esengine {

/** High-resolution wall clock (ms). performance.now() under emscripten. */
inline double es_profile_now_ms() {
#ifdef __EMSCRIPTEN__
    return emscripten_get_now();
#else
    return 0.0; // the editor profiler is web-only; native builds don't time scopes
#endif
}

/**
 * Frame-scoped CPU scope collector (singleton). Accumulates inclusive time per
 * named scope for the frame in progress, then `commit()` swaps it to `last_` —
 * the last COMPLETE frame the binding serializes. Scope names are string literals
 * (stable for the program's life), so entries store the pointer and dedupe by
 * strcmp (a handful of scopes per frame — negligible).
 */
class FrameProfiler {
public:
    static FrameProfiler& get() {
        static FrameProfiler instance;
        return instance;
    }

    void setEnabled(bool e) { enabled_ = e; }
    bool enabled() const { return enabled_; }

    void add(const char* name, double ms) {
        for (auto& e : cur_) {
            if (std::strcmp(e.name, name) == 0) { e.ms += ms; return; }
        }
        cur_.push_back({name, ms});
    }

    /** Close the frame: the accumulated scopes become the readable snapshot. */
    void commit() {
        last_.swap(cur_);
        cur_.clear();
    }

    /** The last complete frame's scopes as a JSON object {"name": ms, …}. */
    std::string lastJson() const {
        std::string s = "{";
        for (std::size_t i = 0; i < last_.size(); ++i) {
            if (i) s += ',';
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.4f", last_[i].ms);
            s += '"';
            s += last_[i].name;
            s += "\":";
            s += buf;
        }
        s += '}';
        return s;
    }

private:
    struct Entry { const char* name; double ms; };
    std::vector<Entry> cur_;
    std::vector<Entry> last_;
    bool enabled_ = false;
};

/** RAII scope: times its block into the FrameProfiler when profiling is enabled. */
class ScopeTimer {
public:
    explicit ScopeTimer(const char* name)
        : name_(name),
          active_(FrameProfiler::get().enabled()),
          start_(active_ ? es_profile_now_ms() : 0.0) {}
    ~ScopeTimer() {
        if (active_) FrameProfiler::get().add(name_, es_profile_now_ms() - start_);
    }
    ScopeTimer(const ScopeTimer&) = delete;
    ScopeTimer& operator=(const ScopeTimer&) = delete;

private:
    const char* name_;
    bool active_;
    double start_;
};

#define ES_PROFILE_CONCAT_(a, b) a##b
#define ES_PROFILE_CONCAT(a, b) ES_PROFILE_CONCAT_(a, b)
/** Time the enclosing block as a named CPU scope (a `cpp.<name>` profiler row). */
#define ES_PROFILE_SCOPE(name) ::esengine::ScopeTimer ES_PROFILE_CONCAT(es_scope_, __LINE__)(name)

} // namespace esengine
