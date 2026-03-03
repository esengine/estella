import {
    defineSystem, Query,
    Transform, Sprite, Tween, TweenTarget, EasingType, LoopMode,
} from 'esengine';
import { EasingDemo, ScaleDemo, RotationDemo, ColorDemo } from '../components';

const EASING_TYPES = [
    EasingType.Linear,
    EasingType.EaseInQuad,
    EasingType.EaseOutQuad,
    EasingType.EaseInOutQuad,
    EasingType.EaseInCubic,
    EasingType.EaseOutBounce,
];

const X_FROM = -250;
const X_TO = 250;
const DURATION = 2;

export const setupSystem = defineSystem(
    [Query(Transform, EasingDemo), Query(Transform, ScaleDemo), Query(Transform, RotationDemo), Query(Transform, ColorDemo)],
    (easings, scales, rotations, colors) => {
        for (const [entity, _t, demo] of easings) {
            Tween.to(entity, TweenTarget.PositionX, X_FROM, X_TO, DURATION, {
                easing: EASING_TYPES[demo.easingIndex] ?? EasingType.Linear,
                loop: LoopMode.PingPong,
            });
        }

        for (const [entity] of scales) {
            Tween.to(entity, TweenTarget.ScaleX, 0.5, 2.0, 1.0, {
                easing: EasingType.EaseInOutQuad,
                loop: LoopMode.PingPong,
            });
            Tween.to(entity, TweenTarget.ScaleY, 0.5, 2.0, 1.0, {
                easing: EasingType.EaseInOutQuad,
                loop: LoopMode.PingPong,
            });
        }

        for (const [entity] of rotations) {
            Tween.to(entity, TweenTarget.RotationZ, 0, 360, 3.0, {
                easing: EasingType.Linear,
                loop: LoopMode.Restart,
            });
        }

        for (const [entity] of colors) {
            Tween.to(entity, TweenTarget.ColorR, 1, 0, 2, {
                loop: LoopMode.PingPong,
                easing: EasingType.EaseInOutQuad,
            });
            Tween.to(entity, TweenTarget.ColorG, 0, 1, 2, {
                loop: LoopMode.PingPong,
                easing: EasingType.EaseInOutQuad,
            });
        }
    },
    { name: 'SetupSystem' }
);
