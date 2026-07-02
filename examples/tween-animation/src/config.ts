import { EasingType } from 'esengine';

// The easing gallery, top row to bottom row. Each racing dot's `index` (set in
// the scene) selects its curve here, so this order must match the scene's rows.
// A broad sample of the 16 built-in curves — polynomial, back (overshoot),
// elastic, bounce, and one custom cubic-bezier (see BEZIER below).
export const EASINGS: EasingType[] = [
    EasingType.Linear,
    EasingType.EaseInQuad,
    EasingType.EaseOutQuad,
    EasingType.EaseInOutQuad,
    EasingType.EaseInCubic,
    EasingType.EaseOutCubic,
    EasingType.EaseInOutCubic,
    EasingType.EaseOutBack,
    EasingType.EaseInOutBack,
    EasingType.EaseOutElastic,
    EasingType.EaseOutBounce,
    EasingType.CubicBezier,
];

// Gallery: every dot races the same world-X track, so the different easings
// visibly spread apart and regroup. Must match the rails authored in the scene.
export const RACE_FROM = -620;
export const RACE_TO = -120;
export const RACE_DURATION = 2.4;

// Control points for the one Cubic-Bezier row — an "anticipate then overshoot"
// curve, applied with TweenHandle.bezier().
export const BEZIER = { p1x: 0.6, p1y: -0.4, p2x: 0.4, p2y: 1.4 };

// Hero: an endless choreography built from tween.sequence() with nested
// tween.parallel() (move → spin+colour → move → spin+colour, forever).
export const HERO_TRAVEL = 150;
export const HERO_MOVE_DURATION = 0.7;
export const HERO_SPIN_DURATION = 0.6;

// Comet: click anywhere to fling it to the cursor with an overshooting ease
// and an elastic size pop.
export const COMET_DURATION = 0.8;
export const COMET_SIZE = 30;
export const COMET_POP = 48;
