import {
    defineSystem, Query, Res, Transform,
    Tween, TweenAPI, TweenTarget, EasingType, LoopMode,
} from 'esengine';
import { GalleryDot, Hero } from '../components';
import {
    EASINGS, RACE_FROM, RACE_TO, RACE_DURATION, BEZIER,
    HERO_TRAVEL, HERO_MOVE_DURATION, HERO_SPIN_DURATION,
} from '../config';

// One lap of the hero choreography, re-armed on completion so it loops forever.
// sequence() runs each factory in turn; the spin + colour steps are grouped with
// parallel() so they play together. Rotating 0→360 leaves the same orientation,
// and the colour returns to its start, so every lap begins cleanly.
function loopHero(tween: TweenAPI, hero: number, centerX: number): void {
    tween.sequence([
        () => tween.to(hero, TweenTarget.PositionX, centerX - HERO_TRAVEL, centerX + HERO_TRAVEL, HERO_MOVE_DURATION, { easing: EasingType.EaseInOutCubic }),
        () => tween.parallel([
            tween.to(hero, TweenTarget.RotationZ, 0, 360, HERO_SPIN_DURATION, { easing: EasingType.EaseOutBack }),
            tween.to(hero, TweenTarget.ColorR, 0.35, 1.0, HERO_SPIN_DURATION, { easing: EasingType.EaseInOutQuad }),
        ]),
        () => tween.to(hero, TweenTarget.PositionX, centerX + HERO_TRAVEL, centerX - HERO_TRAVEL, HERO_MOVE_DURATION, { easing: EasingType.EaseInOutCubic }),
        () => tween.parallel([
            tween.to(hero, TweenTarget.RotationZ, 0, 360, HERO_SPIN_DURATION, { easing: EasingType.EaseInOutBack }),
            tween.to(hero, TweenTarget.ColorR, 1.0, 0.35, HERO_SPIN_DURATION, { easing: EasingType.EaseInOutQuad }),
        ]),
    ]).onComplete(() => loopHero(tween, hero, centerX));
}

// Starts every passive tween once at startup: the gallery race and the hero lap.
export const setupSystem = defineSystem(
    [Res(Tween), Query(GalleryDot), Query(Transform, Hero)],
    (tween: TweenAPI, dots, heroes) => {
        for (const [entity, dot] of dots) {
            const easing = EASINGS[dot.index] ?? EasingType.Linear;
            const handle = tween.to(entity, TweenTarget.PositionX, RACE_FROM, RACE_TO, RACE_DURATION, {
                easing,
                loop: LoopMode.PingPong,
            });
            // The one custom-curve row supplies its bezier control points.
            if (easing === EasingType.CubicBezier) {
                handle.bezier(BEZIER.p1x, BEZIER.p1y, BEZIER.p2x, BEZIER.p2y);
            }
        }

        for (const [entity, transform] of heroes) {
            loopHero(tween, entity, transform.position.x);
        }
    },
    { name: 'SetupSystem' },
);
