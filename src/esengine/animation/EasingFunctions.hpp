#pragma once

#include "../core/Types.hpp"
#include "TweenData.hpp"

#include <cmath>

namespace esengine::animation {

constexpr f32 ANIM_PI = 3.14159265358979323846f;

inline f32 easeLinear(f32 t) {
    return t;
}

inline f32 easeInQuad(f32 t) {
    return t * t;
}

inline f32 easeOutQuad(f32 t) {
    return t * (2.0f - t);
}

inline f32 easeInOutQuad(f32 t) {
    return t < 0.5f ? 2.0f * t * t : -1.0f + (4.0f - 2.0f * t) * t;
}

inline f32 easeInCubic(f32 t) {
    return t * t * t;
}

inline f32 easeOutCubic(f32 t) {
    f32 t1 = t - 1.0f;
    return t1 * t1 * t1 + 1.0f;
}

inline f32 easeInOutCubic(f32 t) {
    return t < 0.5f
        ? 4.0f * t * t * t
        : (t - 1.0f) * (2.0f * t - 2.0f) * (2.0f * t - 2.0f) + 1.0f;
}

inline f32 easeInBack(f32 t) {
    constexpr f32 C1 = 1.70158f;
    constexpr f32 C3 = C1 + 1.0f;
    return C3 * t * t * t - C1 * t * t;
}

inline f32 easeOutBack(f32 t) {
    constexpr f32 C1 = 1.70158f;
    constexpr f32 C3 = C1 + 1.0f;
    f32 t1 = t - 1.0f;
    return 1.0f + C3 * t1 * t1 * t1 + C1 * t1 * t1;
}

inline f32 easeInOutBack(f32 t) {
    constexpr f32 C1 = 1.70158f;
    constexpr f32 C2 = C1 * 1.525f;
    if (t < 0.5f) {
        return (std::pow(2.0f * t, 2.0f) * ((C2 + 1.0f) * 2.0f * t - C2)) / 2.0f;
    }
    return (std::pow(2.0f * t - 2.0f, 2.0f) * ((C2 + 1.0f) * (t * 2.0f - 2.0f) + C2) + 2.0f) / 2.0f;
}

inline f32 easeInElastic(f32 t) {
    if (t == 0.0f || t == 1.0f) {
        return t;
    }
    return -std::pow(2.0f, 10.0f * t - 10.0f)
         * std::sin((t * 10.0f - 10.75f) * (2.0f * ANIM_PI / 3.0f));
}

inline f32 easeOutElastic(f32 t) {
    if (t == 0.0f || t == 1.0f) {
        return t;
    }
    return std::pow(2.0f, -10.0f * t)
         * std::sin((t * 10.0f - 0.75f) * (2.0f * ANIM_PI / 3.0f)) + 1.0f;
}

inline f32 easeInOutElastic(f32 t) {
    if (t == 0.0f || t == 1.0f) {
        return t;
    }
    constexpr f32 C5 = (2.0f * ANIM_PI) / 4.5f;
    if (t < 0.5f) {
        return -(std::pow(2.0f, 20.0f * t - 10.0f) * std::sin((20.0f * t - 11.125f) * C5)) / 2.0f;
    }
    return (std::pow(2.0f, -20.0f * t + 10.0f) * std::sin((20.0f * t - 11.125f) * C5)) / 2.0f + 1.0f;
}

inline f32 easeOutBounce(f32 t) {
    constexpr f32 N1 = 7.5625f;
    constexpr f32 D1 = 2.75f;
    if (t < 1.0f / D1) {
        return N1 * t * t;
    } else if (t < 2.0f / D1) {
        t -= 1.5f / D1;
        return N1 * t * t + 0.75f;
    } else if (t < 2.5f / D1) {
        t -= 2.25f / D1;
        return N1 * t * t + 0.9375f;
    } else {
        t -= 2.625f / D1;
        return N1 * t * t + 0.984375f;
    }
}

inline f32 cubicBezier(f32 t, f32 p1x, f32 p1y, f32 p2x, f32 p2y) {
    constexpr i32 MAX_ITERATIONS = 8;
    constexpr f32 EPSILON = 1e-6f;
    f32 x = t;
    for (i32 i = 0; i < MAX_ITERATIONS; ++i) {
        f32 ix = 1.0f - x;
        f32 cx = 3.0f * p1x * ix * ix * x
               + 3.0f * p2x * ix * x * x
               + x * x * x - t;
        if (std::abs(cx) < EPSILON) {
            break;
        }
        f32 dx = 3.0f * p1x * (1.0f - 2.0f * x) * (1.0f - x)
               + 6.0f * p2x * x * (1.0f - x)
               - 3.0f * p2x * x * x
               + 3.0f * x * x;
        if (std::abs(dx) < EPSILON) {
            break;
        }
        x -= cx / dx;
    }
    f32 ix = 1.0f - x;
    return 3.0f * p1y * ix * ix * x
         + 3.0f * p2y * ix * x * x
         + x * x * x;
}

inline f32 step(f32 t) {
    return t < 1.0f ? 0.0f : 1.0f;
}

using EasingFn = f32 (*)(f32);

inline EasingFn getEasingFunction(EasingType type) {
    switch (type) {
        case EasingType::Linear:         return easeLinear;
        case EasingType::EaseInQuad:     return easeInQuad;
        case EasingType::EaseOutQuad:    return easeOutQuad;
        case EasingType::EaseInOutQuad:  return easeInOutQuad;
        case EasingType::EaseInCubic:    return easeInCubic;
        case EasingType::EaseOutCubic:   return easeOutCubic;
        case EasingType::EaseInOutCubic: return easeInOutCubic;
        case EasingType::EaseInBack:     return easeInBack;
        case EasingType::EaseOutBack:    return easeOutBack;
        case EasingType::EaseInOutBack:  return easeInOutBack;
        case EasingType::EaseInElastic:  return easeInElastic;
        case EasingType::EaseOutElastic: return easeOutElastic;
        case EasingType::EaseInOutElastic: return easeInOutElastic;
        case EasingType::EaseOutBounce:  return easeOutBounce;
        case EasingType::Step:           return step;
        default:                         return easeLinear;
    }
}

}  // namespace esengine::animation
