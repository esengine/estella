/**
 * @file    Easing.ts
 * @brief   Pure easing math — 1:1 port of C++ EasingFunctions.hpp
 *
 * The EasingType enum values are WASM boundary contract — they must stay
 * in lock-step with src/esengine/animation/TweenData.hpp::EasingType.
 */

// =============================================================================
// EasingType (wire protocol — must match C++ TweenData.hpp)
// =============================================================================

export const EasingType = {
    Linear: 0,
    EaseInQuad: 1,
    EaseOutQuad: 2,
    EaseInOutQuad: 3,
    EaseInCubic: 4,
    EaseOutCubic: 5,
    EaseInOutCubic: 6,
    EaseInBack: 7,
    EaseOutBack: 8,
    EaseInOutBack: 9,
    EaseInElastic: 10,
    EaseOutElastic: 11,
    EaseInOutElastic: 12,
    EaseOutBounce: 13,
    CubicBezier: 14,
    Step: 15,
} as const;

export type EasingType = (typeof EasingType)[keyof typeof EasingType];

export interface BezierPoints {
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
}

// =============================================================================
// Easing Functions
// =============================================================================

function easeLinear(t: number): number {
    return t;
}

function easeInQuad(t: number): number {
    return t * t;
}

function easeOutQuad(t: number): number {
    return t * (2 - t);
}

function easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function easeInCubic(t: number): number {
    return t * t * t;
}

function easeOutCubic(t: number): number {
    const t1 = t - 1;
    return t1 * t1 * t1 + 1;
}

function easeInOutCubic(t: number): number {
    return t < 0.5
        ? 4 * t * t * t
        : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
}

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
const BACK_C2 = BACK_C1 * 1.525;

function easeInBack(t: number): number {
    return BACK_C3 * t * t * t - BACK_C1 * t * t;
}

function easeOutBack(t: number): number {
    const t1 = t - 1;
    return 1 + BACK_C3 * t1 * t1 * t1 + BACK_C1 * t1 * t1;
}

function easeInOutBack(t: number): number {
    if (t < 0.5) {
        return (Math.pow(2 * t, 2) * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2;
    }
    return (Math.pow(2 * t - 2, 2) * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2;
}

const ELASTIC_C4 = (2 * Math.PI) / 3;
const ELASTIC_C5 = (2 * Math.PI) / 4.5;

function easeInElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC_C4);
}

function easeOutElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1;
}

function easeInOutElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    if (t < 0.5) {
        return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2;
    }
    return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2 + 1;
}

const BOUNCE_N1 = 7.5625;
const BOUNCE_D1 = 2.75;

function easeOutBounce(t: number): number {
    if (t < 1 / BOUNCE_D1) {
        return BOUNCE_N1 * t * t;
    } else if (t < 2 / BOUNCE_D1) {
        t -= 1.5 / BOUNCE_D1;
        return BOUNCE_N1 * t * t + 0.75;
    } else if (t < 2.5 / BOUNCE_D1) {
        t -= 2.25 / BOUNCE_D1;
        return BOUNCE_N1 * t * t + 0.9375;
    } else {
        t -= 2.625 / BOUNCE_D1;
        return BOUNCE_N1 * t * t + 0.984375;
    }
}

const BEZIER_MAX_ITERATIONS = 8;
const BEZIER_EPSILON = 1e-6;

function cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
    let x = t;
    for (let i = 0; i < BEZIER_MAX_ITERATIONS; i++) {
        const ix = 1 - x;
        const cx = 3 * p1x * ix * ix * x + 3 * p2x * ix * x * x + x * x * x - t;
        if (Math.abs(cx) < BEZIER_EPSILON) break;
        const dx = 3 * p1x * (1 - 2 * x) * (1 - x)
                 + 6 * p2x * x * (1 - x)
                 - 3 * p2x * x * x
                 + 3 * x * x;
        if (Math.abs(dx) < BEZIER_EPSILON) break;
        x -= cx / dx;
    }
    const ix = 1 - x;
    return 3 * p1y * ix * ix * x + 3 * p2y * ix * x * x + x * x * x;
}

function step(t: number): number {
    return t < 1 ? 0 : 1;
}

// =============================================================================
// Public Easing Dispatcher
// =============================================================================

export function applyEasing(type: EasingType, t: number, bezier?: BezierPoints): number {
    switch (type) {
        case EasingType.Linear:           return easeLinear(t);
        case EasingType.EaseInQuad:       return easeInQuad(t);
        case EasingType.EaseOutQuad:      return easeOutQuad(t);
        case EasingType.EaseInOutQuad:    return easeInOutQuad(t);
        case EasingType.EaseInCubic:      return easeInCubic(t);
        case EasingType.EaseOutCubic:     return easeOutCubic(t);
        case EasingType.EaseInOutCubic:   return easeInOutCubic(t);
        case EasingType.EaseInBack:       return easeInBack(t);
        case EasingType.EaseOutBack:      return easeOutBack(t);
        case EasingType.EaseInOutBack:    return easeInOutBack(t);
        case EasingType.EaseInElastic:    return easeInElastic(t);
        case EasingType.EaseOutElastic:   return easeOutElastic(t);
        case EasingType.EaseInOutElastic: return easeInOutElastic(t);
        case EasingType.EaseOutBounce:    return easeOutBounce(t);
        case EasingType.CubicBezier:
            if (bezier) return cubicBezier(t, bezier.p1x, bezier.p1y, bezier.p2x, bezier.p2y);
            return easeLinear(t);
        case EasingType.Step:             return step(t);
        default:                          return easeLinear(t);
    }
}
