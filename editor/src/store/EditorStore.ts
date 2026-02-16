/**
 * @file    EditorStore.ts
 * @brief   Editor state management
 */

import type { Entity } from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { createEmptyScene } from '../types/SceneTypes';
import {
    CommandHistory,
    PropertyCommand,
    CompoundCommand,
    CreateEntityCommand,
    DeleteEntityCommand,
    ReparentCommand,
    MoveEntityCommand,
    AddComponentCommand,
    RemoveComponentCommand,
    ReorderComponentCommand,
    RenameEntityCommand,
    ToggleVisibilityCommand,
    InstantiatePrefabCommand,
    InstantiateNestedPrefabCommand,
    UnpackPrefabCommand,
    RevertPrefabInstanceCommand,
    ApplyPrefabOverridesCommand,
} from '../commands';
import {
    entityTreeToPrefab,
    savePrefabToPath,
    loadPrefabFromPath,
    prefabToSceneData,
    sceneDataToPrefab,
    instantiatePrefabRecursive,
    syncPrefabInstances,
    recordPropertyOverride,
    recordNameOverride,
    recordVisibilityOverride,
    recordComponentAddedOverride,
    recordComponentRemovedOverride,
} from '../prefab';
import { getGlobalPathResolver, getAssetDatabase, isUUID } from '../asset';
import { WorldTransformCache } from '../transform/WorldTransformCache';
import type { Transform } from '../math/Transform';
import { isComponentRemovable } from '../schemas/ComponentSchemas';

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
    private state_: EditorState;
    private history_: CommandHistory;
    private listeners_: Set<EditorListener> = new Set();
    private propertyListeners_: Set<PropertyChangeListener> = new Set();
    private hierarchyListeners_: Set<HierarchyChangeListener> = new Set();
    private focusListeners_: Set<(entityId: number) => void> = new Set();
    private visibilityListeners_: Set<VisibilityChangeListener> = new Set();
    private entityLifecycleListeners_: Set<EntityLifecycleListener> = new Set();
    private componentChangeListeners_: Set<ComponentChangeListener> = new Set();
    private sceneSyncListeners_: Set<() => void> = new Set();
    private pendingNotify_ = false;
    private dirtyFlags_: Set<DirtyFlag> = new Set();
    private nextEntityId_ = 1;
    private sceneVersion_ = 0;
    private worldTransforms_ = new WorldTransformCache();
    private entityMap_ = new Map<number, EntityData>();

    private prefabLock_: Promise<void> | null = null;
    private prefabEditingPath_: string | null = null;
    private savedSceneState_: {
        scene: SceneData;
        filePath: string | null;
        isDirty: boolean;
    } | null = null;

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
        const arr = Array.from(this.state_.selectedEntities);
        return arr.length === 1 ? (arr[0] as Entity) : null;
    }

    get selectedAsset(): AssetSelection | null {
        return this.state_.selectedAsset;
    }

    get prefabEditingPath(): string | null {
        return this.prefabEditingPath_;
    }

    get isEditingPrefab(): boolean {
        return this.prefabEditingPath_ !== null;
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
        this.notify('scene');
    }

    // =========================================================================
    // Selection
    // =========================================================================

    selectEntity(entity: Entity | null, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
        const oldSelection = new Set(this.state_.selectedEntities);

        if (entity === null) {
            this.state_.selectedEntities.clear();
        } else {
            const id = entity as number;
            if (mode === 'replace') {
                this.state_.selectedEntities.clear();
                this.state_.selectedEntities.add(id);
            } else if (mode === 'add') {
                this.state_.selectedEntities.add(id);
            } else if (mode === 'toggle') {
                if (this.state_.selectedEntities.has(id)) {
                    this.state_.selectedEntities.delete(id);
                } else {
                    this.state_.selectedEntities.add(id);
                }
            }
        }

        if (!this.setsEqual(oldSelection, this.state_.selectedEntities)) {
            this.state_.selectedAsset = null;
            this.notify('selection');
        }
    }

    selectEntities(entities: number[]): void {
        this.state_.selectedEntities.clear();
        for (const id of entities) {
            this.state_.selectedEntities.add(id);
        }
        this.state_.selectedAsset = null;
        this.notify('selection');
    }

    selectRange(fromEntity: number, toEntity: number): void {
        const flatList: number[] = [];
        const visited = new Set<number>();

        const traverse = (entityId: number | null) => {
            if (entityId === null) return;
            const entity = this.entityMap_.get(entityId);
            if (!entity || visited.has(entityId)) return;
            visited.add(entityId);
            flatList.push(entityId);
            for (const childId of entity.children) {
                traverse(childId);
            }
        };

        for (const entity of this.state_.scene.entities) {
            if (entity.parent === null) {
                traverse(entity.id);
            }
        }

        const fromIndex = flatList.indexOf(fromEntity);
        const toIndex = flatList.indexOf(toEntity);

        if (fromIndex === -1 || toIndex === -1) return;

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        const range = flatList.slice(start, end + 1);

        this.selectEntities(range);
    }

    private setsEqual(a: Set<number>, b: Set<number>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }

    selectAsset(asset: AssetSelection | null): void {
        this.state_.selectedAsset = asset;
        this.state_.selectedEntities.clear();
        this.notify('selection');
    }

    getSelectedEntityData(): EntityData | null {
        const arr = Array.from(this.state_.selectedEntities);
        if (arr.length !== 1) return null;
        return this.entityMap_.get(arr[0]) ?? null;
    }

    getSelectedEntitiesData(): EntityData[] {
        const result: EntityData[] = [];
        for (const id of this.state_.selectedEntities) {
            const entity = this.entityMap_.get(id);
            if (entity) {
                result.push(entity);
            }
        }
        return result;
    }

    getEntityData(entityId: number): EntityData | null {
        return this.entityMap_.get(entityId) ?? null;
    }

    focusEntity(entityId: number): void {
        for (const listener of this.focusListeners_) {
            listener(entityId);
        }
    }

    onFocusEntity(listener: (entityId: number) => void): () => void {
        this.focusListeners_.add(listener);
        return () => this.focusListeners_.delete(listener);
    }

    // =========================================================================
    // Visibility
    // =========================================================================

    toggleVisibility(entityId: number): void {
        const entityData = this.entityMap_.get(entityId);
        if (!entityData) return;

        const cmd = new ToggleVisibilityCommand(
            this.state_.scene,
            this.entityMap_,
            entityId,
            (id, visible) => this.notifyVisibilityChange({ entity: id, visible })
        );
        this.executeCommand(cmd);

        if (entityData.prefab) {
            recordVisibilityOverride(this.state_.scene, entityId, entityData.visible);
        }
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

    private notifyVisibilityChange(event: VisibilityChangeEvent): void {
        for (const listener of this.visibilityListeners_) {
            listener(event);
        }
    }

    // =========================================================================
    // Entity Operations
    // =========================================================================

    createEntity(name?: string, parent: Entity | null = null): Entity {
        const id = this.nextEntityId_++;
        const entityName = name ?? `Entity_${id}`;

        const cmd = new CreateEntityCommand(
            this.state_.scene,
            this.entityMap_,
            id,
            entityName,
            parent
        );
        this.executeCommand(cmd);

        this.notifyEntityLifecycle({ entity: id, type: 'created', parent: parent as number | null });

        if (parent !== null) {
            const parentData = this.entityMap_.get(parent as number);
            if (parentData && !parentData.visible) {
                const newEntityData = this.entityMap_.get(id);
                if (newEntityData) {
                    newEntityData.visible = false;
                    this.notifyVisibilityChange({ entity: id, visible: false });
                }
            }
        }

        this.selectEntity(id as Entity);

        return id as Entity;
    }

    deleteEntity(entity: Entity): void {
        const descendants = this.collectDescendantIds(entity as number);
        const cmd = new DeleteEntityCommand(this.state_.scene, this.entityMap_, entity);
        this.executeCommand(cmd);

        const hadSelection = this.state_.selectedEntities.size > 0;
        this.state_.selectedEntities.delete(entity as number);
        for (const id of descendants) {
            this.state_.selectedEntities.delete(id);
        }
        if (hadSelection) {
            this.notify('selection');
        }

        for (const id of descendants) {
            this.notifyEntityLifecycle({ entity: id, type: 'deleted', parent: null });
        }
        this.notifyEntityLifecycle({ entity: entity as number, type: 'deleted', parent: null });
    }

    deleteSelectedEntities(): void {
        const toDelete = Array.from(this.state_.selectedEntities);
        const commands = toDelete.map(id => new DeleteEntityCommand(this.state_.scene, this.entityMap_, id as Entity));
        const compound = new CompoundCommand(commands, 'Delete entities');
        this.executeCommand(compound);

        this.state_.selectedEntities.clear();

        for (const id of toDelete) {
            const descendants = this.collectDescendantIds(id);
            for (const descId of descendants) {
                this.notifyEntityLifecycle({ entity: descId, type: 'deleted', parent: null });
            }
            this.notifyEntityLifecycle({ entity: id, type: 'deleted', parent: null });
        }
    }

    reparentEntity(entity: Entity, newParent: Entity | null): void {
        const cmd = new ReparentCommand(this.state_.scene, this.entityMap_, entity, newParent);
        this.executeCommand(cmd);
        this.notifyHierarchyChange({
            entity: entity as number,
            newParent: newParent as number | null,
        });
    }

    moveEntity(entity: Entity, newParent: Entity | null, index: number): void {
        const cmd = new MoveEntityCommand(this.state_.scene, this.entityMap_, entity, newParent, index);
        this.executeCommand(cmd);
        this.notifyHierarchyChange({
            entity: entity as number,
            newParent: newParent as number | null,
        });
    }

    renameEntity(entity: Entity, name: string): void {
        const entityData = this.entityMap_.get(entity as number);
        if (!entityData) return;

        const oldName = entityData.name;
        const cmd = new RenameEntityCommand(
            this.state_.scene,
            this.entityMap_,
            entity,
            oldName,
            name
        );
        this.executeCommand(cmd);

        if (entityData.prefab) {
            recordNameOverride(this.state_.scene, entity as number, name);
        }
    }

    // =========================================================================
    // Component Operations
    // =========================================================================

    addComponent(entity: Entity, type: string, data: Record<string, unknown>): void {
        const cmd = new AddComponentCommand(this.state_.scene, this.entityMap_, entity, type, data);
        this.executeCommand(cmd);

        if (this.isPrefabInstance(entity as number)) {
            recordComponentAddedOverride(this.state_.scene, entity as number, type, data);
        }

        this.notifyComponentChange({ entity: entity as number, componentType: type, action: 'added' });
    }

    removeComponent(entity: Entity, type: string): void {
        if (!isComponentRemovable(type)) return;

        if (this.isPrefabInstance(entity as number)) {
            recordComponentRemovedOverride(this.state_.scene, entity as number, type);
        }

        const cmd = new RemoveComponentCommand(this.state_.scene, this.entityMap_, entity, type);
        this.executeCommand(cmd);
        this.notifyComponentChange({ entity: entity as number, componentType: type, action: 'removed' });
    }

    reorderComponent(entity: Entity, fromIndex: number, toIndex: number): void {
        const cmd = new ReorderComponentCommand(
            this.state_.scene, this.entityMap_, entity as number, fromIndex, toIndex
        );
        this.executeCommand(cmd);
        this.notify('selection');
    }

    updateProperty(
        entity: Entity,
        componentType: string,
        propertyName: string,
        oldValue: unknown,
        newValue: unknown
    ): void {
        const cmd = new PropertyCommand(
            this.state_.scene,
            this.entityMap_,
            entity,
            componentType,
            propertyName,
            oldValue,
            newValue
        );
        this.executeCommand(cmd);

        if (this.isPrefabInstance(entity as number)) {
            recordPropertyOverride(
                this.state_.scene,
                entity as number,
                componentType,
                propertyName,
                newValue
            );
        }

        this.notifyPropertyChange({
            entity: entity as number,
            componentType,
            propertyName,
            oldValue,
            newValue,
        });
    }

    updateProperties(
        entity: Entity,
        componentType: string,
        changes: { property: string; oldValue: unknown; newValue: unknown }[]
    ): void {
        const commands = changes.map(c => new PropertyCommand(
            this.state_.scene,
            this.entityMap_,
            entity,
            componentType,
            c.property,
            c.oldValue,
            c.newValue
        ));
        const compound = new CompoundCommand(commands, `Change ${componentType} properties`);
        this.executeCommand(compound);
        for (const c of changes) {
            this.notifyPropertyChange({
                entity: entity as number,
                componentType,
                propertyName: c.property,
                oldValue: c.oldValue,
                newValue: c.newValue,
            });
        }
    }

    getComponent(entity: Entity, type: string): ComponentData | null {
        const entityData = this.entityMap_.get(entity as number);
        if (!entityData) return null;
        return entityData.components.find(c => c.type === type) ?? null;
    }

    updatePropertyDirect(
        entity: Entity,
        componentType: string,
        propertyName: string,
        newValue: unknown
    ): void {
        const entityData = this.entityMap_.get(entity as number);
        if (!entityData) return;

        const component = entityData.components.find(c => c.type === componentType);
        if (!component) return;

        const oldValue = component.data[propertyName];
        component.data[propertyName] = newValue;
        this.state_.isDirty = true;

        if (componentType === 'LocalTransform') {
            this.worldTransforms_.updateEntity(entityData);
            this.worldTransforms_.markDirty(entity as number);
        }

        this.notifyPropertyChange({
            entity: entity as number,
            componentType,
            propertyName,
            oldValue,
            newValue,
        });
    }

    // =========================================================================
    // World Transform
    // =========================================================================

    /**
     * @brief Get cached world transform for an entity
     */
    getWorldTransform(entityId: number): Transform {
        return this.worldTransforms_.getWorldTransform(entityId);
    }

    /**
     * @brief Invalidate all cached transforms (force recalculation)
     */
    invalidateAllTransforms(): void {
        this.worldTransforms_.invalidateAll();
    }

    // =========================================================================
    // Prefab Operations
    // =========================================================================

    async instantiatePrefab(
        prefabPath: string,
        parentEntity: Entity | null = null
    ): Promise<Entity | null> {
        if (this.prefabLock_) {
            await this.prefabLock_;
        }

        let resolve: () => void;
        this.prefabLock_ = new Promise<void>(r => { resolve = r; });

        try {
            return await this.instantiatePrefabInner(prefabPath, parentEntity);
        } finally {
            this.prefabLock_ = null;
            resolve!();
        }
    }

    private async instantiatePrefabInner(
        prefabPath: string,
        parentEntity: Entity | null
    ): Promise<Entity | null> {
        const hasNested = await this.prefabHasNested(prefabPath);

        if (hasNested) {
            return this.instantiatePrefabNested(prefabPath, parentEntity);
        }

        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return null;

        const cmd = new InstantiatePrefabCommand(
            this.state_.scene,
            this.entityMap_,
            prefab,
            prefabPath,
            parentEntity as number | null,
            this.nextEntityId_
        );
        this.executeCommand(cmd);

        const createdIds = cmd.createdEntityIds;
        this.nextEntityId_ = Math.max(this.nextEntityId_, ...createdIds.map(id => id + 1));

        for (const id of createdIds) {
            this.notifyEntityLifecycle({ entity: id, type: 'created', parent: null });
        }

        const rootId = cmd.rootEntityId;
        if (rootId !== -1) {
            this.selectEntity(rootId as Entity);
        }

        return rootId as Entity;
    }

    private async instantiatePrefabNested(
        prefabPath: string,
        parentEntity: Entity | null
    ): Promise<Entity | null> {
        const result = await instantiatePrefabRecursive(
            prefabPath,
            this.state_.scene,
            parentEntity as number | null,
            this.nextEntityId_
        );
        if (!result) return null;

        const cmd = new InstantiateNestedPrefabCommand(
            this.state_.scene,
            this.entityMap_,
            result.createdEntities,
            result.rootEntityId,
            parentEntity as number | null
        );
        this.executeCommand(cmd);

        this.nextEntityId_ = Math.max(
            this.nextEntityId_,
            ...result.createdEntities.map(e => e.id + 1)
        );

        for (const entity of result.createdEntities) {
            this.notifyEntityLifecycle({ entity: entity.id, type: 'created', parent: entity.parent });
        }

        this.selectEntity(result.rootEntityId as Entity);

        return result.rootEntityId as Entity;
    }

    private async prefabHasNested(prefabPath: string): Promise<boolean> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return false;
        return prefab.entities.some(e => e.nestedPrefab !== undefined);
    }

    async saveAsPrefab(entityId: number, filePath: string): Promise<boolean> {
        const entityData = this.entityMap_.get(entityId);
        if (!entityData) return false;

        const name = filePath.split('/').pop()?.replace('.esprefab', '') ?? entityData.name;
        const entities = this.collectEntityTree(entityId);
        const { prefab, idMapping } = entityTreeToPrefab(name, entityId, entities);

        const saved = await savePrefabToPath(prefab, filePath);
        if (!saved) return false;

        const relativePath = getGlobalPathResolver().toRelativePath(filePath);
        const uuid = await getAssetDatabase().ensureMeta(relativePath);
        const instanceId = `prefab_${Date.now()}_${entityId}`;

        for (const [sceneId, prefabEntityId] of idMapping) {
            const entity = this.entityMap_.get(sceneId);
            if (!entity) continue;

            entity.prefab = {
                prefabPath: uuid,
                prefabEntityId,
                isRoot: sceneId === entityId,
                instanceId,
                overrides: [],
            };
        }

        this.state_.isDirty = true;
        this.notify('scene');
        return true;
    }

    async revertPrefabInstance(instanceId: string, prefabPath: string): Promise<void> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return;

        const cmd = new RevertPrefabInstanceCommand(
            this.state_.scene,
            instanceId,
            prefab,
            prefabPath
        );
        this.executeCommand(cmd);

    }

    async applyPrefabOverrides(instanceId: string, prefabPath: string): Promise<void> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return;

        const cmd = new ApplyPrefabOverridesCommand(
            this.state_.scene,
            instanceId,
            prefab,
            prefabPath,
            async (p, path) => { await savePrefabToPath(p, path); }
        );
        this.executeCommand(cmd);

    }

    unpackPrefab(instanceId: string): void {
        const cmd = new UnpackPrefabCommand(this.state_.scene, instanceId);
        this.executeCommand(cmd);

    }

    isPrefabInstance(entityId: number): boolean {
        const entity = this.entityMap_.get(entityId);
        return entity?.prefab !== undefined;
    }

    isPrefabRoot(entityId: number): boolean {
        const entity = this.entityMap_.get(entityId);
        return entity?.prefab?.isRoot === true;
    }

    getPrefabInstanceId(entityId: number): string | undefined {
        return this.entityMap_.get(entityId)?.prefab?.instanceId;
    }

    getPrefabPath(entityId: number): string | undefined {
        return this.entityMap_.get(entityId)?.prefab?.prefabPath;
    }

    async enterPrefabEditMode(prefabPath: string): Promise<boolean> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return false;

        this.savedSceneState_ = {
            scene: JSON.parse(JSON.stringify(this.state_.scene)),
            filePath: this.state_.filePath,
            isDirty: this.state_.isDirty,
        };

        if (!isUUID(prefabPath)) {
            const uuid = getAssetDatabase().getUuid(prefabPath);
            if (uuid) prefabPath = uuid;
        }
        this.prefabEditingPath_ = prefabPath;
        const scene = prefabToSceneData(prefab);
        this.loadScene(scene, null);

        return true;
    }

    async exitPrefabEditMode(): Promise<void> {
        if (!this.savedSceneState_) return;

        let saveFailed = false;
        if (this.state_.isDirty) {
            try {
                await this.savePrefabEditing();
            } catch (e) {
                console.error('Failed to save prefab:', e);
                saveFailed = true;
            }
        }

        const saved = this.savedSceneState_;
        const editedPrefabPath = this.prefabEditingPath_!;
        this.prefabEditingPath_ = null;
        this.savedSceneState_ = null;

        const synced = await syncPrefabInstances(saved.scene, editedPrefabPath);
        this.loadScene(saved.scene, saved.filePath);
        this.state_.isDirty = saved.isDirty || synced || saveFailed;
        this.notify('scene');
    }

    async savePrefabEditing(): Promise<boolean> {
        if (!this.prefabEditingPath_) return false;

        const prefab = sceneDataToPrefab(this.state_.scene);
        const saved = await savePrefabToPath(prefab, this.prefabEditingPath_);
        if (saved) {
            this.state_.isDirty = false;
            this.notify('scene');
        }
        return saved;
    }

    private collectEntityTree(rootId: number): import('../types/SceneTypes').EntityData[] {
        const result: import('../types/SceneTypes').EntityData[] = [];
        const entity = this.entityMap_.get(rootId);
        if (!entity) return result;

        result.push(entity);
        for (const childId of entity.children) {
            result.push(...this.collectEntityTree(childId));
        }
        return result;
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
        }
    }

    redo(): void {
        const cmd = this.history_.peekRedo();
        if (!cmd) return;
        if (this.history_.redo()) {
            this.state_.isDirty = true;
            this.applyCommandSideEffects(cmd, false);
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
    // Private
    // =========================================================================

    private executeCommand(cmd: import('../commands').Command): void {
        this.history_.execute(cmd);
        this.state_.isDirty = true;
        this.applyCommandSideEffects(cmd, false);
    }

    private applyCommandSideEffects(cmd: import('../commands').Command, isUndo: boolean): void {
        cmd.updateEntityMap(this.entityMap_, isUndo);

        if (cmd.structural) {
            this.rebuildEntityMap();
            this.worldTransforms_.setScene(this.state_.scene);
        } else {
            this.worldTransforms_.invalidateAll();
        }

        this.syncDerivedProperties();
        this.notifySceneSync();
        this.notify(cmd.structural ? 'hierarchy' : 'scene');
    }

    private notifySceneSync(): void {
        for (const listener of this.sceneSyncListeners_) {
            listener();
        }
    }

    private notify(flag: DirtyFlag = 'scene'): void {
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

    private notifyPropertyChange(event: PropertyChangeEvent): void {
        if (event.componentType === 'TextInput' && event.propertyName === 'backgroundColor') {
            const entityData = this.entityMap_.get(event.entity);
            const spriteComp = entityData?.components.find(c => c.type === 'Sprite');
            if (spriteComp) {
                spriteComp.data.color = event.newValue;
            }
        }

        if (event.componentType === 'UIRect' && event.propertyName === 'size') {
            const entityData = this.entityMap_.get(event.entity);
            const spriteComp = entityData?.components.find(c => c.type === 'Sprite');
            if (spriteComp) {
                spriteComp.data.size = event.newValue;
            }
        }

        for (const listener of this.propertyListeners_) {
            listener(event);
        }
    }

    private syncDerivedProperties(): void {
        for (const entityData of this.entityMap_.values()) {
            const uiRect = entityData.components.find(c => c.type === 'UIRect');
            const sprite = entityData.components.find(c => c.type === 'Sprite');
            if (uiRect && sprite) {
                sprite.data.size = uiRect.data.size;
            }
            const textInput = entityData.components.find(c => c.type === 'TextInput');
            if (textInput && sprite) {
                sprite.data.color = textInput.data.backgroundColor;
            }
        }
    }

    private notifyHierarchyChange(event: HierarchyChangeEvent): void {
        for (const listener of this.hierarchyListeners_) {
            listener(event);
        }
    }

    private notifyEntityLifecycle(event: EntityLifecycleEvent): void {
        for (const listener of this.entityLifecycleListeners_) {
            listener(event);
        }
    }

    private notifyComponentChange(event: ComponentChangeEvent): void {
        for (const listener of this.componentChangeListeners_) {
            listener(event);
        }
    }

    private collectDescendantIds(entityId: number): number[] {
        const result: number[] = [];
        const entityData = this.entityMap_.get(entityId);
        if (!entityData) return result;
        for (const childId of entityData.children) {
            result.push(...this.collectDescendantIds(childId));
            result.push(childId);
        }
        return result;
    }

    private rebuildEntityMap(): void {
        this.entityMap_.clear();
        for (const entity of this.state_.scene.entities) {
            this.entityMap_.set(entity.id, entity);
        }
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
