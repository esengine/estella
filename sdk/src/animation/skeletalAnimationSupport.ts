// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skeletalAnimationSupport.ts — what a build that ships a skeleton tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts. Both halves
 * come from here: the plugin an app installs, and the loaders that read a
 * `.esanimator` and a `.esavatar`. A loader names the animator's parsers, so one
 * the asset registry constructs is one every package carries.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
import { SkeletalAnimationPlugin } from './SkeletalAnimationPlugin';
import { AnimatorControllerAssetLoader } from '../asset/loaders/AnimatorControllerAssetLoader';
import { AvatarAssetLoader } from '../asset/loaders/AvatarAssetLoader';

export function registerSkeletalAnimationSupport(): void {
    addEntryPlugin('skeletalAnimation', () => new SkeletalAnimationPlugin());
    addAssetLoader('animatorcontroller', () => new AnimatorControllerAssetLoader() as never);
    addAssetLoader('avatar', () => new AvatarAssetLoader() as never);
}
