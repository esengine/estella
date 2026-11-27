// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
#include "../../core/Types.hpp"
#include <glm/glm.hpp>
namespace esengine {
/// A soft-edged clip: what a UIMask with softness asks of the draws under it, per draw (DrawCommand::clip_index).
inline constexpr u32 CLIP_CONSTANTS_BINDING = 6;
inline constexpr const char* CLIP_CONSTANTS_BLOCK = "ClipConstants";
struct ClipConstants {
    /// The mask's box in framebuffer pixels, as the scissor counts them (x0, y0, x1, y1, y from the bottom).
    glm::vec4 rect{0.0f};
    /// How far in from each edge the content fades in: left, bottom, right, top, in pixels. All zero is no soft clip (the zero block).
    glm::vec4 edge{0.0f};
    bool operator==(const ClipConstants& o) const { return rect == o.rect && edge == o.edge; }
};
static_assert(sizeof(ClipConstants) == 32);
} // namespace esengine
