// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BehaviorTreeAgent.ts
 * @brief   BehaviorTreeAgent component + the tree store.
 *
 * The authorable half: which behavior tree to run (a registered name or a
 * `.esbt` asset path) plus the observable last root status. `*Agent` naming,
 * pure TS, mirroring StateMachineAgent.
 */

import { registeredAssetFields } from '../../asset/registeredAssetFields';
import { defineComponent } from '../../ecs/component';
import type { BtDefinition } from './types';

export interface BehaviorTreeAgentData {
    /** Key of the tree to run: a `registerBt` name or a `.esbt` asset path. */
    bt: string;
    /** Last root status, written by the system each tick (observable). */
    status: string;
}

export const BehaviorTreeAgent = defineComponent<BehaviorTreeAgentData>('BehaviorTreeAgent', {
    bt: '',
    status: '',
}, {
    assetFields: [registeredAssetFields.BehaviorTreeAgent],
    fields: {
        status: { advanced: true, tooltip: 'Last root status (runtime, read-only).' },
    },
});

/** Trees a game registered in CODE, process-wide — see the FSM store for why it
 *  is live rather than copied per App. An `.esbt` belongs to its realm, not
 *  here. A tree IS its definition — no compile. */
const btStore = new Map<string, BtDefinition>();

export function registerBt(key: string, def: BtDefinition): BtDefinition {
    btStore.set(key, def);
    return def;
}

export function getBt(key: string): BtDefinition | undefined {
    return btStore.get(key);
}

/** Every registered tree. What the schedule reads to learn what the BT system
 *  reaches for — that answer lives in the loaded trees, not in the system. */
export function allBts(): Iterable<BtDefinition> {
    return btStore.values();
}

/** Drop all registered trees (tests / hot-reload). */
export function clearBtStore(): void {
    btStore.clear();
}
