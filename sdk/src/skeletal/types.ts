// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skeletal/types.ts
 * @brief   What a caller can ask of ANY skeletal runtime the engine hosts.
 *
 * @details Deliberately the intersection and not the union. Spine mixes through a
 *          from/to table set on the skeleton; DragonBones fades in at the moment
 *          of play. Spine has skins and path constraints; DragonBones has display
 *          lists and several armatures per file. Folding those together would
 *          invent a vocabulary neither runtime speaks, so each keeps its own on
 *          its own controller, and only what genuinely means the same thing in
 *          both is promised here.
 *
 *          What that leaves is the lifecycle, the queries the editor and gameplay
 *          actually reach for, and the render path — which is most of what code
 *          outside the two implementations ever touches.
 */
import type { MeshBatchVisitor } from './meshBatches';

export interface SkeletalBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SkeletalController {
    /** Why the last call that could fail did. Empty when it did not. */
    getLastError(): string;

    /** Drop a loaded file and every instance built from it. */
    unloadSkeleton(handle: number): void;

    destroyInstance(instanceId: number): void;

    /** Advance by `dt` seconds and re-pose. Geometry is read back after this. */
    update(instanceId: number, dt: number): void;

    /** Animation names this instance can play. */
    getAnimations(instanceId: number): string[];

    /** Where the posed skeleton currently is, in its own units. */
    getBounds(instanceId: number): SkeletalBounds;

    /** Visit the posed geometry; views live only for the duration of each call. */
    forEachMeshBatch(instanceId: number, cb: MeshBatchVisitor): void;
}

export type { MeshBatchVisitor };
