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
import type { AnimatorControllerDef, AnimatorState } from '../../animation/Animator';
import { isBlend1D, type AnimatorMotion } from '../../animation/motion';
import { resolveDocumentRef } from '../documentRef';

/**
 * Motion kinds whose `clip` names an ASSET, and the type it loads as. A sprite
 * clip and a spine animation are names their own runtime already holds, so they
 * are absent rather than mapped to nothing.
 */
const MOTION_ASSET_TYPES: Readonly<Record<string, string>> = {
    timeline: 'timeline',
};

/** Every motion in the graph, descending through blends and sub-machines. */
function* motionsOf(states: readonly AnimatorState[]): Generator<AnimatorMotion> {
    for (const state of states) {
        if (state.motion) yield* flatten(state.motion);
        if (state.stateMachine) yield* motionsOf(state.stateMachine.states);
    }
}

function* flatten(motion: AnimatorMotion): Generator<AnimatorMotion> {
    yield motion;
    if (isBlend1D(motion)) {
        for (const stop of motion.thresholds) yield* flatten(stop.motion);
    }
}

export class AnimatorControllerAssetLoader implements AssetLoader<AnimatorControllerResult> {
    readonly type = 'animatorcontroller';
    readonly extensions = ['.esanimator'];

    readonly registry: RegistryAssetLoader<AnimatorControllerResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<AnimatorControllerResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const def = JSON.parse(text) as AnimatorControllerDef;
            await acquireMotionAssets(def, path, ctx);
            return {
                published: def,
                value: { controllerId: path },
            };
        },
    };
}

/**
 * Load what the graph's motions play, resolving each ref IN PLACE. Discovery
 * walks components, and a clip named inside a controller is not one; resolving
 * is what makes the driver's lookup hit, since a motion asks for its clip by the
 * name it carries and that has to be the name it was registered under.
 */
async function acquireMotionAssets(
    def: AnimatorControllerDef, path: string, ctx: LoadContext,
): Promise<void> {
    const wanted = new Map<string, string>();
    for (const motion of motionsOf(def.states)) {
        if (isBlend1D(motion)) continue;
        const type = MOTION_ASSET_TYPES[motion.kind];
        if (!type || !motion.clip) continue;
        motion.clip = resolveDocumentRef(path, motion.clip);
        wanted.set(motion.clip, type);
    }
    // Leases are recorded against the scope loading this controller, which is
    // what releases them when the scene that wanted it goes.
    await Promise.all([...wanted].map(([ref, type]) => ctx.acquireAsset(type, ref)));
}
