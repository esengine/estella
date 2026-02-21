import type { Entity } from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { createEmptyScene } from '../types/SceneTypes';
import { CommandHistory, type Command } from '../commands';
import { WorldTransformCache } from '../transform/WorldTransformCache';
import type { Transform } from '../math/Transform';
import { SelectionService } from './SelectionService';
import { SceneOperations } from './SceneOperations';
import { PrefabEditService } from './PrefabEditService';

// =============================================================================
// Types
// =============================================================================

export type AssetType = 'image' | 'script' | 'scene' | 'audio' | 'json' | 'material' | 'shader' | 'font' | 'file' | 'folder';

export interface AssetSelection {
    path: string;
    type: AssetType;
    name: string;
}

export interface EditorState {
    scene: SceneData;
    selectedEntities: Set<number>;
    selectedAsset: AssetSelection | null;
    isDirty: boolean;
    filePath: string | null;
}

export type DirtyFlag = 'scene' | 'selection' | 'hierarchy' | 'property';

export type EditorListener = (state: EditorState, dirtyFlags?: ReadonlySet<DirtyFlag>) => void;

export interface PropertyChangeEvent {
    entity: number;
    componentType: string;
    propertyName: string;
    oldValue: unknown;
    newValue: unknown;
}

export type PropertyChangeListener = (event: PropertyChangeEvent) => void;

export interface HierarchyChangeEvent {
    entity: number;
    newParent: number | null;
}

export type HierarchyChangeListener = (event: HierarchyChangeEvent) => void;

export interface VisibilityChangeEvent {
    entity: number;
    visible: boolean;
}

export type VisibilityChangeListener = (event: VisibilityChangeEvent) => void;

export interface EntityLifecycleEvent {
    entity: number;
    type: 'created' | 'deleted';
    parent: number | null;
}

export type EntityLifecycleListener = (event: EntityLifecycleEvent) => void;

export interface ComponentChangeEvent {
    entity: number;
    componentType: string;
    action: 'added' | 'removed';
}

export type ComponentChangeListener = (event: ComponentChangeEvent) => void;

// =============================================================================
// EditorStore
// =============================================================================

export class EditorStore {
    state_: EditorState;
    private history_: CommandHistory;
    private listeners_ = new Set<EditorListener>();
    private propertyListeners_ = new Set<PropertyChangeListener>();
    private hierarchyListeners_ = new Set<HierarchyChangeListener>();
    private visibilityListeners_ = new Set<VisibilityChangeListener>();
    private entityLifecycleListeners_ = new Set<EntityLifecycleListener>();
    private componentChangeListeners_ = new Set<ComponentChangeListener>();
    private sceneSyncListeners_ = new Set<() => void>();
    private pendingNotify_ = false;
    private dirtyFlags_ = new Set<DirtyFlag>();
    nextEntityId_ = 1;
    private sceneVersion_ = 0;
    worldTransforms_ = new WorldTransformCache();
    entityMap_ = new Map<number, EntityData>();

    private autoSaveTimer_: ReturnType<typeof setInterval> | null = null;

    private readonly selection_: SelectionService;
    private readonly sceneOps_: SceneOperations;
    private readonly prefabEdit_: PrefabEditService;

    private static readonly AUTOSAVE_KEY = 'esengine.autosave';
    private static readonly AUTOSAVE_INTERVAL = 60_000;

    constructor() {
        const scene = createEmptyScene();
        this.state_ = {
            scene,
            selectedEntities: new Set(),
            selectedAsset: null,
            isDirty: false,
            filePath: null,
        };
        this.history_ = new CommandHistory();
        this.nextEntityId_ = this.computeNextEntityId(scene);
        this.rebuildEntityMap();
        this.worldTransforms_.setScene(scene);

        this.selection_ = new SelectionService(this);
        this.sceneOps_ = new SceneOperations(this);
        this.prefabEdit_ = new PrefabEditService(this);

        this.startAutoSave();
    }

    private computeNextEntityId(scene: SceneData): number {
        const maxId = scene.entities.reduce((max, e) => Math.max(max, e.id), 0);
        return maxId + 1;
    }

    // =========================================================================
    // State Access
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

    get prefabEditingPath(): string | null {
        return this.prefabEdit_.prefabEditingPath;
    }

    get isEditingPrefab(): boolean {
        return this.prefabEdit_.isEditingPrefab;
    }

    get canUndo(): boolean {
        return this.history_.canUndo();
    }

    get canRedo(): boolean {
        return this.history_.canRedo();
    }

    get undoDescription(): string | null {
        return this.history_.undoDescription;
    }

