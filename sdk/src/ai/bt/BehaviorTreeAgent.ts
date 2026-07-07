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

import { defineComponent } from '../../component';
import { isUuidRef } from '../../asset/AssetRegistry';
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
    assetFields: [{ field: 'bt', type: 'behaviortree' }],
    // Preload a `.esbt` path or an editor-serialized uuid ref with the scene; a
    // plain `registerBt` name (code path) is left alone — this callback is the
    // discovery authority; the assetField above only drives the editor picker.
    discoverAssets: data => {
        const bt = data.bt;
        return typeof bt === 'string' && (bt.endsWith('.esbt') || isUuidRef(bt))
            ? [{ type: 'behaviortree', path: bt }]
            : [];
    },
    fields: {
        status: { advanced: true, tooltip: 'Last root status (runtime, read-only).' },
    },
});

/** Behavior trees keyed by registration name or `.esbt` asset path. A tree IS its definition — no compile. */
const btStore = new Map<string, BtDefinition>();

export function registerBt(key: string, def: BtDefinition): BtDefinition {
    btStore.set(key, def);
    return def;
}

export function getBt(key: string): BtDefinition | undefined {
    return btStore.get(key);
}

/** Drop all registered trees (tests / hot-reload). */
export function clearBtStore(): void {
    btStore.clear();
}
