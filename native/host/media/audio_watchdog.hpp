// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <algorithm>
#include <cstdint>

namespace eshost {

class AudioWatchdog {
public:
    enum class Action { None, Restart, Rebuild };

    static constexpr double kGraceMs = 500.0;
    static constexpr double kMaxBackoffMs = 5000.0;
    static constexpr int kRestartsBeforeRebuild = 2;

    void want(bool running, double nowMs) {
        wantRunning_ = running;
        failures_ = 0;
        lastAliveMs_ = nowMs;
        nextTryMs_ = nowMs + kGraceMs;
    }

    Action tick(double nowMs, uint64_t callbacks) {
        if (!wantRunning_ || callbacks != lastCallbacks_) {
            if (wantRunning_) {
                lastAliveMs_ = nowMs;
                nextTryMs_ = nowMs + kGraceMs;
                recovered_ = failures_ > 0;
                failures_ = 0;
            }
            lastCallbacks_ = callbacks;
            return Action::None;
        }
        if (nowMs < nextTryMs_) return Action::None;
        ++failures_;
        nextTryMs_ = nowMs + std::min(kGraceMs * double(1 << std::min(failures_, 4)), kMaxBackoffMs);
        return failures_ <= kRestartsBeforeRebuild ? Action::Restart : Action::Rebuild;
    }

    bool wantRunning() const { return wantRunning_; }
    int failures() const { return failures_; }
    double silentMs(double nowMs) const { return nowMs - lastAliveMs_; }

    bool takeRecovered() {
        const bool was = recovered_;
        recovered_ = false;
        return was;
    }

private:
    bool wantRunning_ = false;
    bool recovered_ = false;
    int failures_ = 0;
    uint64_t lastCallbacks_ = 0;
    double lastAliveMs_ = 0.0;
    double nextTryMs_ = 0.0;
};

}  // namespace eshost
