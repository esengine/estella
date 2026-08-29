// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FsmAssetLoader.ts
 * @brief   Loads a `.esfsm` into the FSM store under every ref a component may
 *          spell it as, so a StateMachineAgent resolves it at runtime.
 *
 * The payload IS a runtime FsmDefinition (plus optional editor-only layout the
 * interpreter ignores) — no compile step of its own. Published by its slot
 * rather than by this loader: see registryAssets.ts.
 */
import type { AssetLoader, LoadContext, FsmResult, RegistryAssetLoader } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { AssetScope } from '../AssetLease';
import { compileFsm } from '../../ai/fsm/FsmRunner';
import type { FsmDefinition } from '../../ai/fsm/types';

export class FsmAssetLoader implements AssetLoader<FsmResult> {
    readonly type = 'statemachine';
    readonly extensions = ['.esfsm'];

    readonly registry: RegistryAssetLoader<FsmResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<FsmResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const def = JSON.parse(text) as FsmDefinition;
            // Compiled once per era, not once per name: the names are the same
            // machine, and two compilations of it are two machines.
            return { published: compileFsm(def), value: { fsmId: path }, dependencies: new AssetScope() };
        },
        // Nothing: the slot holds the era, and this realm's lookup reads it
        // there. Writing a module-global store as well is what let one app
        // answer with another's asset.
    };
}
