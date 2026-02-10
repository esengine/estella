/**
 * @file    SpineController.ts
 * @brief   Spine animation control for the modular Spine WASM module
 */

import type { Entity, Vec2 } from '../types';
import type { SpineWasmModule } from './SpineModuleLoader';

export type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'dispose' | 'event';

export type SpineEventCallback = (event: SpineEvent) => void;

export interface SpineEvent {
    type: SpineEventType;
    entity: Entity;
    track: number;
    animation: string | null;
    eventName?: string;
    intValue?: number;
    floatValue?: number;
    stringValue?: string;
}

export class SpineModuleController {
    private module_: SpineWasmModule;
    private listeners_: Map<Entity, Map<SpineEventType, Set<SpineEventCallback>>>;

    constructor(spineModule: SpineWasmModule) {
        this.module_ = spineModule;
        this.listeners_ = new Map();
    }

    get module(): SpineWasmModule {
        return this.module_;
    }

    // =========================================================================
    // Skeleton Management
    // =========================================================================

    loadSkeleton(skelPath: string, atlasText: string, isBinary: boolean): number {
        return this.module_.spine_loadSkeleton(skelPath, atlasText, atlasText.length, isBinary);
    }

    unloadSkeleton(handle: number): void {
        this.module_.spine_unloadSkeleton(handle);
    }

    getAtlasPageCount(handle: number): number {
        return this.module_.spine_getAtlasPageCount(handle);
    }

    getAtlasPageTextureName(handle: number, pageIndex: number): string {
        return this.module_.spine_getAtlasPageTextureName(handle, pageIndex);
    }

    setAtlasPageTexture(handle: number, pageIndex: number,
                         textureId: number, width: number, height: number): void {
        this.module_.spine_setAtlasPageTexture(handle, pageIndex, textureId, width, height);
    }

    // =========================================================================
    // Instance Management
    // =========================================================================

    createInstance(skeletonHandle: number): number {
        return this.module_.spine_createInstance(skeletonHandle);
    }

    destroyInstance(instanceId: number): void {
        this.module_.spine_destroyInstance(instanceId);
        this.listeners_.delete(instanceId as Entity);
    }

    // =========================================================================
    // Animation Control
    // =========================================================================

    play(instanceId: number, animation: string, loop: boolean = true, track: number = 0): boolean {
        return this.module_.spine_playAnimation(instanceId, animation, loop, track);
    }

    addAnimation(instanceId: number, animation: string,
                  loop: boolean = true, delay: number = 0, track: number = 0): boolean {
        return this.module_.spine_addAnimation(instanceId, animation, loop, delay, track);
    }

    setSkin(instanceId: number, skinName: string): void {
        this.module_.spine_setSkin(instanceId, skinName);
    }

    update(instanceId: number, dt: number): void {
        this.module_.spine_update(instanceId, dt);
    }

    // =========================================================================
    // Queries
    // =========================================================================

    getAnimations(instanceId: number): string[] {
        const json = this.module_.spine_getAnimations(instanceId);
        try {
            return JSON.parse(json);
        } catch {
            return [];
        }
    }

    getSkins(instanceId: number): string[] {
        const json = this.module_.spine_getSkins(instanceId);
        try {
            return JSON.parse(json);
        } catch {
            return [];
        }
    }

    getBonePosition(instanceId: number, boneName: string): Vec2 | null {
        const xPtr = this.module_._malloc(4);
        const yPtr = this.module_._malloc(4);

        const found = this.module_.spine_getBonePosition(instanceId, boneName, xPtr, yPtr);

        if (!found) {
            this.module_._free(xPtr);
            this.module_._free(yPtr);
            return null;
        }

        const x = this.module_.HEAPF32[xPtr >> 2];
        const y = this.module_.HEAPF32[yPtr >> 2];
        this.module_._free(xPtr);
        this.module_._free(yPtr);
        return { x, y };
    }

    getBoneRotation(instanceId: number, boneName: string): number {
        return this.module_.spine_getBoneRotation(instanceId, boneName);
    }

    getBounds(instanceId: number): { x: number; y: number; width: number; height: number } {
        const ptr = this.module_._malloc(16);
        this.module_.spine_getBounds(instanceId, ptr, ptr + 4, ptr + 8, ptr + 12);

        const f32 = this.module_.HEAPF32;
        const base = ptr >> 2;
        const result = {
            x: f32[base],
            y: f32[base + 1],
            width: f32[base + 2],
            height: f32[base + 3],
        };
        this.module_._free(ptr);
        return result;
    }

    // =========================================================================
    // Mesh Extraction
    // =========================================================================

    extractMeshBatches(instanceId: number): {
        vertices: Float32Array;
        indices: Uint16Array;
        textureId: number;
        blendMode: number;
    }[] {
        const batchCount = this.module_.spine_getMeshBatchCount(instanceId);
        const batches: {
            vertices: Float32Array;
            indices: Uint16Array;
            textureId: number;
            blendMode: number;
        }[] = [];

        const metaPtr = this.module_._malloc(8);
        const texIdPtr = metaPtr;
        const blendPtr = metaPtr + 4;

        for (let i = 0; i < batchCount; i++) {
            const vertexCount = this.module_.spine_getMeshBatchVertexCount(instanceId, i);
            const indexCount = this.module_.spine_getMeshBatchIndexCount(instanceId, i);
            if (vertexCount <= 0 || indexCount <= 0) continue;

            const vertBytes = vertexCount * 8 * 4;
            const idxBytes = indexCount * 2;
            const vertPtr = this.module_._malloc(vertBytes);
            const idxPtr = this.module_._malloc(idxBytes);

            this.module_.spine_getMeshBatchData(
                instanceId, i, vertPtr, idxPtr, texIdPtr, blendPtr);

            const vertices = new Float32Array(
                this.module_.HEAPF32.buffer, vertPtr, vertexCount * 8);
            const indices = new Uint16Array(
                this.module_.HEAPU8.buffer, idxPtr, indexCount);

            batches.push({
                vertices: new Float32Array(vertices),
                indices: new Uint16Array(indices),
                textureId: this.module_.HEAPU32[texIdPtr >> 2],
                blendMode: this.module_.HEAPU32[blendPtr >> 2],
            });

            this.module_._free(vertPtr);
            this.module_._free(idxPtr);
        }

        this.module_._free(metaPtr);
        return batches;
    }

    // =========================================================================
    // Events
    // =========================================================================

    on(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void {
        if (!this.listeners_.has(entity)) {
            this.listeners_.set(entity, new Map());
        }
        const entityListeners = this.listeners_.get(entity)!;
        if (!entityListeners.has(type)) {
            entityListeners.set(type, new Set());
        }
        entityListeners.get(type)!.add(callback);
    }

    off(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void {
        const entityListeners = this.listeners_.get(entity);
        if (!entityListeners) return;
        const typeListeners = entityListeners.get(type);
        if (!typeListeners) return;
        typeListeners.delete(callback);
    }

    removeAllListeners(entity: Entity): void {
        this.listeners_.delete(entity);
    }
}