    get redoDescription(): string | null {
        return this.history_.redoDescription;
    }

    get isDirty(): boolean {
        return this.state_.isDirty;
    }

    get filePath(): string | null {
        return this.state_.filePath;
    }

    // =========================================================================
    // Scene Operations
    // =========================================================================

    newScene(name: string = 'Untitled', designResolution?: { width: number; height: number }): void {
        this.saveRecoveryBackup();
        this.state_.scene = createEmptyScene(name, designResolution);
        this.state_.selectedEntities.clear();
        this.state_.selectedAsset = null;
        this.state_.isDirty = false;
        this.state_.filePath = null;
        this.history_.clear();
        this.nextEntityId_ = this.computeNextEntityId(this.state_.scene);
        this.rebuildEntityMap();
        this.worldTransforms_.setScene(this.state_.scene);
        this.notifySceneSync();
        this.notify('scene');
    }

    loadScene(scene: SceneData, filePath: string | null = null): void {
        this.saveRecoveryBackup();
        this.state_.scene = scene;
        this.state_.selectedEntities.clear();
        this.state_.selectedAsset = null;
        this.state_.isDirty = false;
        this.state_.filePath = filePath;
        this.history_.clear();

        this.nextEntityId_ = this.computeNextEntityId(scene);

        this.rebuildEntityMap();
        this.worldTransforms_.setScene(scene);
        this.notifySceneSync();
        this.notify('scene');
    }

    markSaved(filePath: string | null = null): void {
        this.state_.isDirty = false;
        if (filePath) {
            this.state_.filePath = filePath;
        }
        this.clearAutoSave();
        this.notify('scene');
    }

    hasRecoveryData(): boolean {
        try {
            return localStorage.getItem(EditorStore.AUTOSAVE_KEY) !== null;
        } catch {
            return false;
        }
    }

    recoverScene(): SceneData | null {
        try {
            const raw = localStorage.getItem(EditorStore.AUTOSAVE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw) as { scene: SceneData; filePath: string | null };
            this.clearAutoSave();
            this.loadScene(data.scene, data.filePath);
            this.state_.isDirty = true;
            this.notify('scene');
            return data.scene;
        } catch {
            this.clearAutoSave();
            return null;
        }
    }

    dismissRecovery(): void {
        this.clearAutoSave();
    }

    // =========================================================================
    // Selection (delegated to SelectionService)
    // =========================================================================

    selectEntity(entity: Entity | null, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
        this.selection_.selectEntity(entity, mode);
    }

    selectEntities(entities: number[]): void {
        this.selection_.selectEntities(entities);
    }

    selectRange(fromEntity: number, toEntity: number): void {
        this.selection_.selectRange(fromEntity, toEntity);
    }

    selectAsset(asset: AssetSelection | null): void {
        this.selection_.selectAsset(asset);
    }

    getSelectedEntityData(): EntityData | null {
        return this.selection_.getSelectedEntityData();
    }

    getSelectedEntitiesData(): EntityData[] {
        return this.selection_.getSelectedEntitiesData();
    }

    getEntityData(entityId: number): EntityData | null {
        return this.entityMap_.get(entityId) ?? null;
    }

    focusEntity(entityId: number): void {
        this.selection_.focusEntity(entityId);
    }

    onFocusEntity(listener: (entityId: number) => void): () => void {
        return this.selection_.onFocusEntity(listener);
    }

    // =========================================================================
    // Visibility (delegated to SceneOperations)
    // =========================================================================

    toggleVisibility(entityId: number): void {
        this.sceneOps_.toggleVisibility(entityId);
    }

    isEntityVisible(entityId: number): boolean {
        const entityData = this.entityMap_.get(entityId);
        return entityData?.visible !== false;
    }

    isEntityDirectlyHidden(entityId: number): boolean {
        const entityData = this.entityMap_.get(entityId);
        if (!entityData || entityData.visible !== false) return false;
        const parentId = entityData.parent;
        if (parentId === null) return true;
        const parentData = this.entityMap_.get(parentId);
        return parentData?.visible !== false;
    }

    subscribeToVisibilityChanges(listener: VisibilityChangeListener): () => void {
        this.visibilityListeners_.add(listener);
        return () => this.visibilityListeners_.delete(listener);
    }

    // =========================================================================
    // Entity Operations (delegated to SceneOperations)
    // =========================================================================

    createEntity(name?: string, parent: Entity | null = null): Entity {
        return this.sceneOps_.createEntity(name, parent);
    }

    deleteEntity(entity: Entity): void {
        this.sceneOps_.deleteEntity(entity);
    }

