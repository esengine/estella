// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LightPlan.hpp
 * @brief   Which lights reached the frame, and who was turned away.
 *
 * @details The cap logged a COUNT and dropped the rest. "Three lights exceed the
 *          cap" tells a creator that something went dark and not which thing, so
 *          the only way to find out was to delete lights until one came back.
 *
 *          Named alongside ShadowPlanReport rather than folded into it: they are
 *          two different contentions over two different resources, and a light
 *          that lost its shadow tile is still lighting the scene.
 */
#pragma once

#include "../../core/Types.hpp"

#include <vector>

namespace esengine {

/** @brief Why a light did not reach the frame. */
enum class LightRefusal : u8 {
    None = 0,
    /// More lights in view than the shader's arrays hold; the dimmest gave way.
    Capacity,
};

/** @brief The refusal as a word, for a log line and for a reader. */
inline const char* lightRefusalName(LightRefusal why) {
    switch (why) {
        case LightRefusal::Capacity: return "light capacity";
        case LightRefusal::None:     break;
    }
    return "none";
}

/** @brief One light that asked to be in the frame, and what it was told. */
struct LightGrant {
    Entity light{};
    /// The light's own type, kept because a per-type cap would refuse for a
    /// reason a single number cannot express, and the day that arrives the
    /// reader should not have to guess which pool it was.
    u8 type = 0;
    /// What decided the order — the brightness the cap sorted on. Recorded so
    /// "why THIS one" has an answer that is not "it happened to be last".
    f32 brightness = 0.0f;
    LightRefusal refusal = LightRefusal::None;
};

/** @brief What the frame's light cap came to. */
struct LightCapReport {
    /// The shader's array bound — what `accepted` can never exceed.
    u32 limit = 0;
    /// Lights that asked. Equal to `accepted` when nothing was turned away.
    u32 requested = 0;
    u32 accepted = 0;
    /// Only the refused, each named. An accepted light is not listed: the
    /// question this answers is "why is this one dark", and a list of everything
    /// that worked is a list nobody reads.
    std::vector<LightGrant> refused;

    void clear() {
        requested = 0;
        accepted = 0;
        refused.clear();
    }

    /** @brief What `entity` was told, or None when it was not refused. */
    LightRefusal refusalFor(Entity entity) const {
        for (const LightGrant& g : refused) {
            if (g.light.raw == entity.raw) return g.refusal;
        }
        return LightRefusal::None;
    }
};

}  // namespace esengine
