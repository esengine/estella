// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimatorControllerAssetLoader.ts
 * @brief   Loads a `.esanimator` into the controller store under every ref a
 *          component may spell it as, so an Animator resolves it at runtime.
 *
 * Mirrors {@link file://./FsmAssetLoader.ts}: published by its slot, so a
 * retiring era cannot take the newer one out from under the same name.
 */
import type {
    AssetLoader, LoadContext, AnimatorControllerResult, RegistryAssetLoader,
} from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import type { AnimatorControllerDef } from '../../animation/Animator';

export class AnimatorControllerAssetLoader implements AssetLoader<AnimatorControllerResult> {
    readonly type = 'animatorcontroller';
    readonly extensions = ['.esanimator'];

    readonly registry: RegistryAssetLoader<AnimatorControllerResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<AnimatorControllerResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            return {
                published: JSON.parse(text) as AnimatorControllerDef,
                value: { controllerId: path },
            };
        },
    };
}
