// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BtAssetLoader.ts
 * @brief   Loads a `.esbt` into the tree store under every ref a component may
 *          spell it as, so a BehaviorTreeAgent resolves it at runtime.
 *
 * The payload IS a runtime BtDefinition (plus optional editor-only layout the
 * interpreter ignores). Published by its slot: see registryAssets.ts.
 */
import type { AssetLoader, LoadContext, BtResult, RegistryAssetLoader } from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { AssetScope } from '../AssetLease';
import type { BtDefinition } from '../../ai/bt/types';

export class BtAssetLoader implements AssetLoader<BtResult> {
    readonly type = 'behaviortree';
    readonly extensions = ['.esbt'];

    readonly registry: RegistryAssetLoader<BtResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<BtResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            return {
                published: JSON.parse(text) as BtDefinition,
                value: { btId: path },
                dependencies: new AssetScope(),
            };
        },
        // Nothing: the slot holds the era, and this realm's lookup reads it
        // there. Writing a module-global store as well is what let one app
        // answer with another's asset.
        publish: () => {},
        unpublish: () => {},
    };
}
