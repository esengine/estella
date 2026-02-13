/**
 * @file    RuntimeSyncService.ts
 * @brief   Syncs editor state changes to runtime rendering
 */

import type { EditorStore, PropertyChangeEvent, HierarchyChangeEvent, VisibilityChangeEvent, EntityLifecycleEvent, ComponentChangeEvent } from '../store/EditorStore';
import type { EditorSceneManager } from '../scene/EditorSceneManager';
import { getAssetEventBus, type AssetEvent } from '../events/AssetEventBus';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';

export class RuntimeSyncService {
    private unsubscribes_: (() => void)[] = [];
    private dirtyEntities_ = new Set<number>();
    private rafId_: number | null = null;

    constructor(
        private store_: EditorStore,
        private sceneManager_: EditorSceneManager
    ) {
        this.setup();
    }

    private setup(): void {
        this.unsubscribes_.push(
            this.store_.subscribeToPropertyChanges((event) => {
                this.onPropertyChange(event);
            })
        );

        this.unsubscribes_.push(
            this.store_.subscribeToHierarchyChanges((event) => {
                this.onHierarchyChange(event);
            })
        );

        this.unsubscribes_.push(
            this.store_.subscribeToVisibilityChanges((event) => {
                this.onVisibilityChange(event);
            })
        );

        this.unsubscribes_.push(
            this.store_.subscribeToEntityLifecycle((event) => {
                this.onEntityLifecycle(event);
            })
        );

        this.unsubscribes_.push(
            this.store_.subscribeToComponentChanges((event) => {
                this.onComponentChange(event);
            })
        );

        this.unsubscribes_.push(
            getAssetEventBus().on('material', (event) => {
                if (event.type === 'asset:modified') {
                    this.onMaterialModified(event.path);
                }
            })
        );

        this.unsubscribes_.push(
            getAssetEventBus().on('texture', (event) => {
                if (event.type === 'asset:modified') {
                    this.onTextureModified(event.path);
                }
            })
        );
    }

    private onVisibilityChange(event: VisibilityChangeEvent): void {
        if (event.visible) {
            this.sceneManager_.showEntity(event.entity);
        } else {
            this.sceneManager_.hideEntity(event.entity);
        }
    }

    private onEntityLifecycle(event: EntityLifecycleEvent): void {
        if (event.type === 'created') {
            this.sceneManager_.spawnEntity(event.entity, event.parent);
        } else {
            this.sceneManager_.removeEntity(event.entity);
            this.dirtyEntities_.delete(event.entity);
        }
    }

    private onComponentChange(event: ComponentChangeEvent): void {
        if (event.action === 'removed') {
            this.sceneManager_.removeComponentFromEntity(event.entity, event.componentType);
        }
        this.scheduleEntityUpdate(event.entity);
    }

    private onPropertyChange(event: PropertyChangeEvent): void {
        if (!this.sceneManager_.hasEntity(event.entity)) return;

        if (event.componentType === 'LocalTransform') {
            this.sceneManager_.syncEntityTransform(event.entity);
        }

        if (event.componentType === 'UIRect' || event.componentType === 'ScreenSpace') {
            this.sceneManager_.syncEntityTransform(event.entity);
            this.sceneManager_.syncScreenSpaceDescendants(event.entity);
        }

        this.scheduleEntityUpdate(event.entity);

        if (event.componentType === 'Canvas') {
            this.syncCanvasToCamera(event.entity);
        }
    }

    private syncCanvasToCamera(canvasEntityId: number): void {
        const canvasData = this.store_.getEntityData(canvasEntityId);
        if (!canvasData) return;

        const canvasComp = canvasData.components.find(c => c.type === 'Canvas');
        const resolution = canvasComp?.data?.designResolution as { x: number; y: number } | undefined;
        if (!resolution) return;

        const orthoSize = resolution.y / 2;

        for (const entity of this.store_.scene.entities) {
            const cameraComp = entity.components.find(c => c.type === 'Camera');
            if (!cameraComp) continue;

            this.store_.updatePropertyDirect(entity.id, 'Camera', 'orthoSize', orthoSize);
            this.scheduleEntityUpdate(entity.id);
            break;
        }
    }

    private onHierarchyChange(event: HierarchyChangeEvent): void {
        this.sceneManager_.reparentEntity(event.entity, event.newParent);
    }

    private onMaterialModified(path: string): void {
        const users = getDependencyGraph().getUsers(path);
        for (const entityId of users) {
            this.scheduleEntityUpdate(entityId);
        }
    }

    private onTextureModified(path: string): void {
        const users = getDependencyGraph().getUsers(path);
        for (const entityId of users) {
            this.scheduleEntityUpdate(entityId);
        }
    }

    private scheduleEntityUpdate(entityId: number): void {
        this.dirtyEntities_.add(entityId);
        if (this.rafId_ !== null) return;
        this.rafId_ = requestAnimationFrame(() => {
            this.rafId_ = null;
            this.flushDirtyEntities();
        });
    }

    private flushDirtyEntities(): void {
        const entities = [...this.dirtyEntities_];
        this.dirtyEntities_.clear();
        for (const entityId of entities) {
            this.syncEntity(entityId);
        }
    }

    private async syncEntity(entityId: number): Promise<void> {
        if (!this.store_.isEntityVisible(entityId)) return;
        const entityData = this.store_.getEntityData(entityId);
        if (!entityData) return;
        await this.sceneManager_.updateEntity(entityId, entityData.components, entityData);
    }

    dispose(): void {
        if (this.rafId_ !== null) {
            cancelAnimationFrame(this.rafId_);
            this.rafId_ = null;
        }
        this.dirtyEntities_.clear();

        for (const unsubscribe of this.unsubscribes_) {
            unsubscribe();
        }
        this.unsubscribes_ = [];
    }
}