    deleteSelectedEntities(): void {
        this.sceneOps_.deleteSelectedEntities();
    }

    reparentEntity(entity: Entity, newParent: Entity | null): void {
        this.sceneOps_.reparentEntity(entity, newParent);
    }

    moveEntity(entity: Entity, newParent: Entity | null, index: number): void {
        this.sceneOps_.moveEntity(entity, newParent, index);
    }

    renameEntity(entity: Entity, name: string): void {
        this.sceneOps_.renameEntity(entity, name);
    }

    // =========================================================================
    // Component Operations (delegated to SceneOperations)
    // =========================================================================

    addComponent(entity: Entity, type: string, data: Record<string, unknown>): void {
        this.sceneOps_.addComponent(entity, type, data);
    }

    removeComponent(entity: Entity, type: string): void {
        this.sceneOps_.removeComponent(entity, type);
    }

    reorderComponent(entity: Entity, fromIndex: number, toIndex: number): void {
        this.sceneOps_.reorderComponent(entity, fromIndex, toIndex);
    }

    updateProperty(
        entity: Entity,
        componentType: string,
        propertyName: string,
        oldValue: unknown,
        newValue: unknown
    ): void {
        this.sceneOps_.updateProperty(entity, componentType, propertyName, oldValue, newValue);
    }

    updateProperties(
        entity: Entity,
        componentType: string,
        changes: { property: string; oldValue: unknown; newValue: unknown }[]
    ): void {
        this.sceneOps_.updateProperties(entity, componentType, changes);
    }

    getComponent(entity: Entity, type: string): ComponentData | null {
        return this.sceneOps_.getComponent(entity, type);
    }

    updatePropertyDirect(
        entity: Entity,
        componentType: string,
        propertyName: string,
        newValue: unknown
    ): void {
        this.sceneOps_.updatePropertyDirect(entity, componentType, propertyName, newValue);
    }

    // =========================================================================
    // World Transform
    // =========================================================================

    getWorldTransform(entityId: number): Transform {
        return this.worldTransforms_.getWorldTransform(entityId);
    }

    invalidateAllTransforms(): void {
        this.worldTransforms_.invalidateAll();
    }

    // =========================================================================
    // Prefab Operations (delegated to PrefabEditService)
    // =========================================================================

    async instantiatePrefab(prefabPath: string, parentEntity: Entity | null = null): Promise<Entity | null> {
        return this.prefabEdit_.instantiatePrefab(prefabPath, parentEntity);
    }

    async saveAsPrefab(entityId: number, filePath: string): Promise<boolean> {
        return this.prefabEdit_.saveAsPrefab(entityId, filePath);
    }

    async revertPrefabInstance(instanceId: string, prefabPath: string): Promise<void> {
        return this.prefabEdit_.revertPrefabInstance(instanceId, prefabPath);
    }

    async applyPrefabOverrides(instanceId: string, prefabPath: string): Promise<void> {
        return this.prefabEdit_.applyPrefabOverrides(instanceId, prefabPath);
    }

    unpackPrefab(instanceId: string): void {
        this.prefabEdit_.unpackPrefab(instanceId);
    }

    isPrefabInstance(entityId: number): boolean {
        return this.prefabEdit_.isPrefabInstance(entityId);
    }

    isPrefabRoot(entityId: number): boolean {
        return this.prefabEdit_.isPrefabRoot(entityId);
    }

    getPrefabInstanceId(entityId: number): string | undefined {
        return this.prefabEdit_.getPrefabInstanceId(entityId);
    }

    getPrefabPath(entityId: number): string | undefined {
        return this.prefabEdit_.getPrefabPath(entityId);
    }

    async enterPrefabEditMode(prefabPath: string): Promise<boolean> {
        return this.prefabEdit_.enterPrefabEditMode(prefabPath);
    }

    async exitPrefabEditMode(): Promise<void> {
        return this.prefabEdit_.exitPrefabEditMode();
    }

    async savePrefabEditing(): Promise<boolean> {
        return this.prefabEdit_.savePrefabEditing();
    }

    // =========================================================================
    // Undo/Redo
    // =========================================================================

    undo(): void {
        const cmd = this.history_.peekUndo();
        if (!cmd) return;
        if (this.history_.undo()) {
            this.state_.isDirty = true;
            this.applyCommandSideEffects(cmd, true);
            cmd.emitChangeEvents(this, true);
        }
    }

    redo(): void {
        const cmd = this.history_.peekRedo();
        if (!cmd) return;
        if (this.history_.redo()) {
            this.state_.isDirty = true;
            this.applyCommandSideEffects(cmd, false);
            cmd.emitChangeEvents(this, false);
        }
    }

