import type { Entity } from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import type { EditorState, EditorListener, AssetSelection } from '../store/EditorStore';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    CHANNEL_STATE,
    CHANNEL_ACTION,
    CHANNEL_ACTION_RESULT,
    CHANNEL_PANEL_OPENED,
    type SerializedEditorState,
    type ActionMessage,
    type ActionResultMessage,
    type ActionType,
} from './protocol';

const ACTION_TIMEOUT = 10_000;

let actionIdCounter = 0;

function nextActionId(): string {
    return `action-${++actionIdCounter}-${Date.now()}`;
}

export class RemoteEditorStore {
    private state_: EditorState;
    private entityMap_ = new Map<number, EntityData>();
    private sceneVersion_ = 0;
    private canUndo_ = false;
    private canRedo_ = false;
    private isEditingPrefab_ = false;
    private prefabEditingPath_: string | null = null;

    private listeners_ = new Set<EditorListener>();
    private pendingActions_ = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private unlisteners_: UnlistenFn[] = [];
    private panelId_: string;

    constructor(panelId: string) {
        this.panelId_ = panelId;
        this.state_ = {
            scene: { version: '1', name: 'Untitled', entities: [] },
            selectedEntities: new Set(),
            selectedAsset: null,
            isDirty: false,
            filePath: null,
        };
    }

    // =========================================================================
    // Connection
    // =========================================================================

    async connect(): Promise<void> {
        const unlistenState = await listen<SerializedEditorState>(CHANNEL_STATE, (event) => {
            this.applySnapshot(event.payload);
        });

        const unlistenResult = await listen<ActionResultMessage>(CHANNEL_ACTION_RESULT, (event) => {
            const pending = this.pendingActions_.get(event.payload.id);
            if (pending) {
                this.pendingActions_.delete(event.payload.id);
                if (event.payload.error) {
                    pending.reject(new Error(event.payload.error));
                } else {
                    pending.resolve(event.payload.result);
                }
            }
        });

        this.unlisteners_.push(unlistenState, unlistenResult);

        await emit(CHANNEL_PANEL_OPENED, {
            panelId: this.panelId_,
            windowLabel: '',
        });
    }

    disconnect(): void {
        for (const unlisten of this.unlisteners_) {
            unlisten();
        }
        this.unlisteners_ = [];
        this.pendingActions_.clear();
    }

    // =========================================================================
    // State Access (read-only, from snapshot)
    // =========================================================================

    get state(): Readonly<EditorState> {
        return this.state_;
    }

    get scene(): SceneData {
        return this.state_.scene;
    }

    get sceneVersion(): number {
        return this.sceneVersion_;
    }

    get selectedEntities(): ReadonlySet<number> {
        return this.state_.selectedEntities;
    }

    get selectedEntity(): Entity | null {
        if (this.state_.selectedEntities.size !== 1) return null;
        return this.state_.selectedEntities.values().next().value as Entity;
    }

    get selectedAsset(): AssetSelection | null {
        return this.state_.selectedAsset;
    }

    get isDirty(): boolean {
        return this.state_.isDirty;
    }

    get filePath(): string | null {
        return this.state_.filePath;
    }

    get canUndo(): boolean {
        return this.canUndo_;
    }

    get canRedo(): boolean {
        return this.canRedo_;
    }

    get isEditingPrefab(): boolean {
        return this.isEditingPrefab_;
    }

    get prefabEditingPath(): string | null {
        return this.prefabEditingPath_;
    }

    getEntityData(entityId: number): EntityData | null {
        return this.entityMap_.get(entityId) ?? null;
    }

    getSelectedEntityData(): EntityData | null {
        const entity = this.selectedEntity;
        if (entity === null) return null;
        return this.entityMap_.get(entity) ?? null;
    }

    getSelectedEntitiesData(): EntityData[] {
        const result: EntityData[] = [];
        for (const id of this.state_.selectedEntities) {
            const data = this.entityMap_.get(id);
            if (data) result.push(data);
        }
        return result;
    }

    getComponent(entity: Entity, type: string): ComponentData | null {
        const data = this.entityMap_.get(entity);
        if (!data) return null;
        return data.components.find(c => c.type === type) ?? null;
    }

    isEntityVisible(entityId: number): boolean {
        const data = this.entityMap_.get(entityId);
        return data?.visible !== false;
    }

    isEntityDirectlyHidden(entityId: number): boolean {
        const data = this.entityMap_.get(entityId);
        if (!data || data.visible !== false) return false;
        const parentId = data.parent;
        if (parentId === null) return true;
        const parentData = this.entityMap_.get(parentId);
        return parentData?.visible !== false;
    }

    isPrefabInstance(entityId: number): boolean {
        const data = this.entityMap_.get(entityId);
        return !!data?.prefab;
    }

    isPrefabRoot(entityId: number): boolean {
        const data = this.entityMap_.get(entityId);
        if (!data?.prefab) return false;
        const parentData = data.parent !== null ? this.entityMap_.get(data.parent) : null;
        return !parentData?.prefab || parentData.prefab.instanceId !== data.prefab.instanceId;
    }

    getPrefabInstanceId(entityId: number): string | undefined {
        return this.entityMap_.get(entityId)?.prefab?.instanceId;
    }

