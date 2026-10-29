// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/easing.ts
 * @brief   The easing curves a tween names: `'sineOut'`, `'backInOut'`, … and the functions behind them.
 *
 * Each curve takes progress 0..1 and returns eased progress. The families are the standard ones (Penner's), with the
 * parameters Cocos uses where a curve has any (elastic's amplitude and period, back's overshoot).
 */
export type EasingFunction = (k: number) => number;

const PI = Math.PI;

const quadIn: EasingFunction = (k) => k * k;
const quadOut: EasingFunction = (k) => k * (2 - k);
const quadInOut: EasingFunction = (k) => ((k *= 2) < 1 ? 0.5 * k * k : -0.5 * (--k * (k - 2) - 1));
const cubicIn: EasingFunction = (k) => k * k * k;
const cubicOut: EasingFunction = (k) => --k * k * k + 1;
const cubicInOut: EasingFunction = (k) => ((k *= 2) < 1 ? 0.5 * k * k * k : 0.5 * ((k -= 2) * k * k + 2));
const quartIn: EasingFunction = (k) => k * k * k * k;
const quartOut: EasingFunction = (k) => 1 - --k * k * k * k;
const quartInOut: EasingFunction = (k) => ((k *= 2) < 1 ? 0.5 * k * k * k * k : -0.5 * ((k -= 2) * k * k * k - 2));
const quintIn: EasingFunction = (k) => k * k * k * k * k;
const quintOut: EasingFunction = (k) => --k * k * k * k * k + 1;
const quintInOut: EasingFunction = (k) => ((k *= 2) < 1 ? 0.5 * k * k * k * k * k : 0.5 * ((k -= 2) * k * k * k * k + 2));
const sineIn: EasingFunction = (k) => (k === 1 ? 1 : 1 - Math.cos((k * PI) / 2));
const sineOut: EasingFunction = (k) => Math.sin((k * PI) / 2);
const sineInOut: EasingFunction = (k) => 0.5 * (1 - Math.cos(PI * k));
const expoIn: EasingFunction = (k) => (k === 0 ? 0 : 1024 ** (k - 1));
const expoOut: EasingFunction = (k) => (k === 1 ? 1 : 1 - 2 ** (-10 * k));
const expoInOut: EasingFunction = (k) => {
    if (k === 0) return 0;
    if (k === 1) return 1;
    if ((k *= 2) < 1) return 0.5 * 1024 ** (k - 1);
    return 0.5 * (-(2 ** (-10 * (k - 1))) + 2);
};
const circIn: EasingFunction = (k) => 1 - Math.sqrt(1 - k * k);
const circOut: EasingFunction = (k) => Math.sqrt(1 - --k * k);
const circInOut: EasingFunction = (k) => ((k *= 2) < 1 ? -0.5 * (Math.sqrt(1 - k * k) - 1) : 0.5 * (Math.sqrt(1 - (k -= 2) * k) + 1));

const elasticIn: EasingFunction = (k) => {
    if (k === 0) return 0;
    if (k === 1) return 1;
    const a = 0.1, p = 0.4;
    const s = p / 4;
    return -(1 * 2 ** (10 * (k -= 1)) * Math.sin(((k - s) * 2 * PI) / p)) * (a / a);
};
const elasticOut: EasingFunction = (k) => {
    if (k === 0) return 0;
    if (k === 1) return 1;
    const p = 0.4;
    const s = p / 4;
    return 2 ** (-10 * k) * Math.sin(((k - s) * 2 * PI) / p) + 1;
};
const elasticInOut: EasingFunction = (k) => {
    if (k === 0) return 0;
    if (k === 1) return 1;
    const p = 0.4 * 1.5;
    const s = p / 4;
    if ((k *= 2) < 1) return -0.5 * 2 ** (10 * (k -= 1)) * Math.sin(((k - s) * 2 * PI) / p);
    return 2 ** (-10 * (k -= 1)) * Math.sin(((k - s) * 2 * PI) / p) * 0.5 + 1;
};

const S = 1.70158;
const backIn: EasingFunction = (k) => (k === 1 ? 1 : k * k * ((S + 1) * k - S));
const backOut: EasingFunction = (k) => (k === 0 ? 0 : --k * k * ((S + 1) * k + S) + 1);
const backInOut: EasingFunction = (k) => {
    const s = S * 1.525;
    if ((k *= 2) < 1) return 0.5 * (k * k * ((s + 1) * k - s));
    return 0.5 * ((k -= 2) * k * ((s + 1) * k + s) + 2);
};

const bounceOut: EasingFunction = (k) => {
    if (k < 1 / 2.75) return 7.5625 * k * k;
    if (k < 2 / 2.75) return 7.5625 * (k -= 1.5 / 2.75) * k + 0.75;
    if (k < 2.5 / 2.75) return 7.5625 * (k -= 2.25 / 2.75) * k + 0.9375;
    return 7.5625 * (k -= 2.625 / 2.75) * k + 0.984375;
};
const bounceIn: EasingFunction = (k) => 1 - bounceOut(1 - k);
const bounceInOut: EasingFunction = (k) => (k < 0.5 ? bounceIn(k * 2) * 0.5 : bounceOut(k * 2 - 1) * 0.5 + 0.5);

/** The curve that runs the "out" half first, then the "in" half. */
const outIn = (out: EasingFunction, inn: EasingFunction): EasingFunction => (k) => (k < 0.5 ? 0.5 * out(2 * k) : 0.5 * inn(2 * k - 1) + 0.5);

export const easing = {
    linear: ((k) => k) as EasingFunction,
    smooth: ((k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k))) as EasingFunction,
    fade: ((k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * k * (k * (k * 6 - 15) + 10))) as EasingFunction,
    constant: ((k) => (k >= 1 ? 1 : 0)) as EasingFunction,
    quadIn, quadOut, quadInOut, quadOutIn: outIn(quadOut, quadIn),
    cubicIn, cubicOut, cubicInOut, cubicOutIn: outIn(cubicOut, cubicIn),
    quartIn, quartOut, quartInOut, quartOutIn: outIn(quartOut, quartIn),
    quintIn, quintOut, quintInOut, quintOutIn: outIn(quintOut, quintIn),
    sineIn, sineOut, sineInOut, sineOutIn: outIn(sineOut, sineIn),
    expoIn, expoOut, expoInOut, expoOutIn: outIn(expoOut, expoIn),
    circIn, circOut, circInOut, circOutIn: outIn(circOut, circIn),
    elasticIn, elasticOut, elasticInOut, elasticOutIn: outIn(elasticOut, elasticIn),
    backIn, backOut, backInOut, backOutIn: outIn(backOut, backIn),
    bounceIn, bounceOut, bounceInOut, bounceOutIn: outIn(bounceOut, bounceIn),
} as const;

export type EasingName = keyof typeof easing;

/** A curve by name or function; an unknown name is linear, as a mistyped name is in Cocos. */
export function resolveEasing(e: EasingName | EasingFunction | string | undefined): EasingFunction {
    if (typeof e === 'function') return e;
    if (typeof e === 'string' && e in easing) return easing[e as EasingName];
    return easing.linear;
}
