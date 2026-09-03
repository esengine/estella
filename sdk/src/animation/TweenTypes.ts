// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TweenTypes.ts
 * @brief   Shared tween enums/types — WASM boundary contract
 *
 * TweenState and LoopMode are generated from src/esengine/animation/TweenData.hpp.
 */

import type { EasingType } from './Easing';
import type { LoopMode } from '../wasm/wasm.generated';

/**
 * The tween lifecycle and loop modes, from the C++ enums that own them. They
 * cross as bare numbers, so a second answer here is a tween reported in the
 * wrong state rather than an error.
 */
export { TweenState, LoopMode } from '../wasm/wasm.generated';

export interface TweenOptions {
    easing?: EasingType;
    delay?: number;
    loop?: LoopMode;
    loopCount?: number;
}
