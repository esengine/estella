/**
 * @file    TweenTypes.ts
 * @brief   Shared tween enums/types — WASM boundary contract
 *
 * TweenState and LoopMode numeric values must match
 * src/esengine/animation/TweenData.hpp.
 */

import type { EasingType } from './Easing';

export const TweenState = {
    Running: 0,
    Paused: 1,
    Completed: 2,
    Cancelled: 3,
} as const;

export type TweenState = (typeof TweenState)[keyof typeof TweenState];

export const LoopMode = {
    None: 0,
    Restart: 1,
    PingPong: 2,
} as const;

export type LoopMode = (typeof LoopMode)[keyof typeof LoopMode];

export interface TweenOptions {
    easing?: EasingType;
    delay?: number;
    loop?: LoopMode;
    loopCount?: number;
}
