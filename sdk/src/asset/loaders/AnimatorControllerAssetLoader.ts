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
import { animatorScopes, motionOf } from '../../animation/Animator';
import type { AnimatorControllerDef, AnimatorState } from '../../animation/Animator';
import { isBlend1D, isBlend2D, type AnimatorMotion, type AnimatorClipMotion } from '../../animation/motion';
import { migrateAnimatorController } from '../../animation/animatorMigrate';
import { animatorMotionAssetType, resolveDocumentRef } from '../documentRef';

function* clipMotions(motion: AnimatorMotion): Generator<AnimatorClipMotion> {
    if (isBlend1D(motion)) {
        for (const stop of motion.thresholds) yield* clipMotions(stop.motion);
    } else if (isBlend2D(motion)) {
        for (const point of motion.points) yield* clipMotions(point.motion);
    } else {
        yield motion;
    }
}

function* motionsOf(states: readonly AnimatorState[]): Generator<AnimatorClipMotion> {
    for (const state of states) {
        const motion = motionOf(state);
        if (motion) {
            for (const clip of clipMotions(motion)) {
                // Older editors stored the state controls beside the motion. Keep
                // each blend child's own override when inheriting those settings.
                if (clip.loop === undefined && state.loop !== undefined) clip.loop = state.loop;
                if (clip.speed === undefined && state.speed !== undefined) clip.speed = state.speed;
                yield clip;
            }
        }
        if (state.stateMachine) yield* motionsOf(state.stateMachine.states);
    }
}

function* motionsOfController(def: AnimatorControllerDef): Generator<AnimatorClipMotion> {
    for (const scope of animatorScopes(def)) yield* motionsOf(scope.states);
}

export class AnimatorControllerAssetLoader implements AssetLoader<AnimatorControllerResult> {
    readonly type = 'animatorcontroller';
    readonly bindsTextures = true;
    readonly extensions = ['.esanimator'];

    readonly registry: RegistryAssetLoader<AnimatorControllerResult> = {
        prepare: async (path: string, ctx: LoadContext): Promise<RegistryEra<AnimatorControllerResult>> => {
            const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
            const { def } = migrateAnimatorController(JSON.parse(text));
            await acquireMotionAssets(def, path, ctx);
            return {
                published: def,
                value: { controllerId: path },
            };
        },
    };
}

/**
 * Load what the graph's motions play and the avatar its clips were authored on,
 * resolving each ref IN PLACE: discovery walks components, which a controller's
 * refs are not, and each is looked up by the name it carries. Without the avatar
 * no retarget ever runs.
 */
async function acquireMotionAssets(
    def: AnimatorControllerDef, path: string, ctx: LoadContext,
): Promise<void> {
    const wanted = new Map<string, string>();
    for (const motion of motionsOfController(def)) {
        const type = animatorMotionAssetType(motion.kind, motion.clip);
        if (!type || !motion.clip) continue;
        motion.clip = resolveDocumentRef(path, motion.clip);
        wanted.set(motion.clip, type);
    }
    if (def.avatar) {
        def.avatar = resolveDocumentRef(path, def.avatar);
        wanted.set(def.avatar, 'avatar');
    }
    // Leases are recorded against the scope loading this controller, which is
    // what releases them when the scene that wanted it goes.
    await Promise.all([...wanted].map(([ref, type]) => ctx.acquireAsset(type, ref)));
}
