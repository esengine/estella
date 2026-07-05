// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FsmAssetLoader.ts
 * @brief   Loads a `.esfsm` and registers it under its path in the FSM store,
 *          so a StateMachineAgent whose `fsm` is that path resolves at runtime.
 *
 * The `.esfsm` payload IS a runtime FsmDefinition (plus optional editor-only
 * layout on each state, which the interpreter ignores) — no compile step.
 */

import type { AssetLoader, LoadContext, FsmResult } from '../AssetLoader';
import { registerFsm } from '../../ai/fsm/StateMachineAgent';
import type { FsmDefinition } from '../../ai/fsm/types';

export class FsmAssetLoader implements AssetLoader<FsmResult> {
    readonly type = 'statemachine';
    readonly extensions = ['.esfsm'];

    async load(path: string, ctx: LoadContext): Promise<FsmResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const def = JSON.parse(text) as FsmDefinition;
        registerFsm(path, def);
        return { fsmId: path };
    }

    unload(): void {
        // FSMs are registered globally in the shared store.
    }
}
