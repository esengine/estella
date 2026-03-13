/**
 * @file    SpineController.ts
 * @brief   Spine animation control for the modular Spine WASM module
 */

import type { Entity, Vec2 } from '../types';
import type { SpineWasmModule, SpineWrappedAPI } from './SpineModuleLoader';

export type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'dispose' | 'event';

export interface RawSpineEvent {
    type: number;
    track: number;
    floatValue: number;
    intValue: number;
    animationName: string;
    eventName: string;
    stringValue: string;
}

export interface ConstraintList {
    ik: string[];
    transform: string[];
    path: string[];
}

export interface TransformMixData {
    mixRotate: number;
    mixX: number;
    mixY: number;
    mixScaleX: number;
    mixScaleY: number;
    mixShearY: number;
}

export interface PathMixData {
    position: number;
    spacing: number;
    mixRotate: number;
    mixX: number;
    mixY: number;
}

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
    private raw_: SpineWasmModule;
    private api_: SpineWrappedAPI;
    private listeners_: Map<Entity, Map<SpineEventType, Set<SpineEventCallback>>>;

    constructor(raw: SpineWasmModule, api: SpineWrappedAPI) {
        this.raw_ = raw;
        this.api_ = api;
        this.listeners_ = new Map();
    }

    get raw(): SpineWasmModule {
        return this.raw_;
    }

    // =========================================================================
    // Skeleton Management
    // =========================================================================

    loadSkeleton(skelData: Uint8Array | string, atlasText: string, isBinary: boolean): number {
        let ptr: number;
        let len: number;
        if (typeof skelData === 'string') {
            const encoder = new TextEncoder();
            const bytes = encoder.encode(skelData);
            len = bytes.length;
            ptr = this.raw_._malloc(len + 1);
            this.raw_.HEAPU8.set(bytes, ptr);
            this.raw_.HEAPU8[ptr + len] = 0;
        } else {
            len = skelData.length;
            ptr = this.raw_._malloc(len);
            this.raw_.HEAPU8.set(skelData, ptr);
        }
        const result = this.api_.loadSkeleton(ptr, len, atlasText, atlasText.length, isBinary);
        this.raw_._free(ptr);
        return result;
    }

    getLastError(): string {
        return this.api_.getLastError();
    }

    unloadSkeleton(handle: number): void {
        this.api_.unloadSkeleton(handle);
    }

    getAtlasPageCount(handle: number): number {
        return this.api_.getAtlasPageCount(handle);
    }

    getAtlasPageTextureName(handle: number, pageIndex: number): string {
        return this.api_.getAtlasPageTextureName(handle, pageIndex);
    }

    setAtlasPageTexture(handle: number, pageIndex: number,
                         textureId: number, width: number, height: number): void {
        this.api_.setAtlasPageTexture(handle, pageIndex, textureId, width, height);
    }

    // =========================================================================
    // Instance Management
    // =========================================================================

    createInstance(skeletonHandle: number): number {
        return this.api_.createInstance(skeletonHandle);
    }

    destroyInstance(instanceId: number): void {
        this.api_.destroyInstance(instanceId);
        this.listeners_.delete(instanceId as Entity);
    }

    // =========================================================================
    // Animation Control
    // =========================================================================

    play(instanceId: number, animation: string, loop: boolean = true, track: number = 0): boolean {
        return !!this.api_.playAnimation(instanceId, animation, loop, track);
    }

    addAnimation(instanceId: number, animation: string,
                  loop: boolean = true, delay: number = 0, track: number = 0): boolean {
        return !!this.api_.addAnimation(instanceId, animation, loop, delay, track);
    }

    setSkin(instanceId: number, skinName: string): void {
        this.api_.setSkin(instanceId, skinName);
    }

    update(instanceId: number, dt: number): void {
        this.api_.update(instanceId, dt);
    }

    // =========================================================================
    // Queries
    // =========================================================================

    getAnimations(instanceId: number): string[] {
        const json = this.api_.getAnimations(instanceId);
        try {
            return JSON.parse(json);
        } catch (e) {
            console.warn('[Spine] Failed to parse animations JSON', e);
            return [];
        }
    }

    getSkins(instanceId: number): string[] {
        const json = this.api_.getSkins(instanceId);
        try {
            return JSON.parse(json);
        } catch (e) {
            console.warn('[Spine] Failed to parse skins JSON', e);
            return [];
        }
    }

    getBonePosition(instanceId: number, boneName: string): Vec2 | null {
        const xPtr = this.raw_._malloc(4);
        const yPtr = this.raw_._malloc(4);

        const found = this.api_.getBonePosition(instanceId, boneName, xPtr, yPtr);

        if (!found) {
            this.raw_._free(xPtr);
            this.raw_._free(yPtr);
            return null;
        }

        const x = this.raw_.HEAPF32[xPtr >> 2];
        const y = this.raw_.HEAPF32[yPtr >> 2];
        this.raw_._free(xPtr);
        this.raw_._free(yPtr);
        return { x, y };
    }

    getBoneRotation(instanceId: number, boneName: string): number {
        return this.api_.getBoneRotation(instanceId, boneName);
    }

    getBounds(instanceId: number): { x: number; y: number; width: number; height: number } {
        const ptr = this.raw_._malloc(16);
        this.api_.getBounds(instanceId, ptr, ptr + 4, ptr + 8, ptr + 12);

        const f32 = this.raw_.HEAPF32;
        const base = ptr >> 2;
        const result = {
            x: f32[base],
            y: f32[base + 1],
            width: f32[base + 2],
            height: f32[base + 3],
        };
        this.raw_._free(ptr);
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
        const batchCount = this.api_.getMeshBatchCount(instanceId);
        const batches: {
            vertices: Float32Array;
            indices: Uint16Array;
            textureId: number;
            blendMode: number;
        }[] = [];

        const metaPtr = this.raw_._malloc(8);
        const texIdPtr = metaPtr;
        const blendPtr = metaPtr + 4;

        for (let i = 0; i < batchCount; i++) {
            const vertexCount = this.api_.getMeshBatchVertexCount(instanceId, i);
            const indexCount = this.api_.getMeshBatchIndexCount(instanceId, i);
            if (vertexCount <= 0 || indexCount <= 0) continue;

            const vertBytes = vertexCount * 8 * 4;
            const idxBytes = indexCount * 2;
            const vertPtr = this.raw_._malloc(vertBytes);
            const idxPtr = this.raw_._malloc(idxBytes);

            this.api_.getMeshBatchData(
                instanceId, i, vertPtr, idxPtr, texIdPtr, blendPtr);

            const vertices = new Float32Array(
                this.raw_.HEAPF32.buffer, vertPtr, vertexCount * 8);
            const indices = new Uint16Array(
                this.raw_.HEAPU8.buffer, idxPtr, indexCount);

            batches.push({
                vertices: new Float32Array(vertices),
                indices: new Uint16Array(indices),
                textureId: this.raw_.HEAPU32[texIdPtr >> 2],
                blendMode: this.raw_.HEAPU32[blendPtr >> 2],
            });

            this.raw_._free(vertPtr);
            this.raw_._free(idxPtr);
        }

        this.raw_._free(metaPtr);
        return batches;
    }

    // =========================================================================
    // Mix / Crossfade
    // =========================================================================

    setDefaultMix(skeletonHandle: number, duration: number): void {
        this.api_.setDefaultMix(skeletonHandle, duration);
    }

    setMixDuration(skeletonHandle: number, fromAnim: string, toAnim: string, duration: number): void {
        this.api_.setMixDuration(skeletonHandle, fromAnim, toAnim, duration);
    }

    setTrackAlpha(instanceId: number, track: number, alpha: number): void {
        this.api_.setTrackAlpha(instanceId, track, alpha);
    }

    // =========================================================================
    // Attachments
    // =========================================================================

    setAttachment(instanceId: number, slotName: string, attachmentName: string): boolean {
        return !!this.api_.setAttachment(instanceId, slotName, attachmentName);
    }

    // =========================================================================
    // IK Constraints
    // =========================================================================

    setIKTarget(instanceId: number, constraintName: string, targetX: number, targetY: number, mix: number): boolean {
        return !!this.api_.setIKTarget(instanceId, constraintName, targetX, targetY, mix);
    }

    // =========================================================================
    // Slot Color
    // =========================================================================

    setSlotColor(instanceId: number, slotName: string, r: number, g: number, b: number, a: number): boolean {
        return !!this.api_.setSlotColor(instanceId, slotName, r, g, b, a);
    }

    // =========================================================================
    // Events
    // =========================================================================

    enableEvents(instanceId: number): void {
        this.api_.enableEvents(instanceId);
    }

    collectEvents(instanceId: number): RawSpineEvent[] {
        const count = this.api_.getEventCount(instanceId);
        if (count === 0) return [];

        const EVENT_STRIDE = 4;
        const bufferPtr = this.api_.getEventBuffer();
        const f32 = this.raw_.HEAPF32;
        const base = bufferPtr >> 2;

        const events: RawSpineEvent[] = [];
        for (let i = 0; i < count; i++) {
            const offset = base + i * EVENT_STRIDE;
            const typeNum = f32[offset];
            events.push({
                type: typeNum,
                track: f32[offset + 1],
                floatValue: f32[offset + 2],
                intValue: f32[offset + 3],
                animationName: this.api_.getEventAnimationName(i),
                eventName: typeNum === 5 ? this.api_.getEventName(i) : '',
                stringValue: typeNum === 5 ? this.api_.getEventStringValue(i) : '',
            });
        }
        this.api_.clearEvents();
        return events;
    }

    // =========================================================================
    // Constraints
    // =========================================================================

    listConstraints(instanceId: number): ConstraintList {
        const json = this.api_.listConstraints(instanceId);
        try {
            return JSON.parse(json);
        } catch {
            return { ik: [], transform: [], path: [] };
        }
    }

    getTransformConstraintMix(instanceId: number, name: string): TransformMixData | null {
        const json = this.api_.getTransformConstraintMix(instanceId, name);
        if (!json) return null;
        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    }

    setTransformConstraintMix(instanceId: number, name: string, mix: TransformMixData): boolean {
        return !!this.api_.setTransformConstraintMix(instanceId, name,
            mix.mixRotate, mix.mixX, mix.mixY, mix.mixScaleX, mix.mixScaleY, mix.mixShearY);
    }

    getPathConstraintMix(instanceId: number, name: string): PathMixData | null {
        const json = this.api_.getPathConstraintMix(instanceId, name);
        if (!json) return null;
        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    }

    setPathConstraintMix(instanceId: number, name: string, mix: PathMixData): boolean {
        return !!this.api_.setPathConstraintMix(instanceId, name,
            mix.position, mix.spacing, mix.mixRotate, mix.mixX, mix.mixY);
    }

    // =========================================================================
    // Listeners
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
