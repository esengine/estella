// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/easing.ts
 * @brief   The easing names a Cocos tween uses (`'sineOut'`, `'backInOut'`) and the `easing` functions, over the engine's curves.
 *
 * There are no curves here: each name is an `EasingType` of the engine's animation module, and the function is the engine's
 * `applyEasing`. A tween on a Cocos object and a tween the engine runs on a component field ease the same way because they are
 * the same curve.
 *
 * Not carried: the `...OutIn` curves, which the engine has no member for. A script that names one gets a linear ease and a warning.
 * Cocos's elastic curves have their own constants; the engine's elastic is the standard one, so they differ a little in overshoot.
 */
import { EasingType, applyEasing } from '../animation/Easing';
import { log } from '../util/logger';

export type EasingFunction = (k: number) => number;

const E = EasingType;

/** Cocos's name for each curve the engine has. */
const NAMES: Readonly<Record<string, EasingType>> = {
    linear: E.Linear, constant: E.Step, smooth: E.Smoothstep, fade: E.Smootherstep,
    quadIn: E.EaseInQuad, quadOut: E.EaseOutQuad, quadInOut: E.EaseInOutQuad,
    cubicIn: E.EaseInCubic, cubicOut: E.EaseOutCubic, cubicInOut: E.EaseInOutCubic,
    quartIn: E.EaseInQuart, quartOut: E.EaseOutQuart, quartInOut: E.EaseInOutQuart,
    quintIn: E.EaseInQuint, quintOut: E.EaseOutQuint, quintInOut: E.EaseInOutQuint,
    sineIn: E.EaseInSine, sineOut: E.EaseOutSine, sineInOut: E.EaseInOutSine,
    expoIn: E.EaseInExpo, expoOut: E.EaseOutExpo, expoInOut: E.EaseInOutExpo,
    circIn: E.EaseInCirc, circOut: E.EaseOutCirc, circInOut: E.EaseInOutCirc,
    elasticIn: E.EaseInElastic, elasticOut: E.EaseOutElastic, elasticInOut: E.EaseInOutElastic,
    backIn: E.EaseInBack, backOut: E.EaseOutBack, backInOut: E.EaseInOutBack,
    bounceIn: E.EaseInBounce, bounceOut: E.EaseOutBounce, bounceInOut: E.EaseInOutBounce,
};

export const easing: Readonly<Record<string, EasingFunction>> = Object.freeze(
    Object.fromEntries(Object.entries(NAMES).map(([name, type]) => [name, (k: number): number => applyEasing(type, k)])),
);

export type EasingName = keyof typeof NAMES;

const warned = new Set<string>();

/** A curve by name or function; an unknown name is linear, with a warning once. */
export function resolveEasing(e: EasingName | EasingFunction | string | undefined): EasingFunction {
    if (typeof e === 'function') return e;
    if (e === undefined) return easing.linear!;
    const known = easing[e];
    if (known) return known;
    if (!warned.has(e)) {
        warned.add(e);
        log.warn('cocos', `easing "${e}" is not supported (the engine has no such curve); using linear`);
    }
    return easing.linear!;
}
