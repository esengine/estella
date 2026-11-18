// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <string_view>

namespace esengine {

enum class QualityValue : u32 {
    LoopLights,
    TiledLights,
    ShadowTiles,
    Count,
};

struct QualityValueSpec {
    QualityValue id;
    const char* name;
    f32 fallback;
    f32 cap;
};

inline constexpr QualityValueSpec QUALITY_VALUE_SPECS[] = {
    {QualityValue::LoopLights, "loopLights", 16.0f, 16.0f},
    {QualityValue::TiledLights, "tiledLights", 96.0f, 96.0f},
    {QualityValue::ShadowTiles, "shadowTiles", 16.0f, 16.0f},
};

inline constexpr u32 QUALITY_VALUE_COUNT = static_cast<u32>(QualityValue::Count);

static_assert(std::size(QUALITY_VALUE_SPECS) == QUALITY_VALUE_COUNT, "one spec per QualityValue");

constexpr bool qualitySpecsInOrder() {
    for (u32 i = 0; i < QUALITY_VALUE_COUNT; ++i) {
        if (static_cast<u32>(QUALITY_VALUE_SPECS[i].id) != i) return false;
    }
    return true;
}
static_assert(qualitySpecsInOrder(), "QUALITY_VALUE_SPECS is indexed by QualityValue");

constexpr f32 qualityCap(QualityValue id) { return QUALITY_VALUE_SPECS[static_cast<u32>(id)].cap; }

class QualityValues {
public:
    QualityValues() { reset(); }

    void reset() {
        for (u32 i = 0; i < QUALITY_VALUE_COUNT; ++i) values_[i] = QUALITY_VALUE_SPECS[i].fallback;
    }

    bool set(std::string_view name, f32 value) {
        for (u32 i = 0; i < QUALITY_VALUE_COUNT; ++i) {
            const QualityValueSpec& spec = QUALITY_VALUE_SPECS[i];
            if (name != spec.name) continue;
            values_[i] = std::isfinite(value) ? std::clamp(value, 0.0f, spec.cap) : spec.fallback;
            return true;
        }
        return false;
    }

    f32 get(QualityValue id) const { return values_[static_cast<u32>(id)]; }

    u32 count(QualityValue id) const { return static_cast<u32>(std::lround(get(id))); }

private:
    std::array<f32, QUALITY_VALUE_COUNT> values_{};
};

}  // namespace esengine
