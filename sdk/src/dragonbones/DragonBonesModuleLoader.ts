// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonbones/DragonBonesModuleLoader.ts
 * @brief   cwrap the DragonBones side module's exports once, so the controller
 *          calls typed functions instead of re-stating signatures per call.
 */
import type { SkeletalHeap } from '../skeletal/meshBatches';

export interface DragonBonesWasmModule extends SkeletalHeap {
    cwrap(name: string, ret: string | null, sig: string[]): (...args: unknown[]) => unknown;
    HEAPF32: Float32Array;
    HEAP32: Int32Array;
}

export type DragonBonesModuleFactory = (options?: { wasmBinary?: Uint8Array }) => Promise<DragonBonesWasmModule>;

export interface DragonBonesWrappedAPI {
    loadSkeleton(skeletonPtr: number, skeletonLen: number, atlasPtr: number, atlasLen: number): number;
    getLastError(): string;
    unloadSkeleton(handle: number): void;
    getArmatures(handle: number): string;
    getAtlasImageName(handle: number): string;
    setAtlasTexture(handle: number, textureId: number): void;

    createInstance(handle: number, armatureName: string): number;
    destroyInstance(instanceId: number): void;

    playAnimation(instanceId: number, name: string, playTimes: number): number;
    fadeInAnimation(instanceId: number, name: string, fadeSeconds: number, playTimes: number): number;
    stopAnimation(instanceId: number, name: string): void;
    setTimeScale(instanceId: number, scale: number): void;
    setColor(instanceId: number, r: number, g: number, b: number, a: number): void;
    update(instanceId: number, dt: number): void;
    getAnimations(instanceId: number): string;

    getMeshBatchCount(instanceId: number): number;
    getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchData(
        instanceId: number, batchIndex: number,
        verticesPtr: number, indicesPtr: number, textureIdPtr: number, blendModePtr: number,
    ): void;
    getBounds(instanceId: number, xPtr: number, yPtr: number, wPtr: number, hPtr: number): void;
    runtimeVersion(): number;
}

const N = 'number';
const S = 'string';

/** Bind every export once; a typo becomes a load-time failure, not a call-time one. */
export function wrapDragonBonesModule(raw: DragonBonesWasmModule): DragonBonesWrappedAPI {
    const w = <T>(name: string, ret: string | null, sig: string[]): T =>
        raw.cwrap(`db_${name}`, ret, sig) as unknown as T;

    return {
        loadSkeleton: w('loadSkeleton', N, [N, N, N, N]),
        getLastError: w('getLastError', S, []),
        unloadSkeleton: w('unloadSkeleton', null, [N]),
        getArmatures: w('getArmatures', S, [N]),
        getAtlasImageName: w('getAtlasImageName', S, [N]),
        setAtlasTexture: w('setAtlasTexture', null, [N, N]),

        createInstance: w('createInstance', N, [N, S]),
        destroyInstance: w('destroyInstance', null, [N]),

        playAnimation: w('playAnimation', N, [N, S, N]),
        fadeInAnimation: w('fadeInAnimation', N, [N, S, N, N]),
        stopAnimation: w('stopAnimation', null, [N, S]),
        setTimeScale: w('setTimeScale', null, [N, N]),
        setColor: w('setColor', null, [N, N, N, N, N]),
        update: w('update', null, [N, N]),
        getAnimations: w('getAnimations', S, [N]),

        getMeshBatchCount: w('getMeshBatchCount', N, [N]),
        getMeshBatchVertexCount: w('getMeshBatchVertexCount', N, [N, N]),
        getMeshBatchIndexCount: w('getMeshBatchIndexCount', N, [N, N]),
        getMeshBatchData: w('getMeshBatchData', null, [N, N, N, N, N, N]),
        getBounds: w('getBounds', null, [N, N, N, N, N]),
        runtimeVersion: w('runtimeVersion', N, []),
    };
}
