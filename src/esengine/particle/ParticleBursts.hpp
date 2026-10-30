#pragma once

#include "../core/Types.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

namespace esengine::particle {

/** @brief One burst of a schedule: `count` particles at `time` seconds after the emitter starts emitting. */
struct ScheduledBurst {
    f32 time = 0.0f;
    u32 count = 0;
};

/**
 * @brief How many particles the schedule releases while the emitter's clock goes from `prev` to `cur`.
 * @details A burst fires once per pass over its time: `prev < time <= cur`. A looping emitter repeats its
 *          schedule every `duration`, so each cycle the clock crossed in this step is checked. `prev` starts
 *          below zero, so a burst at 0 fires on the first step.
 */
inline u32 burstsDue(const std::vector<ScheduledBurst>& schedule, f32 prev, f32 cur, f32 duration, bool looping) {
    u32 total = 0;
    const bool cycles = looping && duration > 0.0f;
    const int first = cycles ? static_cast<int>(std::floor(std::max(prev, 0.0f) / duration)) : 0;
    const int last = cycles ? static_cast<int>(std::floor(cur / duration)) : 0;
    for (const ScheduledBurst& b : schedule) {
        for (int k = first; k <= last; ++k) {
            const f32 at = b.time + static_cast<f32>(k) * duration;
            if (prev < at && at <= cur) total += b.count;
        }
    }
    return total;
}

}  // namespace esengine::particle
