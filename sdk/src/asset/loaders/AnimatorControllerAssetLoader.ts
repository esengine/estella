// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimatorControllerAssetLoader.ts
 * @brief   Loads a `.esanimator` and registers it under its path in the global
 *          animator-controller store, so an Animator whose `controller` is that
 *          path resolves at runtime.
 *
 * The `.esanimator` payload IS a runtime AnimatorControllerDef (plus editor-only
 * canvas positions on each state, which the interpreter ignores) — no compile
 * step. Mirrors {@link file://./FsmAssetLoader.ts}.
 */

import type { AssetLoader, LoadContext, AnimatorControllerResult } from '../AssetLoader';
import { registerAnimatorController } from '../../animation/Animator';
import type { AnimatorControllerDef } from '../../animation/Animator';

export class AnimatorControllerAssetLoader implements AssetLoader<AnimatorControllerResult> {
    readonly type = 'animatorcontroller';
    readonly extensions = ['.esanimator'];

    async load(path: string, ctx: LoadContext): Promise<AnimatorControllerResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const def = JSON.parse(text) as AnimatorControllerDef;
        registerAnimatorController(path, def);
        return { controllerId: path };
    }

    unload(): void {
        // Controllers are registered globally in the shared store.
    }
}
