// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sceneOptionals.ts — the optional subsystems a scene load reaches, held
 *        behind a seam so the loader does not name them.
 *
 * `runtimeLoader` is in every package, so a subsystem it imports by value is in
 * every package too — 110KB of Spine and DragonBones in a project with neither,
 * measured on examples/hello-world. Every use of them here is already behind a
 * test (`discovered.spines.length > 0`), so the code was never RUN; it was only
 * ever shipped.
 *
 * The signatures are `Parameters<typeof …>` rather than spelled out: this is a
 * seam over the real functions, and a seam that restates their arguments is the
 * second declaration that drifts.
 */
import type { App } from '../app/app';
import type { SpineManager } from '../spine/SpineManager';
import type { loadSpineAssets, applySpineEntities } from '../spine/loadSpineScene';
import type { DragonBonesManager } from '../dragonbones/DragonBonesManager';
import type {
    loadDragonBonesAssets, applyDragonBonesEntities,
} from '../dragonbones/loadDragonBonesScene';

/** What a scene load needs from Spine, when the build ships it. */
export interface SpineSupport {
    /** The realm's manager, owned by SpinePlugin — null when it is not installed. */
    manager(app: App): SpineManager | null;
    load(...args: Parameters<typeof loadSpineAssets>): ReturnType<typeof loadSpineAssets>;
    apply(...args: Parameters<typeof applySpineEntities>): ReturnType<typeof applySpineEntities>;
}

/** What a scene load needs from DragonBones, when the build ships it. */
export interface DragonBonesSupport {
    acquire(app: App): Promise<DragonBonesManager | null>;
    load(...args: Parameters<typeof loadDragonBonesAssets>): ReturnType<typeof loadDragonBonesAssets>;
    apply(...args: Parameters<typeof applyDragonBonesEntities>): ReturnType<typeof applyDragonBonesEntities>;
}

let spine: SpineSupport | null = null;
let dragonBones: DragonBonesSupport | null = null;

/** Called once by `runtime/optionalPlugins`, for its side effect. */
export function setSceneOptionals(
    support: { spine?: SpineSupport; dragonBones?: DragonBonesSupport },
): void {
    if (support.spine) spine = support.spine;
    if (support.dragonBones) dragonBones = support.dragonBones;
}

/** Null in a build that does not ship Spine — a scene holding one then loads
 *  without it rather than failing, which is what a lean build IS. */
export const spineSupport = (): SpineSupport | null => spine;

/** Null in a build that does not ship DragonBones. */
export const dragonBonesSupport = (): DragonBonesSupport | null => dragonBones;
