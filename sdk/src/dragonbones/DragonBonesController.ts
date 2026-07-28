// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonbones/DragonBonesController.ts
 * @brief   One loaded DragonBones module, driven from TypeScript.
 *
 * @details Implements SkeletalController — the part that means the same thing as
 *          it does for Spine — and then adds what only DragonBones has, rather
 *          than bending either runtime into the other's vocabulary.
 *
 *          Two additions are worth naming. `getArmatures` exists because a
 *          DragonBones file is a project holding several armatures, so choosing
 *          one is a real step and not a detail. And `fadeIn` is where Spine would
 *          set a mix duration: DragonBones crossfades at the moment of play, so
 *          the fade is an argument to starting an animation, not state on the
 *          skeleton.
 */
import { forEachMeshBatch, type MeshBatchVisitor } from '../skeletal/meshBatches';
import type { SkeletalBounds, SkeletalController } from '../skeletal/types';
import type { DragonBonesWasmModule, DragonBonesWrappedAPI } from './DragonBonesModuleLoader';
import { withMalloc } from '../wasmScratch';
import { encodeUtf8 } from '../utf8';
import { log } from '../logger';

/** Parse a `["a","b"]` the module published; a malformed one is no names, not a throw. */
function parseNames(json: string): string[] {
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
        return [];
    }
}

export class DragonBonesModuleController implements SkeletalController {
    private readonly raw_: DragonBonesWasmModule;
    private readonly api_: DragonBonesWrappedAPI;

    constructor(raw: DragonBonesWasmModule, api: DragonBonesWrappedAPI) {
        this.raw_ = raw;
        this.api_ = api;
    }

    // — Resources ————————————————————————————————————————————————————————————

    /**
     * Parse a skeleton and its atlas together; -1 on failure, with the reason in
     * {@link getLastError}. Both are copied into the module's heap because the
     * parsers want a terminated string and the caller's bytes are not one.
     */
    loadSkeleton(skeletonData: Uint8Array | string, atlasJson: string): number {
        const skeleton = typeof skeletonData === 'string'
            ? encodeUtf8(skeletonData)
            : skeletonData;
        const atlas = encodeUtf8(atlasJson);

        return withMalloc(this.raw_, skeleton.length + atlas.length, basePtr => {
            const skeletonPtr = basePtr;
            const atlasPtr = basePtr + skeleton.length;
            this.raw_.HEAPU8.set(skeleton, skeletonPtr);
            this.raw_.HEAPU8.set(atlas, atlasPtr);
            return this.api_.loadSkeleton(skeletonPtr, skeleton.length, atlasPtr, atlas.length);
        });
    }

    getLastError(): string {
        return this.api_.getLastError();
    }

    unloadSkeleton(handle: number): void {
        this.api_.unloadSkeleton(handle);
    }

    /** The armatures this file holds — DragonBones-only; a Spine file has one skeleton. */
    getArmatures(handle: number): string[] {
        return parseNames(this.api_.getArmatures(handle));
    }

    /** The image the atlas expects, so the caller knows what to upload. */
    getAtlasImageName(handle: number): string {
        return this.api_.getAtlasImageName(handle);
    }

    /**
     * Bind the uploaded page. Safe to call after instances exist — the module
     * invalidates them, because uploading last is the normal order.
     */
    setAtlasTexture(handle: number, textureId: number): void {
        this.api_.setAtlasTexture(handle, textureId);
    }

    // — Instances ————————————————————————————————————————————————————————————

    /** -1 when the file holds no armature by that name (see {@link getArmatures}). */
    createInstance(skeletonHandle: number, armatureName: string): number {
        const id = this.api_.createInstance(skeletonHandle, armatureName);
        if (id < 0) log.warn('dragonbones', `createInstance failed: ${this.getLastError()}`);
        return id;
    }

    destroyInstance(instanceId: number): void {
        this.api_.destroyInstance(instanceId);
    }

    // — Animation ————————————————————————————————————————————————————————————

    /** `loop` false plays once; DragonBones counts plays, where 0 means forever. */
    play(instanceId: number, animation: string, loop = true): boolean {
        return this.api_.playAnimation(instanceId, animation, loop ? 0 : 1) !== 0;
    }

    /** Crossfade into `animation` over `fadeSeconds` — Spine's mix table, per play. */
    fadeIn(instanceId: number, animation: string, fadeSeconds: number, loop = true): boolean {
        return this.api_.fadeInAnimation(instanceId, animation, fadeSeconds, loop ? 0 : 1) !== 0;
    }

    stop(instanceId: number, animation = ''): void {
        this.api_.stopAnimation(instanceId, animation);
    }

    setTimeScale(instanceId: number, scale: number): void {
        this.api_.setTimeScale(instanceId, scale);
    }

    update(instanceId: number, dt: number): void {
        this.api_.update(instanceId, dt);
    }

    getAnimations(instanceId: number): string[] {
        return parseNames(this.api_.getAnimations(instanceId));
    }

    // — Geometry ————————————————————————————————————————————————————————————

    getBounds(instanceId: number): SkeletalBounds {
        return withMalloc(this.raw_, 16, ptr => {
            this.api_.getBounds(instanceId, ptr, ptr + 4, ptr + 8, ptr + 12);
            const f = this.raw_.HEAPF32;
            return {
                x: f[ptr >> 2],
                y: f[(ptr + 4) >> 2],
                width: f[(ptr + 8) >> 2],
                height: f[(ptr + 12) >> 2],
            };
        });
    }

    forEachMeshBatch(instanceId: number, cb: MeshBatchVisitor): void {
        forEachMeshBatch(this.raw_, this.api_, instanceId, cb);
    }

    /** The DragonBones data format this module reads. */
    runtimeVersion(): number {
        return this.api_.runtimeVersion();
    }
}
