#pragma once

#include "../core/Types.hpp"

namespace esengine::particle {

enum class EasingType : i32 {
    Linear = 0,
    EaseIn = 1,
    EaseOut = 2,
    EaseInOut = 3,
};

inline f32 applyEasing(EasingType type, f32 t) {
    switch (type) {
        case EasingType::EaseIn:
            return t * t;
        case EasingType::EaseOut:
            return t * (2.0f - t);
        case EasingType::EaseInOut: {
            if (t < 0.5f) {
                return 2.0f * t * t;
            }
            return -1.0f + (4.0f - 2.0f * t) * t;
        }
        case EasingType::Linear:
        default:
            return t;
    }
}

}  // namespace esengine::particle
