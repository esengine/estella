// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Types.hpp"

#include <string>

namespace esengine {

struct Padding {
    f32 left{0.0f};
    f32 top{0.0f};
    f32 right{0.0f};
    f32 bottom{0.0f};
};

/**
 * @brief A CSS-style length: `value` interpreted per `unit`.
 *
 * The runtime UI box model (REARCH_GUI F2/F3, see docs/REARCH_GUI.md) uses
 * Dimension for width/height/min/max/inset so one field can be pixels, a
 * percentage of the parent, or content-driven — retiring the old
 * size/offset/`-1`-sentinel scheme. Kept a flat POD (f32 + u8) so it serializes
 * through the existing EHT codegen as a registered custom struct (no per-glyph
 * unrolling). `unit` mirrors the TS `DimensionUnit` enum: 0=Px, 1=Percent, 2=Auto.
 */
struct Dimension {
    f32 value{0.0f};
    u8 unit{0};  // 0=Px, 1=Percent, 2=Auto
};

/**
 * @brief One named visual state for StateVisuals (REARCH_GUI F5).
 *
 * The element type of `StateVisuals.states` — a variable-length list that
 * replaced the old 8 hardcoded `slotN*` field quartets + stringly-keyed
 * reflection. Carried only inside `std::vector<VisualState>` (never a direct
 * pointer-accessed component field), so it may hold a std::string; it marshals
 * to JS 1:1 via embind value_object + register_vector. Colour is flat r/g/b/a
 * (not glm::vec4) so it round-trips cleanly through the vector path. `sprite` is
 * a raw texture-handle id (0 = none).
 */
struct VisualState {
    std::string name;
    f32 r{1.0f};
    f32 g{1.0f};
    f32 b{1.0f};
    f32 a{1.0f};
    u32 sprite{0};
    f32 scale{1.0f};
};

}  // namespace esengine
