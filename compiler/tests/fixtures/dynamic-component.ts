// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dynamic-component.ts
 * @brief   A defineComponent whose shape is not a literal.
 *
 * @details `defineComponent` is an intrinsic, so a shape the compiler cannot
 *          read at compile time is a fallback, not a guess.
 */
import { defineComponent } from 'esengine';

const defaults = { hp: 100 };
export const Dynamic = defineComponent('FixtureDynamic', defaults);
