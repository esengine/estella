import { getComponent, isBuiltinComponent } from 'esengine';
import type { EditorSceneManager } from '../scene/EditorSceneManager';
import type { EditorStore } from '../store/EditorStore';
import type { PropertyChangeEvent } from '../store/EditorStore';
import type { EntityData } from '../types/SceneTypes';

const UIRECT_PATCH_PROPS = new Set(['offsetMin', 'offsetMax']);
const TRANSFORM_PATCH_PROPS = new Set(['position', 'rotation', 'scale']);

export class BuiltinPropertySync {
    private sceneManager_: EditorSceneManager;
    private store_: EditorStore;
    private renderCallback_: (() => void) | null = null;

    constructor(sceneManager: EditorSceneManager, store: EditorStore) {
        this.sceneManager_ = sceneManager;
        this.store_ = store;
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

        // Other builtin properties (anchor, pivot, size, Sprite, etc.)
        // → fall through to defaultSyncHook (scheduleEntityUpdate, async safe)
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
}
