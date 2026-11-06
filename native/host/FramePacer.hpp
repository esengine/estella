// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FramePacer.hpp
 * @brief   When a native host's next frame is due: the game's frame-rate cap,
 *          held as a cadence, and the floor that keeps a loop from spinning.
 *
 * @details One clock paces a frame, never two. The swapchain's Fifo present is
 *          that clock on every native host: it blocks until the display takes
 *          the frame, so a loop that calls frame() back to back runs at the
 *          panel's rate and no faster, and a frame that costs more than a vsync
 *          shows on the next one rather than waiting for a second clock to come
 *          round again. (Android drove frames from Choreographer callbacks on
 *          top of that present: a callback, a frame whose present blocked past
 *          the next vsync, then a callback asked for after it. A 15 ms frame on
 *          a 60 Hz cadence ran at 30 fps on a Snapdragon 8 Elite, every interval
 *          33 ms; issue #105 measured 33/50/66 ms in a real game.)
 *
 *          What this adds on top of the present is only what the present cannot
 *          know:
 *
 *          - The cap App.setTargetFrameRate asked for, with the web loop's rule
 *            (App.mainLoop): a cadence, not a minimum gap, since a gap measured
 *            frame to frame loses to jitter half the time and waits a third; and
 *            after a stall the cadence restarts from the frame that ran late.
 *          - A floor on how often a frame may start. A present stops blocking
 *            while a surface is torn down ("GetCurrentTexture was not called"),
 *            and a loop with nothing else to stop it once ran 11.5 million frames
 *            in a backgrounded app. No display needs more than kFloorFps here;
 *            a bench that asked for an uncapped present lifts it, and the cap.
 *
 *          The host loop asks untilDue(), serves input while it waits, and calls
 *          frameStarted() as it begins a frame. Plain data and steady_clock only:
 *          the same rule on every platform, testable without one.
 */
#pragma once

#include <chrono>

namespace eshost {

class FramePacer {
public:
    using Clock = std::chrono::steady_clock;

    /// The fastest any loop is let start frames when nothing else holds it back.
    static constexpr double kFloorFps = 240.0;
    /// A frame this close to its due time is due: the wait is in whole milliseconds on most platforms.
    static constexpr Clock::duration kJitter = std::chrono::milliseconds(1);

    /// The game's cap in frames per second; 0 (or less) is the display's own rate.
    void setTarget(float fps) {
        const float next = fps > 0.0f ? fps : 0.0f;
        if (next == target_) return;
        target_ = next;
        interval_ = target_ > 0.0f
            ? std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(1.0 / target_))
            : Clock::duration::zero();
        nextAt_ = Clock::time_point{};   // the cadence restarts at the next frame
    }
    float target() const { return target_; }

    /// True while a bench measures uncapped frames: the cap and the floor would be what it measured.
    void setUnbounded(bool on) { unbounded_ = on; }

    /// How long from @p now until a frame is due; zero when one is. A host stepped by a display callback, which cannot spin,
    /// passes @p floor false: it needs the cap and nothing else.
    Clock::duration untilDue(Clock::time_point now, bool floor = true) const {
        Clock::time_point due = Clock::time_point{};
        if (!unbounded_ && interval_ > Clock::duration::zero() && nextAt_ != Clock::time_point{}) due = nextAt_;
        if (floor && !unbounded_ && lastStart_ != Clock::time_point{}) {
            const auto floorAt = lastStart_ + kFloor;
            if (floorAt > due) due = floorAt;
        }
        const auto wait = due - now;
        return wait > kJitter ? wait : Clock::duration::zero();
    }

    /// A frame begins at @p now: advances the cadence.
    void frameStarted(Clock::time_point now) {
        lastStart_ = now;
        if (interval_ <= Clock::duration::zero()) return;
        // More than a frame behind (a stall, a pause): the cadence restarts here.
        nextAt_ = (nextAt_ == Clock::time_point{} || now - nextAt_ > interval_) ? now + interval_ : nextAt_ + interval_;
    }

    /// The frame budget: the cap's interval, or one 60 Hz refresh when the display sets the rate.
    Clock::duration budget() const {
        return interval_ > Clock::duration::zero() ? interval_ : std::chrono::duration_cast<Clock::duration>(
            std::chrono::duration<double>(1.0 / 60.0));
    }

private:
    static constexpr Clock::duration kFloor =
        std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(1.0 / kFloorFps));
    float target_ = 0.0f;
    Clock::duration interval_ = Clock::duration::zero();
    Clock::time_point nextAt_{};
    Clock::time_point lastStart_{};
    bool unbounded_ = false;
};

}  // namespace eshost
