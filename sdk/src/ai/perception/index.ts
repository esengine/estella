// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Perception barrel — pure sensing core + components + plugin.
 */

export { senseTarget, facingFromQuat, normalizeAngle, type SenseResult } from './sense';
export {
    Perceiver, Perception, PerceptionTarget,
    type PerceiverData, type PerceptionData,
} from './components';
export {
    PerceptionPlugin, perceptionPlugin, stepPerception, makeLosCheck,
    type PerceptionWorldView, type LosCheck,
} from './PerceptionPlugin';
