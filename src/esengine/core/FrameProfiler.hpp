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

    void commit() {
        last_.swap(cur_);
        cur_.clear();
    }

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

} // namespace esengine
