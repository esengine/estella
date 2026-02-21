/**
 * @file    RuntimeSyncService.ts
 * @brief   Syncs editor state changes to runtime rendering
 */

import type { EditorStore, PropertyChangeEvent, HierarchyChangeEvent, VisibilityChangeEvent, EntityLifecycleEvent, ComponentChangeEvent } from '../store/EditorStore';
import type { EditorSceneManager } from '../scene/EditorSceneManager';
import { getAssetEventBus, type AssetEvent } from '../events/AssetEventBus';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';
import { ButtonState, FillDirection } from 'esengine';
import { computeFillAnchors, computeHandleAnchors, computeFillSize } from '../scene/uiLayoutUtils';

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

        if (event.componentType === 'Text') {
            this.sceneManager_.syncTextForEntity(event.entity);
        }

        this.scheduleEntityUpdate(event.entity);

        if (event.componentType === 'Canvas') {
            this.syncCanvasToCamera(event.entity);
        }

        if (event.componentType === 'Button') {
            this.syncButtonTransitionColor(event.entity);
        }

        if (event.componentType === 'Slider') {
            this.syncSliderChildren(event.entity);
        }

        if (event.componentType === 'ProgressBar') {
            this.syncProgressBarChildren(event.entity);
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

    private syncButtonTransitionColor(entityId: number): void {
        const entityData = this.store_.getEntityData(entityId);
        if (!entityData) return;

        const buttonComp = entityData.components.find(c => c.type === 'Button');
        if (!buttonComp) return;

        const transition = buttonComp.data.transition as {
            normalColor: { r: number; g: number; b: number; a: number };
            hoveredColor: { r: number; g: number; b: number; a: number };
            pressedColor: { r: number; g: number; b: number; a: number };
            disabledColor: { r: number; g: number; b: number; a: number };
        } | null;
        if (!transition) return;

        const spriteComp = entityData.components.find(c => c.type === 'Sprite');
        if (!spriteComp) return;

        const state = (buttonComp.data.state as number) ?? ButtonState.Normal;
        const colorMap: Record<number, { r: number; g: number; b: number; a: number }> = {
            [ButtonState.Normal]: transition.normalColor,
            [ButtonState.Hovered]: transition.hoveredColor,
            [ButtonState.Pressed]: transition.pressedColor,
            [ButtonState.Disabled]: transition.disabledColor,
        };
        const color = colorMap[state] ?? transition.normalColor;

        this.store_.updatePropertyDirect(entityId, 'Sprite', 'color', { ...color });
        this.scheduleEntityUpdate(entityId);
    }

    private syncSliderChildren(entityId: number): void {
        const entityData = this.store_.getEntityData(entityId);
        if (!entityData) return;

        const sliderComp = entityData.components.find(c => c.type === 'Slider');
        if (!sliderComp) return;

        const value = sliderComp.data.value as number ?? 0;
        const minValue = sliderComp.data.minValue as number ?? 0;
        const maxValue = sliderComp.data.maxValue as number ?? 1;
        const direction = sliderComp.data.direction as number ?? FillDirection.LeftToRight;
        const fillEntity = sliderComp.data.fillEntity as number ?? 0;
        const handleEntity = sliderComp.data.handleEntity as number ?? 0;

        const range = maxValue - minValue;
        const normalizedValue = range > 0 ? (value - minValue) / range : 0;

        const uiRectComp = entityData.components.find(c => c.type === 'UIRect');
        const sliderW = (uiRectComp?.data?.size as { x: number; y: number })?.x ?? 0;
        const sliderH = (uiRectComp?.data?.size as { x: number; y: number })?.y ?? 0;

        if (fillEntity !== 0) {
            const fillAnchors = computeFillAnchors(direction, normalizedValue);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'anchorMin', fillAnchors.anchorMin);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'anchorMax', fillAnchors.anchorMax);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'offsetMin', fillAnchors.offsetMin);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'offsetMax', fillAnchors.offsetMax);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'size',
                computeFillSize(direction, normalizedValue, sliderW, sliderH));
            this.scheduleEntityUpdate(fillEntity);
        }

        if (handleEntity !== 0) {
            const handleAnchors = computeHandleAnchors(direction, normalizedValue);
            this.store_.updatePropertyDirect(handleEntity, 'UIRect', 'anchorMin', handleAnchors.anchorMin);
            this.store_.updatePropertyDirect(handleEntity, 'UIRect', 'anchorMax', handleAnchors.anchorMax);
            this.store_.updatePropertyDirect(handleEntity, 'UIRect', 'offsetMin', { x: 0, y: 0 });
            this.store_.updatePropertyDirect(handleEntity, 'UIRect', 'offsetMax', { x: 0, y: 0 });
            this.scheduleEntityUpdate(handleEntity);
        }
    }

    private syncProgressBarChildren(entityId: number): void {
        const entityData = this.store_.getEntityData(entityId);
        if (!entityData) return;

        const barComp = entityData.components.find(c => c.type === 'ProgressBar');
        if (!barComp) return;

        const value = Math.max(0, Math.min(1, barComp.data.value as number ?? 0));
        const direction = barComp.data.direction as number ?? FillDirection.LeftToRight;
        const fillEntity = barComp.data.fillEntity as number ?? 0;

        const uiRectComp = entityData.components.find(c => c.type === 'UIRect');
        const barW = (uiRectComp?.data?.size as { x: number; y: number })?.x ?? 0;
        const barH = (uiRectComp?.data?.size as { x: number; y: number })?.y ?? 0;

        if (fillEntity !== 0) {
            const fillAnchors = computeFillAnchors(direction, value);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'anchorMin', fillAnchors.anchorMin);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'anchorMax', fillAnchors.anchorMax);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'offsetMin', fillAnchors.offsetMin);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'offsetMax', fillAnchors.offsetMax);
            this.store_.updatePropertyDirect(fillEntity, 'UIRect', 'size',
                computeFillSize(direction, value, barW, barH));
            this.scheduleEntityUpdate(fillEntity);
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
