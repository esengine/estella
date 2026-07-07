// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../animation/EasingFunctions.hpp"
#include "../ecs/components/ParticleEmitter.hpp"

namespace esengine::particle {

// The enum's single source is the ES_ENUM ParticleEasing beside the component
// fields that serialize it (EHT generates the TS const + editor dropdown from
// there); the sim keeps its historical local name.
using EasingType = ecs::ParticleEasing;

// Delegates to the shared easing library so the math lives in ONE place
// (easing consolidation). Particle keeps its own 4-value
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
