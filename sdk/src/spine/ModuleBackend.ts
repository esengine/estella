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

const TRANSFORM_WORLD_POS_OFFSET = 40;
const TRANSFORM_WORLD_ROT_OFFSET = 52;
const TRANSFORM_WORLD_SCALE_OFFSET = 68;

export class ModuleBackend {
    private controller_: SpineModuleController;
    private entities_: Map<Entity, EntityInfo> = new Map();
    private transform16_: Float32Array = new Float32Array(16);

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
        const submitFn = coreModule.renderer_submitSpineBatch;
        if (!submitFn) return;

        const f32 = coreModule.HEAPF32;

        for (const [entity, info] of this.entities_) {
            const tPtr = coreModule.getTransformPtr?.(registry, entity as number);
            if (!tPtr) continue;

            this.buildTransformMatrix_(f32, tPtr, info.skeletonScale, info.flipX, info.flipY);

            const batches = this.controller_.extractMeshBatches(info.instanceId);
            for (const batch of batches) {
                const vertCount = batch.vertices.length / 8;
                const idxCount = batch.indices.length;
                if (vertCount <= 0 || idxCount <= 0) continue;

                const vertBytes = batch.vertices.byteLength;
                const idxBytes = batch.indices.byteLength;
                const matBytes = 16 * 4;

                const vertPtr = coreModule._malloc(vertBytes);
                const idxPtr = coreModule._malloc(idxBytes);
                const matPtr = coreModule._malloc(matBytes);

                coreModule.HEAPF32.set(batch.vertices, vertPtr >> 2);
                new Uint16Array(coreModule.HEAPU8.buffer, idxPtr, idxCount).set(batch.indices);
                coreModule.HEAPF32.set(this.transform16_, matPtr >> 2);

                submitFn.call(coreModule,
                    vertPtr, vertCount,
                    idxPtr, idxCount,
                    batch.textureId, batch.blendMode,
                    matPtr,
                    entity as number, info.layer, 0);

                coreModule._free(vertPtr);
                coreModule._free(idxPtr);
                coreModule._free(matPtr);
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

    private buildTransformMatrix_(
        f32: Float32Array, tPtr: number,
        skelScale: number, flipX: boolean, flipY: boolean,
    ): void {
        const base = tPtr >> 2;
        const posBase = base + TRANSFORM_WORLD_POS_OFFSET / 4;
        const rotBase = base + TRANSFORM_WORLD_ROT_OFFSET / 4;
        const scaleBase = base + TRANSFORM_WORLD_SCALE_OFFSET / 4;

        const px = f32[posBase], py = f32[posBase + 1], pz = f32[posBase + 2];
        const qx = f32[rotBase], qy = f32[rotBase + 1], qz = f32[rotBase + 2], qw = f32[rotBase + 3];
        const rawSx = f32[scaleBase], rawSy = f32[scaleBase + 1], rawSz = f32[scaleBase + 2];

        const sx = rawSx * skelScale * (flipX ? -1 : 1);
        const sy = rawSy * skelScale * (flipY ? -1 : 1);
        const sz = rawSz;

        const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
        const xx = qx * x2, xy = qx * y2, xz = qx * z2;
        const yy = qy * y2, yz = qy * z2, zz = qz * z2;
        const wx = qw * x2, wy = qw * y2, wz = qw * z2;

        const m = this.transform16_;
        m[0] = (1 - (yy + zz)) * sx;
        m[1] = (xy + wz) * sx;
        m[2] = (xz - wy) * sx;
        m[3] = 0;
        m[4] = (xy - wz) * sy;
        m[5] = (1 - (xx + zz)) * sy;
        m[6] = (yz + wx) * sy;
        m[7] = 0;
        m[8] = (xz + wy) * sz;
        m[9] = (yz - wx) * sz;
        m[10] = (1 - (xx + yy)) * sz;
        m[11] = 0;
        m[12] = px;
        m[13] = py;
        m[14] = pz;
        m[15] = 1;
    }
}
