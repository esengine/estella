// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

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
     * Stencil mode only: clip to the SHAPE this node draws rather than to its
     * box. 0 (default) keeps the box — the mask's whole quad writes stencil,
     * which is what a plain rounded panel wants and what earlier scenes relied
     * on. Above 0, fragments whose alpha falls below the cutoff stop writing
     * stencil, so a circular sprite masks a circle (the Unity `Mask` behaviour
     * an avatar frame needs).
     */
    ES_PROPERTY(tooltip="Stencil only: above 0, clip to the mask sprite's shape instead of its box.")
    f32 alphaCutoff{0.0f};
};

}  // namespace esengine::ecs
