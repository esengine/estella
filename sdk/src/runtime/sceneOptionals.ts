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
import type { Physics2DPluginConfig } from '../physics/Physics2DPlugin';
import type { PhysicsWasmModule } from '../physics/PhysicsModuleLoader';
import type { Physics3DWasmModule } from '../physics3d/Physics3DModule';

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

/** What a scene load needs from 2D physics, when the build ships it. */
export interface PhysicsSupport {
    installed(app: App): boolean;
    install(app: App, config: Physics2DPluginConfig, module: PhysicsWasmModule): void;
}

/** What a scene load needs from 3D physics, when the build ships it. */
export interface Physics3DSupport {
    installed(app: App): boolean;
    install(app: App, module: Physics3DWasmModule): void;
}

/** What a scene load needs from video, when the build ships it. */
export interface VideoSupport {
    /** False when the realm has no VideoPlayer resource to point at the staged file. */
    setRefResolver(app: App, resolve: (ref: string) => string): boolean;
}

let spine: SpineSupport | null = null;
let physics: PhysicsSupport | null = null;
let physics3d: Physics3DSupport | null = null;
let video: VideoSupport | null = null;
let dragonBones: DragonBonesSupport | null = null;

/** Called by each subsystem's `support.ts`, which an entry or a subpath calls. */
export function setSceneOptionals(support: {
    spine?: SpineSupport;
    dragonBones?: DragonBonesSupport;
    physics?: PhysicsSupport;
    physics3d?: Physics3DSupport;
    video?: VideoSupport;
}): void {
    if (support.spine) spine = support.spine;
    if (support.dragonBones) dragonBones = support.dragonBones;
    if (support.physics) physics = support.physics;
    if (support.physics3d) physics3d = support.physics3d;
    if (support.video) video = support.video;
}

/** Null in a build that does not ship Spine — a scene holding one then loads
 *  without it rather than failing, which is what a lean build IS. */
export const spineSupport = (): SpineSupport | null => spine;

/** Null in a build that does not ship DragonBones. */
export const dragonBonesSupport = (): DragonBonesSupport | null => dragonBones;

/** Null in a build that does not ship 2D physics. */
export const physicsSupport = (): PhysicsSupport | null => physics;

/** Null in a build that does not ship 3D physics. */
export const physics3dSupport = (): Physics3DSupport | null => physics3d;

/** Null in a build that does not ship video. */
export const videoSupport = (): VideoSupport | null => video;

/**
 * Which optional subsystems this BUILD ships, as the seam itself answers it.
 *
 * Exported because the only honest test of that question reads the shipped
 * bundle rather than the source. Every registration here is reached from an
 * entry, and an entry is the one thing a bundler is told to keep — but what the
 * entry reaches was dropped once already, and the SDK's own suite could not see
 * it: it imports `src`, where the wiring was never in doubt.
 *
 * Diagnostic, not a switch. A scene that needs a subsystem this build does not
 * ship already says so in the log; this is how a report can say it too.
 */
export function shippedOptionalSubsystems(): string[] {
    return [
        spine && 'spine',
        dragonBones && 'dragonBones',
        physics && 'physics',
        physics3d && 'physics3d',
        video && 'video',
    ].filter((s): s is string => typeof s === 'string');
}
