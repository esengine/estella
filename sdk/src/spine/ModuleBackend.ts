import type { Entity } from '../types';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { SpineModuleController } from './SpineController';

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
            console.error(`[ModuleBackend] Failed to load skeleton: ${this.controller_.getLastError()}`);
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

    updateAll(dt: number): void {
        for (const info of this.entities_.values()) {
            this.controller_.update(info.instanceId, dt);
        }
    }

    extractAndSubmitMeshes(coreModule: ESEngineModule, registry: CppRegistry): void {
        const submitFn = coreModule.renderer_submitSpineBatchByEntity;
        if (!submitFn) return;

        for (const [entity, info] of this.entities_) {
            const batches = this.controller_.extractMeshBatches(info.instanceId);
            for (const batch of batches) {
                const vertCount = batch.vertices.length / 8;
                const idxCount = batch.indices.length;
                if (vertCount <= 0 || idxCount <= 0) continue;

                const vertPtr = coreModule._malloc(batch.vertices.byteLength);
                const idxPtr = coreModule._malloc(batch.indices.byteLength);

                coreModule.HEAPF32.set(batch.vertices, vertPtr >> 2);
                new Uint16Array(coreModule.HEAPU8.buffer, idxPtr, idxCount).set(batch.indices);

                submitFn.call(coreModule, registry,
                    vertPtr, vertCount,
                    idxPtr, idxCount,
                    batch.textureId, batch.blendMode,
                    entity as number, info.skeletonScale, info.flipX, info.flipY,
                    info.layer, 0);

                coreModule._free(vertPtr);
                coreModule._free(idxPtr);
            }
        }
    }

    removeEntity(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        this.controller_.destroyInstance(info.instanceId);
        this.controller_.unloadSkeleton(info.skelHandle);
        this.entities_.delete(entity);
    }

    shutdown(): void {
        for (const info of this.entities_.values()) {
            this.controller_.destroyInstance(info.instanceId);
            this.controller_.unloadSkeleton(info.skelHandle);
        }
        this.entities_.clear();
    }
}
