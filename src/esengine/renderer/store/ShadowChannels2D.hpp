// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ShadowChannels2D.hpp
 * @brief   Which channel of the 2D shadow mask each casting light draws into, so lights that never meet can share one.
 * @details The mask is one screen-sized RGBA8 target, four channels, and a Lit fragment reads the channel of each light that reaches it.
 *          A channel is only wrong where two lights could both be there: a fragment that a light reaches reads that light's channel, and
 *          what ELSE was drawn into it, by a light whose shadow lands on the same fragment, would be read as this light's. So two lights
 *          may share a channel when neither's reach (where it is read) touches the other's shadow (where it is written). A scene of
 *          torches spread round a camp is then as many casting lights as it has torches, and only lights that overlap pay a channel each.
 *          Header-only and device-free, so the answer is pinned by a test and not by a frame.
 */
#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

namespace esengine {

/** @brief One light as the channel assignment sees it: where its shadows are read and where they can land. */
struct ShadowMaskLight {
    glm::vec2 pos{0.0f};
    /// Where a fragment reads this light's channel: within this distance of @ref pos.
    f32 read = 0.0f;
    /// Where its geometry can be written: within this distance of @ref pos.
    f32 write = 0.0f;
    /// A directional light is read and written everywhere, so it shares a channel with nothing.
    bool everywhere = false;
};

/** @brief Whether two lights cannot share a channel: one reads where the other writes. */
inline bool shadowMasksCollide(const ShadowMaskLight& a, const ShadowMaskLight& b) {
    if (a.everywhere || b.everywhere) return true;
    const f32 d = glm::distance(a.pos, b.pos);
    return d < a.read + b.write || d < b.read + a.write;
}

/**
 * @brief Gives each light the first channel none of its collisions hold, in the order the lights are given.
 * @param channels  How many channels the mask has.
 * @param out       One entry per light: its channel, or -1 where every channel holds a light it collides with.
 * @return          How many lights got none. A light with no channel still lights; it only casts no 2D shadow.
 */
inline u32 assignShadowChannels(const ShadowMaskLight* lights, u32 count, u32 channels, i32* out) {
    u32 dropped = 0;
    for (u32 i = 0; i < count; ++i) {
        out[i] = -1;
        for (u32 c = 0; c < channels && out[i] < 0; ++c) {
            bool free = true;
            for (u32 j = 0; j < i && free; ++j) {
                if (out[j] == static_cast<i32>(c) && shadowMasksCollide(lights[i], lights[j])) free = false;
            }
            if (free) out[i] = static_cast<i32>(c);
        }
        if (out[i] < 0) ++dropped;
    }
    return dropped;
}

}  // namespace esengine