    getPrefabPath(entityId: number): string | undefined {
        return this.entityMap_.get(entityId)?.prefab?.prefabPath;
    }

    // =========================================================================
    // Subscription
    // =========================================================================

    subscribe(listener: EditorListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    subscribeToPropertyChanges(): () => void {
        return () => {};
    }

    subscribeToHierarchyChanges(): () => void {
        return () => {};
    }

    subscribeToEntityLifecycle(): () => void {
        return () => {};
    }

    subscribeToComponentChanges(): () => void {
        return () => {};
    }

    subscribeToVisibilityChanges(): () => void {
        return () => {};
    }

    subscribeToSceneSync(): () => void {
        return () => {};
    }

    onFocusEntity(): () => void {
        return () => {};
    }

    // =========================================================================
    // Mutation Methods (forwarded to main window)
    // =========================================================================

    selectEntity(entity: Entity | null, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
        this.fireAction('selectEntity', [entity, mode]);
    }

    selectEntities(entities: number[]): void {
        this.fireAction('selectEntities', [entities]);
    }

    selectAsset(asset: AssetSelection | null): void {
        this.fireAction('selectAsset', [asset]);
    }

    createEntity(name?: string, parent?: Entity | null): Entity {
        this.fireAction('createEntity', [name, parent ?? null]);
        return 0 as Entity;
    }

    async createEntityAsync(name?: string, parent?: Entity | null): Promise<Entity> {
        const result = await this.fireActionAsync('createEntity', [name, parent ?? null]);
        return result as Entity;
    }

    deleteEntity(entity: Entity): void {
        this.fireAction('deleteEntity', [entity]);
    }

    deleteSelectedEntities(): void {
        this.fireAction('deleteSelectedEntities', []);
    }

    renameEntity(entity: Entity, name: string): void {
        this.fireAction('renameEntity', [entity, name]);
    }

    reparentEntity(entity: Entity, newParent: Entity | null): void {
        this.fireAction('reparentEntity', [entity, newParent]);
    }

    moveEntity(entity: Entity, newParent: Entity | null, index: number): void {
        this.fireAction('moveEntity', [entity, newParent, index]);
    }

    addComponent(entity: Entity, type: string, data: Record<string, unknown>): void {
        this.fireAction('addComponent', [entity, type, data]);
    }

    removeComponent(entity: Entity, type: string): void {
        this.fireAction('removeComponent', [entity, type]);
    }

    reorderComponent(entity: Entity, fromIndex: number, toIndex: number): void {
        this.fireAction('reorderComponent', [entity, fromIndex, toIndex]);
    }

    updateProperty(
        entity: Entity,
        componentType: string,
        propertyName: string,
        oldValue: unknown,
        newValue: unknown,
    ): void {
        this.fireAction('updateProperty', [entity, componentType, propertyName, oldValue, newValue]);
    }

    updateProperties(
        entity: Entity,
        componentType: string,
        changes: { property: string; oldValue: unknown; newValue: unknown }[],
    ): void {
        this.fireAction('updateProperties', [entity, componentType, changes]);
    }

    updatePropertyDirect(
        entity: Entity,
        componentType: string,
        propertyName: string,
        newValue: unknown,
    ): void {
        this.fireAction('updatePropertyDirect', [entity, componentType, propertyName, newValue]);
    }

    toggleVisibility(entityId: number): void {
        this.fireAction('toggleVisibility', [entityId]);
    }

    undo(): void {
        this.fireAction('undo', []);
    }

    redo(): void {
        this.fireAction('redo', []);
    }

    // No-op stubs for methods only relevant to main window
    notifyChange(): void {}
    focusEntity(): void {}
    selectRange(): void {}

    // =========================================================================
    // Internal
    // =========================================================================

    private applySnapshot(snapshot: SerializedEditorState): void {
        this.state_ = {
            scene: snapshot.scene,
            selectedEntities: new Set(snapshot.selectedEntities),
            selectedAsset: snapshot.selectedAsset,
            isDirty: snapshot.isDirty,
            filePath: snapshot.filePath,
        };
        this.canUndo_ = snapshot.canUndo;
        this.canRedo_ = snapshot.canRedo;
        this.isEditingPrefab_ = snapshot.isEditingPrefab;
        this.prefabEditingPath_ = snapshot.prefabEditingPath;
        this.sceneVersion_ = snapshot.sceneVersion;

        this.entityMap_.clear();
        for (const entity of snapshot.scene.entities) {
            this.entityMap_.set(entity.id, entity);
        }

        for (const listener of this.listeners_) {
            listener(this.state_);
        }
    }

    private fireAction(type: ActionType, args: unknown[]): void {
        const msg: ActionMessage = { id: nextActionId(), type, args };
        emit(CHANNEL_ACTION, msg);
    }

    private fireActionAsync(type: ActionType, args: unknown[]): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const msg: ActionMessage = { id: nextActionId(), type, args };
            this.pendingActions_.set(msg.id, { resolve, reject });
            emit(CHANNEL_ACTION, msg);

            setTimeout(() => {
                if (this.pendingActions_.has(msg.id)) {
                    this.pendingActions_.delete(msg.id);
                    reject(new Error(`Action ${type} timed out`));
                }
            }, ACTION_TIMEOUT);
        });
    }
}
