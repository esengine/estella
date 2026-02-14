/**
 * @file    EditorBridge.ts
 * @brief   Bridge between editor and ESEngine runtime
 */

import { World, loadComponent, type Entity, type App, type ESEngineModule, type CppRegistry, type SceneComponentData } from 'esengine';
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
    private world_: World | null = null;

    constructor(app: App, store: EditorStore) {
        this.app_ = app;
        this.store_ = store;
        this.module_ = app.wasmModule ?? null;

        if (this.module_) {
            this.registry_ = new this.module_.Registry();
            this.world_ = new World();
            this.world_.connectCpp(this.registry_);
        }
    }

    // =========================================================================
    // Sync Operations
    // =========================================================================

    syncToRuntime(): void {
        if (!this.module_ || !this.world_) return;

        const scene = this.store_.scene;

        for (const entityData of scene.entities) {
            const entity = this.world_.spawn();

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
    // Private Methods
    // =========================================================================

    private addComponentToRuntime(entity: Entity, comp: EditorComponentData): void {
        if (!this.world_) return;
        loadComponent(this.world_, entity, comp as SceneComponentData);
    }

    private updateComponentInRuntime(entity: Entity, comp: EditorComponentData): void {
        if (!this.world_ || !this.registry_) return;
        const has = this.registry_[`has${comp.type}`] as ((e: Entity) => boolean) | undefined;
        const remove = this.registry_[`remove${comp.type}`] as ((e: Entity) => void) | undefined;
        if (has?.call(this.registry_, entity)) {
            remove?.call(this.registry_, entity);
        }
        this.addComponentToRuntime(entity, comp);
    }
}
