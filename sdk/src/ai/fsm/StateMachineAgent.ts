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

import { defineComponent } from '../../ecs/component';
import { isUuidRef } from '../../asset/AssetRegistry';
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
    // Preload a `.esfsm` path or an editor-serialized uuid ref with the scene so
    // the FSM is registered before the agent first ticks. A plain `registerFsm`
    // name (code path) is left alone — this callback is the discovery authority;
    // the assetField above only drives the editor picker.
    discoverAssets: data => {
        const fsm = data.fsm;
        return typeof fsm === 'string' && (fsm.endsWith('.esfsm') || isUuidRef(fsm))
            ? [{ type: 'statemachine', path: fsm }]
            : [];
    },
    fields: {
        current: { advanced: true, tooltip: 'Active state (runtime, read-only).' },
    },
});

/**
 * FSMs a game registered in CODE, process-wide. An `.esfsm` does not land here —
 * it belongs to the realm that loaded it, which a lookup asks first. Live rather
 * than copied per App: hot reload re-imports the bundle into a RUNNING app, so a
 * copy taken at build would answer with the version from before the edit.
 */
const fsmStore = new Map<string, CompiledFsm>();

/** Register (compile) an FSM under `key` — the code half of the registry. */
export function registerFsm(key: string, def: FsmDefinition): CompiledFsm {
    const compiled = compileFsm(def);
    fsmStore.set(key, compiled);
    return compiled;
}

export function getFsm(key: string): CompiledFsm | undefined {
    return fsmStore.get(key);
}

/** Every registered FSM. What the schedule reads to learn what the FSM system
 *  reaches for — that answer lives in the loaded graphs, not in the system. */
export function allFsms(): Iterable<CompiledFsm> {
    return fsmStore.values();
}

/** Drop all registered FSMs (tests / hot-reload). */
export function clearFsmStore(): void {
    fsmStore.clear();
}
