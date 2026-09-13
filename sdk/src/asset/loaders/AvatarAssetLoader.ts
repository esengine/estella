// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AvatarAssetLoader.ts
 * @brief   Loads a `.esavatar` — how one rig spells the joints a clip names.
 *
 * Mirrors {@link file://./FsmAssetLoader.ts}: published by its slot, so a
 * retiring era cannot take the newer one out from under the same name.
 */
import type {
    AssetLoader, LoadContext, AvatarResult, RegistryAssetLoader,
} from '../AssetLoader';
import type { RegistryEra } from '../registryAssets';
import { parseAvatar, type AnimatorAvatar } from '../../animation/animatorAvatar';

export class AvatarAssetLoader implements AssetLoader<AvatarResult> {
    readonly type = 'avatar';
    readonly extensions = ['.esavatar'];

    readonly registry: RegistryAssetLoader<AvatarResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<AvatarResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const avatar: AnimatorAvatar = parseAvatar(JSON.parse(text));
            return { published: avatar, value: { avatarId: path } };
        },
    };
}
