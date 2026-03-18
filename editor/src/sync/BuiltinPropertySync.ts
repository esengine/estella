import { getComponent, isBuiltinComponent } from 'esengine';
import type { EditorSceneManager } from '../scene/EditorSceneManager';
import type { EditorStore } from '../store/EditorStore';
import type { PropertyChangeEvent } from '../store/EditorStore';
import type { EntityData } from '../types/SceneTypes';
import { IncrementalSync } from './IncrementalSync';

const UIRECT_PATCH_PROPS = new Set(['offsetMin', 'offsetMax']);
const TRANSFORM_PATCH_PROPS = new Set(['position', 'rotation', 'scale']);

export class BuiltinPropertySync {
    private sceneManager_: EditorSceneManager;
    private store_: EditorStore;
    private renderCallback_: (() => void) | null = null;
    private incrementalSync_: IncrementalSync | null = null;

    constructor(sceneManager: EditorSceneManager, store: EditorStore) {
        this.sceneManager_ = sceneManager;
        this.store_ = store;
        this.initIncrementalSync_();
    }

    setRenderCallback(callback: (() => void) | null): void {
        this.renderCallback_ = callback;
    }

    trySync(event: PropertyChangeEvent, entityData: EntityData): boolean {
        if (!this.sceneManager_.hasEntity(event.entity)) return false;

        const compDef = getComponent(event.componentType);
        if (!compDef || !isBuiltinComponent(compDef)) return false;

        if (!this.store_.isEntityVisible(event.entity)) return true;

        if (event.componentType === 'Transform') {
            return this.syncTransform_(event, entityData);
        }

        if (event.componentType === 'UIRect' && UIRECT_PATCH_PROPS.has(event.propertyName)) {
            this.patchUIRectOffset_(event.entity, entityData);
            this.renderCallback_?.();
            return true;
        }

        if (this.tryIncrementalSync_(event)) {
            this.renderCallback_?.();
            return true;
        }

        return false;
    }

    private syncTransform_(event: PropertyChangeEvent, entityData: EntityData): boolean {
        if (!TRANSFORM_PATCH_PROPS.has(event.propertyName)) {
            return false;
        }

        if (event.propertyName === 'position'
            && entityData.components.some(c => c.type === 'UIRect')) {
            this.patchUIRectOffset_(event.entity, entityData);
            this.renderCallback_?.();
            return true;
        }

        const transform = entityData.components.find(c => c.type === 'Transform');
        if (transform) {
            this.sceneManager_.updateTransform(event.entity, transform.data);
        }
        this.renderCallback_?.();
        return true;
    }

    private patchUIRectOffset_(entityId: number, entityData: EntityData): void {
        const uiRect = entityData.components.find(c => c.type === 'UIRect');
        if (!uiRect) return;
        const min = uiRect.data.offsetMin as { x: number; y: number };
        const max = uiRect.data.offsetMax as { x: number; y: number };
        this.sceneManager_.patchUIRectOffset(entityId, min.x, min.y, max.x, max.y);
    }

    private initIncrementalSync_(): void {
        const world = this.sceneManager_.world;
        const module = world.getWasmModule();
        if (!module) return;
        this.incrementalSync_ = new IncrementalSync(world.builtin, module);
    }

    private tryIncrementalSync_(event: PropertyChangeEvent): boolean {
        if (!this.incrementalSync_) return false;

        const entityMap = this.sceneManager_.getEntityMap();
        const runtimeEntity = entityMap.get(event.entity);
        if (runtimeEntity === undefined) return false;

        return this.incrementalSync_.syncProperty(
            runtimeEntity,
            event.componentType,
            event.propertyName,
            event.newValue,
        );
    }
}
