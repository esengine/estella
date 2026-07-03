// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
/**
 * @file    FrameProfiler.hpp
 * @brief   Per-frame CPU scope timing (ES_PROFILE_SCOPE) read by the editor profiler.
 */
#include <vector>
#include <string>
#include <cstring>
#include <cstdio>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

namespace esengine {

inline double es_profile_now_ms() {
#ifdef __EMSCRIPTEN__
    return emscripten_get_now();
#else
    return 0.0;
#endif
}

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

    void counter(const char* name, double value) {
        for (auto& e : counters_cur_) {
            if (std::strcmp(e.name, name) == 0) { e.ms = value; return; }
        }
        counters_cur_.push_back({name, value});
    }

    void commit() {
        last_.swap(cur_);
        cur_.clear();
        counters_last_.swap(counters_cur_);
        counters_cur_.clear();
    }

    std::string lastJson() const { return toJson(last_); }
    std::string lastCountersJson() const { return toJson(counters_last_); }

private:
    struct Entry { const char* name; double ms; };

    static std::string toJson(const std::vector<Entry>& v) {
        std::string s = "{";
        for (std::size_t i = 0; i < v.size(); ++i) {
            if (i) s += ',';
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.4f", v[i].ms);
            s += '"';
            s += v[i].name;
            s += "\":";
            s += buf;
        }
        s += '}';
        return s;
    }

    std::vector<Entry> cur_;
    std::vector<Entry> last_;
    std::vector<Entry> counters_cur_;
    std::vector<Entry> counters_last_;
    bool enabled_ = false;
};

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
#define ES_PROFILE_SCOPE(name) ::esengine::ScopeTimer ES_PROFILE_CONCAT(es_scope_, __LINE__)(name)
#define ES_PROFILE_COUNTER(name, value) \
    do { if (::esengine::FrameProfiler::get().enabled()) ::esengine::FrameProfiler::get().counter(name, static_cast<double>(value)); } while (0)

} // namespace esengine
