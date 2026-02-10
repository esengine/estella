/**
 * @file    RuntimeSyncService.ts
 * @brief   Syncs editor state changes to runtime rendering
 */

import type { EditorStore, PropertyChangeEvent, HierarchyChangeEvent, VisibilityChangeEvent } from '../store/EditorStore';
import type { EditorSceneManager } from '../scene/EditorSceneManager';
import { getAssetEventBus, type AssetEvent } from '../events/AssetEventBus';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';

export class RuntimeSyncService {
    private unsubscribes_: (() => void)[] = [];
    private pendingUpdates_ = new Map<number, ReturnType<typeof setTimeout>>();

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

    private onPropertyChange(event: PropertyChangeEvent): void {
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
        const existing = this.pendingUpdates_.get(entityId);
        if (existing) {
            clearTimeout(existing);
        }

        const timeout = setTimeout(() => {
            this.pendingUpdates_.delete(entityId);
            this.syncEntity(entityId);
        }, 16);

        this.pendingUpdates_.set(entityId, timeout);
    }

    private async syncEntity(entityId: number): Promise<void> {
        if (!this.store_.isEntityVisible(entityId)) return;
        const entityData = this.store_.getEntityData(entityId);
        if (!entityData) return;
        await this.sceneManager_.updateEntity(entityId, entityData.components);
    }

    dispose(): void {
        for (const timeout of this.pendingUpdates_.values()) {
            clearTimeout(timeout);
        }
        this.pendingUpdates_.clear();

        for (const unsubscribe of this.unsubscribes_) {
            unsubscribe();
        }
        this.unsubscribes_ = [];
    }
}