    // =========================================================================
    // Subscription
    // =========================================================================

    notifyChange(): void {
        this.notify('scene');
        this.notify('selection');
        this.notify('hierarchy');
        this.notify('property');
    }

    subscribe(listener: EditorListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    subscribeToPropertyChanges(listener: PropertyChangeListener): () => void {
        this.propertyListeners_.add(listener);
        return () => this.propertyListeners_.delete(listener);
    }

    subscribeToHierarchyChanges(listener: HierarchyChangeListener): () => void {
        this.hierarchyListeners_.add(listener);
        return () => this.hierarchyListeners_.delete(listener);
    }

    subscribeToEntityLifecycle(listener: EntityLifecycleListener): () => void {
        this.entityLifecycleListeners_.add(listener);
        return () => this.entityLifecycleListeners_.delete(listener);
    }

    subscribeToComponentChanges(listener: ComponentChangeListener): () => void {
        this.componentChangeListeners_.add(listener);
        return () => this.componentChangeListeners_.delete(listener);
    }

    subscribeToSceneSync(listener: () => void): () => void {
        this.sceneSyncListeners_.add(listener);
        return () => this.sceneSyncListeners_.delete(listener);
    }

    // =========================================================================
    // Internal (used by services via host interfaces)
    // =========================================================================

    executeCommand(cmd: import('../commands').Command): void {
        this.history_.execute(cmd);
        this.state_.isDirty = true;
        this.applyCommandSideEffects(cmd, false);
        cmd.emitChangeEvents(this, false);
    }

    private applyCommandSideEffects(cmd: Command, isUndo: boolean): void {
        cmd.updateEntityMap(this.entityMap_, isUndo);

        if (cmd.structural) {
            this.rebuildEntityMap();
            this.worldTransforms_.setScene(this.state_.scene);
            this.notifySceneSync();
            this.notify('hierarchy');
        } else {
            this.worldTransforms_.invalidateAll();
            this.notify('scene');
        }
    }

    private notifySceneSync(): void {
        for (const listener of this.sceneSyncListeners_) {
            listener();
        }
    }

    notify(flag: DirtyFlag = 'scene'): void {
        this.dirtyFlags_.add(flag);
        if (this.pendingNotify_) return;
        this.pendingNotify_ = true;
        this.sceneVersion_++;
        requestAnimationFrame(() => {
            this.pendingNotify_ = false;
            const flags = new Set(this.dirtyFlags_);
            this.dirtyFlags_.clear();
            for (const listener of this.listeners_) {
                listener(this.state_, flags);
            }
        });
    }

    notifyPropertyChange(event: PropertyChangeEvent): void {
        for (const listener of this.propertyListeners_) {
            listener(event);
        }
    }

    notifyHierarchyChange(event: HierarchyChangeEvent): void {
        for (const listener of this.hierarchyListeners_) {
            listener(event);
        }
    }

    notifyEntityLifecycle(event: EntityLifecycleEvent): void {
        for (const listener of this.entityLifecycleListeners_) {
            listener(event);
        }
    }

    notifyComponentChange(event: ComponentChangeEvent): void {
        for (const listener of this.componentChangeListeners_) {
            listener(event);
        }
    }

    notifyVisibilityChange(event: VisibilityChangeEvent): void {
        for (const listener of this.visibilityListeners_) {
            listener(event);
        }
    }

    private rebuildEntityMap(): void {
        this.entityMap_.clear();
        for (const entity of this.state_.scene.entities) {
            this.entityMap_.set(entity.id, entity);
        }
    }

    private startAutoSave(): void {
        this.autoSaveTimer_ = setInterval(() => {
            if (this.state_.isDirty) {
                this.saveAutoSave();
            }
        }, EditorStore.AUTOSAVE_INTERVAL);
    }

    private saveAutoSave(): void {
        try {
            const data = JSON.stringify({
                scene: this.state_.scene,
                filePath: this.state_.filePath,
            });
            localStorage.setItem(EditorStore.AUTOSAVE_KEY, data);
        } catch {
            // localStorage full or unavailable
        }
    }

    private clearAutoSave(): void {
        try {
            localStorage.removeItem(EditorStore.AUTOSAVE_KEY);
        } catch {
            // localStorage unavailable
        }
    }

    private saveRecoveryBackup(): void {
        if (!this.state_.isDirty) return;
        this.saveAutoSave();
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let editorStore: EditorStore | null = null;

export function getEditorStore(): EditorStore {
    if (!editorStore) {
        editorStore = new EditorStore();
    }
    return editorStore;
}

export function resetEditorStore(): void {
    editorStore = null;
}
