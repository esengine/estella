// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

#include <glm/glm.hpp>

namespace esengine::ecs {

ES_ENUM()
enum class MaskMode : u8 {
    Scissor,
    Stencil
};

ES_COMPONENT()
struct UIMask {
    ES_PROPERTY()
    bool enabled{true};
    ES_PROPERTY()
    MaskMode mode{MaskMode::Scissor};

    /**
     * Stencil mode only: clip to the SHAPE this node draws rather than its box. 0 (default) keeps the box, as a
     * plain rounded panel wants; above 0, fragments whose alpha is below the cutoff write no stencil, so a circular
     * sprite masks a circle, as an avatar frame needs.
     */
    ES_PROPERTY(tooltip="Stencil only: above 0, clip to the mask sprite's shape instead of its box.")
    f32 alphaCutoff{0.0f};

    /**
     * Scissor only: how far in from its edges, in the mask's own units (UI pixels), what it holds fades in instead of being cut:
     * x the left and right edges, y the bottom and top. A compass or a ticker whose ends dissolve, a list that fades at its top.
     * 0 (default) is the hard edge. Drawn by the batch (sprites, UI visuals, text); a material's own shader is cut, not faded.
     */
    ES_PROPERTY(optional, min=0, tooltip="Scissor only: fade what the mask holds in from its edges over this many UI pixels (x: left and right, y: bottom and top) instead of cutting it. 0 is the hard edge.")
    glm::vec2 softness{0.0f, 0.0f};
};

}  // namespace esengine::ecs
