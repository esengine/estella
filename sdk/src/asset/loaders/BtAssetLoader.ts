// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BtAssetLoader.ts
 * @brief   Loads a `.esbt` and registers it under its path in the tree store,
 *          so a BehaviorTreeAgent whose `bt` is that path resolves at runtime.
 *          A `.esbt` payload IS a runtime BtDefinition (plus optional editor-only
 *          layout on each node, which the interpreter ignores) — no compile step.
 */

import type { AssetLoader, LoadContext, BtResult } from '../AssetLoader';
import { registerBt } from '../../ai/bt/BehaviorTreeAgent';
import type { BtDefinition } from '../../ai/bt/types';

export class BtAssetLoader implements AssetLoader<BtResult> {
    readonly type = 'behaviortree';
    readonly extensions = ['.esbt'];

    async load(path: string, ctx: LoadContext): Promise<BtResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const def = JSON.parse(text) as BtDefinition;
        registerBt(path, def);
        return { btId: path };
    }

    unload(): void {
        // Trees are registered globally in the shared store.
    }
}
