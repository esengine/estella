// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../animation/EasingFunctions.hpp"

namespace esengine::particle {

enum class EasingType : i32 {
    Linear = 0,
    EaseIn = 1,
    EaseOut = 2,
    EaseInOut = 3,
};

// Delegates to the shared easing library so the math lives in ONE place
// (docs/REARCH_ANIMATION.md easing consolidation). Particle keeps its own 4-value
// enum (its serialized data format); the formulas are byte-identical to the quad
// easings, so this is behavior-preserving.
inline f32 applyEasing(EasingType type, f32 t) {
    switch (type) {
        case EasingType::EaseIn:    return animation::easeInQuad(t);
        case EasingType::EaseOut:   return animation::easeOutQuad(t);
        case EasingType::EaseInOut: return animation::easeInOutQuad(t);
        case EasingType::Linear:
        default:                    return animation::easeLinear(t);
    }
}

}  // namespace esengine::particle
