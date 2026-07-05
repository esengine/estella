// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    StateMachineAgent.ts
 * @brief   StateMachineAgent component + the compiled-FSM store.
 *
 * The component is the authorable half: which FSM to run (a registered name or a
 * `.esfsm` asset key) plus the observable current state. Named `StateMachineAgent`
 * to stay clear of the UI-owned `StateMachine` component.
 */

import { defineComponent } from '../../component';
import type { FsmDefinition } from './types';
import { compileFsm, type CompiledFsm } from './FsmRunner';

export interface StateMachineAgentData {
    /** Key of the FSM to run: a `registerFsm` name or a `.esfsm` asset path. */
    fsm: string;
    /** Active state name, written by the system each tick (observable in the inspector). */
    current: string;
}

export const StateMachineAgent = defineComponent<StateMachineAgentData>('StateMachineAgent', {
    fsm: '',
    current: '',
}, {
    assetFields: [{ field: 'fsm', type: 'statemachine' }],
    // Preload a `.esfsm` reference with the scene so the FSM is registered before
    // the agent first ticks. A plain `registerFsm` name (code path) is left alone.
    discoverAssets: data => {
        const fsm = data.fsm;
        return typeof fsm === 'string' && fsm.endsWith('.esfsm')
            ? [{ type: 'statemachine', path: fsm }]
            : [];
    },
    fields: {
        current: { advanced: true, tooltip: 'Active state (runtime, read-only).' },
    },
});

/** Compiled FSMs keyed by registration name or `.esfsm` asset path. */
const fsmStore = new Map<string, CompiledFsm>();

/** Register (compile) an FSM under `key`; code path and `.esfsm` loader share this store. */
export function registerFsm(key: string, def: FsmDefinition): CompiledFsm {
    const compiled = compileFsm(def);
    fsmStore.set(key, compiled);
    return compiled;
}

export function getFsm(key: string): CompiledFsm | undefined {
    return fsmStore.get(key);
}

/** Drop all registered FSMs (tests / hot-reload). */
export function clearFsmStore(): void {
    fsmStore.clear();
}
