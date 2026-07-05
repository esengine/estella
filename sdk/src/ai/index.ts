// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Gameplay AI layer barrel — navigation + state machines (behavior
 *          trees land here too; REARCH_GAMEPLAY_AI.md).
 */

export * from './nav';

// State machines: pure core (types / Blackboard / registry / interpreter)…
export * from './fsm';
// …plus the engine binding (context, registry singleton, component, plugin).
export {
    aiRegistry,
    registerAction,
    registerCondition,
    type AiContext,
} from './fsm/AiContext';
export {
    StateMachineAgent,
    registerFsm,
    getFsm,
    clearFsmStore,
    type StateMachineAgentData,
} from './fsm/StateMachineAgent';
export {
    FsmPlugin,
    fsmPlugin,
    StateMachines,
    AiFsm,
    stepStateMachines,
    agentBlackboard,
    type FsmWorldView,
} from './fsm/FsmPlugin';
