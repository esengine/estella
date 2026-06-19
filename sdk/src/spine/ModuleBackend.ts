import type { Entity } from '../types';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { SpineModuleController } from './SpineController';
import type { RawSpineEvent, ConstraintList, TransformMixData, PathMixData } from './SpineController';
import { log } from '../logger';
import { withScratch } from '../wasmScratch';

interface EntityInfo {
    skelHandle: number;
    instanceId: number;
    skeletonScale: number;
    flipX: boolean;
    flipY: boolean;
    layer: number;
}

export class ModuleBackend {
    private controller_: SpineModuleController;
    private entities_: Map<Entity, EntityInfo> = new Map();
    private disabledEntities_: Set<Entity> = new Set();

    constructor(controller: SpineModuleController) {
        this.controller_ = controller;
    }

    get controller(): SpineModuleController {
        return this.controller_;
    }

    get entityCount(): number {
        return this.entities_.size;
    }

    loadEntity(
        entity: Entity,
        skelData: Uint8Array | string,
        atlasText: string,
        textures: Map<string, { glId: number; w: number; h: number }>,
        isBinary: boolean,
    ): boolean {
        const skelHandle = this.controller_.loadSkeleton(skelData, atlasText, isBinary);
        if (skelHandle < 0) {
            log.error('spine', `Failed to load skeleton: ${this.controller_.getLastError()}`);
            return false;
        }

        const pageCount = this.controller_.getAtlasPageCount(skelHandle);
        for (let i = 0; i < pageCount; i++) {
            const pageName = this.controller_.getAtlasPageTextureName(skelHandle, i);
            const tex = textures.get(pageName);
            if (tex) {
                this.controller_.setAtlasPageTexture(skelHandle, i, tex.glId, tex.w, tex.h);
            }
        }

        const instanceId = this.controller_.createInstance(skelHandle);
        this.entities_.set(entity, {
            skelHandle, instanceId,
            skeletonScale: 1, flipX: false, flipY: false, layer: 0,
        });
        return true;
    }

    setEntityProps(entity: Entity, props: {
        skeletonScale?: number; flipX?: boolean; flipY?: boolean; layer?: number;
    }): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        if (props.skeletonScale !== undefined) info.skeletonScale = props.skeletonScale;
        if (props.flipX !== undefined) info.flipX = props.flipX;
        if (props.flipY !== undefined) info.flipY = props.flipY;
        if (props.layer !== undefined) info.layer = props.layer;
    }

    setAnimation(entity: Entity, animation: string, loop: boolean): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.play(info.instanceId, animation, loop);
    }

    setSkin(entity: Entity, skin: string): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setSkin(info.instanceId, skin);
    }

    getBounds(entity: Entity): { x: number; y: number; width: number; height: number } | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.getBounds(info.instanceId);
    }

    getAnimations(entity: Entity): string[] {
        const info = this.entities_.get(entity);
        if (!info) return [];
        return this.controller_.getAnimations(info.instanceId);
    }

    getSkins(entity: Entity): string[] {
        const info = this.entities_.get(entity);
        if (!info) return [];
        return this.controller_.getSkins(info.instanceId);
    }

    setDefaultMix(entity: Entity, duration: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setDefaultMix(info.skelHandle, duration);
    }

    setMixDuration(entity: Entity, fromAnim: string, toAnim: string, duration: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setMixDuration(info.skelHandle, fromAnim, toAnim, duration);
    }

    setTrackAlpha(entity: Entity, track: number, alpha: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setTrackAlpha(info.instanceId, track, alpha);
    }

    setAttachment(entity: Entity, slotName: string, attachmentName: string): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setAttachment(info.instanceId, slotName, attachmentName);
    }

    setIKTarget(entity: Entity, constraintName: string, targetX: number, targetY: number, mix: number): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setIKTarget(info.instanceId, constraintName, targetX, targetY, mix);
    }

    setSlotColor(entity: Entity, slotName: string, r: number, g: number, b: number, a: number): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setSlotColor(info.instanceId, slotName, r, g, b, a);
    }

    listConstraints(entity: Entity): ConstraintList | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.listConstraints(info.instanceId);
    }

    getTransformConstraintMix(entity: Entity, name: string): TransformMixData | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.getTransformConstraintMix(info.instanceId, name);
    }

    setTransformConstraintMix(entity: Entity, name: string, mix: TransformMixData): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setTransformConstraintMix(info.instanceId, name, mix);
    }

    getPathConstraintMix(entity: Entity, name: string): PathMixData | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.getPathConstraintMix(info.instanceId, name);
    }

    setPathConstraintMix(entity: Entity, name: string, mix: PathMixData): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setPathConstraintMix(info.instanceId, name, mix);
    }

    setEnabled(entity: Entity, enabled: boolean): void {
        if (enabled) {
            this.disabledEntities_.delete(entity);
        } else {
            this.disabledEntities_.add(entity);
        }
    }

    enableEvents(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.enableEvents(info.instanceId);
    }

    collectAllEvents(): { entity: Entity; raw: RawSpineEvent }[] {
        const result: { entity: Entity; raw: RawSpineEvent }[] = [];
        for (const [entity, info] of this.entities_) {
            const events = this.controller_.collectEvents(info.instanceId);
            for (const raw of events) {
                result.push({ entity, raw });
            }
        }
        return result;
    }

    updateAll(dt: number): void {
        for (const info of this.entities_.values()) {
            this.controller_.update(info.instanceId, dt);
        }
    }

    extractAndSubmitMeshes(coreModule: ESEngineModule, registry: CppRegistry): void {
        const submitFn = coreModule.renderer_submitSpineBatchByEntity;
        if (!submitFn) return;

        for (const [entity, info] of this.entities_) {
            if (this.disabledEntities_.has(entity)) continue;
            // One engine-side scratch arena per entity; each batch's spine-heap
            // bytes are copied straight into it and submitted while the spine view
            // is still live. No intermediate JS arrays, no per-frame cache (C7).
            withScratch(coreModule, alloc => {
                this.controller_.forEachMeshBatch(info.instanceId,
                    (vertBytes, idxBytes, vertexCount, indexCount, textureId, blendMode) => {
                        const dstVert = alloc(vertBytes.byteLength);
                        const dstIdx = alloc(idxBytes.byteLength);
                        coreModule.HEAPU8.set(vertBytes, dstVert);
                        coreModule.HEAPU8.set(idxBytes, dstIdx);
                        submitFn.call(coreModule, registry,
                            dstVert, vertexCount, dstIdx, indexCount,
                            textureId, blendMode, entity as number,
                            info.skeletonScale, info.flipX, info.flipY, info.layer, 0);
                    });
            });
        }
    }

    removeEntity(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        this.controller_.destroyInstance(info.instanceId);
        this.controller_.unloadSkeleton(info.skelHandle);
        this.entities_.delete(entity);
        this.disabledEntities_.delete(entity);
    }

    shutdown(): void {
        for (const info of this.entities_.values()) {
            this.controller_.destroyInstance(info.instanceId);
            this.controller_.unloadSkeleton(info.skelHandle);
        }
        this.entities_.clear();
        this.disabledEntities_.clear();
    }
}
