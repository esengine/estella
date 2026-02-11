/**
 * @file    EditorBridge.ts
 * @brief   Bridge between editor and ESEngine runtime
 */

import type { Entity, App, ESEngineModule, CppRegistry } from 'esengine';
import type { SceneData, ComponentData as EditorComponentData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';

// =============================================================================
// EditorBridge
// =============================================================================

export class EditorBridge {
    private app_: App;
    private store_: EditorStore;
    private module_: ESEngineModule | null = null;
    private registry_: CppRegistry | null = null;

    constructor(app: App, store: EditorStore) {
        this.app_ = app;
        this.store_ = store;
        this.module_ = app.wasmModule ?? null;

        if (this.module_) {
            this.registry_ = new this.module_.Registry();
        }
    }

    // =========================================================================
    // Sync Operations
    // =========================================================================

    syncToRuntime(): void {
        if (!this.module_ || !this.registry_) return;

        const scene = this.store_.scene;

        for (const entityData of scene.entities) {
            const entity = this.registry_.create();

            for (const comp of entityData.components) {
                this.addComponentToRuntime(entity, comp);
            }
        }
    }

    syncFromRuntime(): SceneData {
        return this.store_.scene;
    }

    updateEntityInRuntime(entity: Entity): void {
        if (!this.registry_) return;

        const entityData = this.store_.getEntityData(entity as number);
        if (!entityData) return;

        for (const comp of entityData.components) {
            this.updateComponentInRuntime(entity, comp);
        }
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    render(width: number, height: number): void {
        if (!this.module_ || !this.registry_) return;
        if (width <= 0 || height <= 0) return;

        this.module_.renderFrame(this.registry_, width, height);
    }

    // =========================================================================
    // Preview Mode
    // =========================================================================

    private savedScene_: SceneData | null = null;
    private isPreviewMode_ = false;

    enterPreviewMode(): void {
        if (this.isPreviewMode_) return;

        this.savedScene_ = JSON.parse(JSON.stringify(this.store_.scene));
        this.isPreviewMode_ = true;
        this.syncToRuntime();
    }

    exitPreviewMode(): void {
        if (!this.isPreviewMode_) return;

        if (this.savedScene_) {
            this.store_.loadScene(this.savedScene_);
            this.savedScene_ = null;
        }

        this.isPreviewMode_ = false;
    }

    get isPreviewMode(): boolean {
        return this.isPreviewMode_;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private addComponentToRuntime(entity: Entity, comp: EditorComponentData): void {
        if (!this.registry_) return;

        switch (comp.type) {
            case 'LocalTransform':
                this.registry_.addLocalTransform(entity, {
                    position: comp.data.position ?? { x: 0, y: 0, z: 0 },
                    rotation: comp.data.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
                    scale: comp.data.scale ?? { x: 1, y: 1, z: 1 },
                });
                break;

            case 'Sprite':
                this.registry_.addSprite(entity, {
                    texture: comp.data.texture ?? 0,
                    color: comp.data.color ?? { r: 1, g: 1, b: 1, a: 1 },
                    size: comp.data.size ?? { x: 100, y: 100 },
                    uvOffset: comp.data.uvOffset ?? { x: 0, y: 0 },
                    uvScale: comp.data.uvScale ?? { x: 1, y: 1 },
                    layer: comp.data.layer ?? 0,
                    flipX: comp.data.flipX ?? false,
                    flipY: comp.data.flipY ?? false,
                });
                break;

            case 'Camera':
                this.registry_.addCamera(entity, {
                    isActive: comp.data.isActive ?? true,
                    projectionType: comp.data.projectionType ?? 0,
                    fov: comp.data.fov ?? 60,
                    orthoSize: comp.data.orthoSize ?? 5,
                    nearPlane: comp.data.nearPlane ?? 0.1,
                    farPlane: comp.data.farPlane ?? 1000,
                });
                break;

            case 'SpineAnimation':
                this.registry_.addSpineAnimation(entity, {
                    skeletonPath: comp.data.skeletonPath ?? '',
                    atlasPath: comp.data.atlasPath ?? '',
                    skin: comp.data.skin ?? 'default',
                    animation: comp.data.animation ?? '',
                    timeScale: comp.data.timeScale ?? 1,
                    loop: comp.data.loop ?? true,
                    playing: comp.data.playing ?? true,
                    flipX: comp.data.flipX ?? false,
                    flipY: comp.data.flipY ?? false,
                    color: comp.data.color ?? { r: 1, g: 1, b: 1, a: 1 },
                    layer: comp.data.layer ?? 0,
                    skeletonScale: comp.data.skeletonScale ?? 1,
                });
                break;
        }
    }

    private updateComponentInRuntime(entity: Entity, comp: EditorComponentData): void {
        if (!this.registry_) return;

        switch (comp.type) {
            case 'LocalTransform':
                if (this.registry_.hasLocalTransform(entity)) {
                    this.registry_.removeLocalTransform(entity);
                }
                this.addComponentToRuntime(entity, comp);
                break;

            case 'Sprite':
                if (this.registry_.hasSprite(entity)) {
                    this.registry_.removeSprite(entity);
                }
                this.addComponentToRuntime(entity, comp);
                break;

            case 'Camera':
                if (this.registry_.hasCamera(entity)) {
                    this.registry_.removeCamera(entity);
                }
                this.addComponentToRuntime(entity, comp);
                break;

            case 'SpineAnimation':
                if (this.registry_.hasSpineAnimation(entity)) {
                    this.registry_.removeSpineAnimation(entity);
                }
                this.addComponentToRuntime(entity, comp);
                break;
        }
    }
}
