// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   State-machine core barrel (pure runtime; engine binding is separate).
 */

export type {
    CompareOp,
    BlackboardGuard,
    FsmTransition,
    FsmState,
    FsmDefinition,
} from './types';
export { Blackboard, evalGuard, evalGuards } from './Blackboard';
export { AiRegistry, type AiAction, type AiCondition } from './registry';
export {
    compileFsm,
    createFsmRunState,
    stepFsm,
    type CompiledFsm,
    type FsmRunState,
} from './FsmRunner';
export {
    fsmEdges,
    emptyFsm,
    addState,
    removeState,
    moveState,
    renameState,
    setStateHook,
    setInitial,
    addTransition,
    removeTransition,
    updateTransition,
    type FsmEdge,
} from './fsmGraph';
