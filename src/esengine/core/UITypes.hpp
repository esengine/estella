// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Types.hpp"

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

}  // namespace esengine
