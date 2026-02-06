/**
 * @file    EditorStore.ts
 * @brief   Editor state management
 */

import type { Entity } from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { createEmptyScene, createEntityData } from '../types/SceneTypes';
import {
    CommandHistory,
    PropertyCommand,
    CreateEntityCommand,
    DeleteEntityCommand,
    ReparentCommand,
    AddComponentCommand,
    RemoveComponentCommand,
} from '../commands';
import { WorldTransformCache } from '../transform/WorldTransformCache';
import type { Transform } from '../math/Transform';

// =============================================================================
// Types
// =============================================================================

export type AssetType = 'image' | 'script' | 'scene' | 'audio' | 'json' | 'file' | 'folder';

export interface AssetSelection {
    path: string;
    type: AssetType;
    name: string;
}

export interface EditorState {
    scene: SceneData;
    selectedEntity: Entity | null;
    selectedAsset: AssetSelection | null;
    isDirty: boolean;
    filePath: string | null;
}

export type EditorListener = (state: EditorState) => void;

// =============================================================================
// EditorStore
// =============================================================================

export class EditorStore {
    private state_: EditorState;
    private history_: CommandHistory;
    private listeners_: Set<EditorListener> = new Set();
    private nextEntityId_ = 1;
    private worldTransforms_ = new WorldTransformCache();
    private entityMap_ = new Map<number, EntityData>();

    constructor() {
        this.state_ = {
            scene: createEmptyScene(),
            selectedEntity: null,
            selectedAsset: null,
            isDirty: false,
            filePath: null,
        };
        this.history_ = new CommandHistory();
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

    get selectedEntity(): Entity | null {
        return this.state_.selectedEntity;
    }

    get selectedAsset(): AssetSelection | null {
        return this.state_.selectedAsset;
    }

    get canUndo(): boolean {
        return this.history_.canUndo();
    }

    get canRedo(): boolean {
        return this.history_.canRedo();
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

    newScene(name: string = 'Untitled'): void {
        this.state_.scene = createEmptyScene(name);
        this.state_.selectedEntity = null;
        this.state_.selectedAsset = null;
        this.state_.isDirty = false;
        this.state_.filePath = null;
        this.history_.clear();
        this.nextEntityId_ = 1;
        this.rebuildEntityMap();
        this.worldTransforms_.setScene(this.state_.scene);
        this.notify();
    }

    loadScene(scene: SceneData, filePath: string | null = null): void {
        this.state_.scene = scene;
        this.state_.selectedEntity = null;
        this.state_.selectedAsset = null;
        this.state_.isDirty = false;
        this.state_.filePath = filePath;
        this.history_.clear();

        const maxId = scene.entities.reduce((max, e) => Math.max(max, e.id), 0);
        this.nextEntityId_ = maxId + 1;

        this.rebuildEntityMap();
        this.worldTransforms_.setScene(scene);
        this.notify();
    }

    markSaved(filePath: string | null = null): void {
        this.state_.isDirty = false;
        if (filePath) {
            this.state_.filePath = filePath;
        }
        this.notify();
    }

    // =========================================================================
    // Selection
    // =========================================================================

    selectEntity(entity: Entity | null): void {
        if (this.state_.selectedEntity !== entity) {
            this.state_.selectedEntity = entity;
            this.state_.selectedAsset = null;
            this.notify();
        }
    }

    selectAsset(asset: AssetSelection | null): void {
        this.state_.selectedAsset = asset;
        this.state_.selectedEntity = null;
        this.notify();
    }

    getSelectedEntityData(): EntityData | null {
        if (this.state_.selectedEntity === null) return null;
        return this.entityMap_.get(this.state_.selectedEntity as number) ?? null;
    }

    getEntityData(entityId: number): EntityData | null {
        return this.entityMap_.get(entityId) ?? null;
    }

    // =========================================================================
    // Entity Operations
    // =========================================================================

    createEntity(name?: string, parent: Entity | null = null): Entity {
        const id = this.nextEntityId_++;
        const entityName = name ?? `Entity_${id}`;

        const cmd = new CreateEntityCommand(
            this.state_.scene,
            id,
            entityName,
            parent
        );
        this.executeCommand(cmd);

        return id as Entity;
    }

    deleteEntity(entity: Entity): void {
        const cmd = new DeleteEntityCommand(this.state_.scene, entity);
        this.executeCommand(cmd);

        if (this.state_.selectedEntity === entity) {
            this.state_.selectedEntity = null;
        }
    }

    reparentEntity(entity: Entity, newParent: Entity | null): void {
        const cmd = new ReparentCommand(this.state_.scene, entity, newParent);
        this.executeCommand(cmd);
    }

    renameEntity(entity: Entity, name: string): void {
        const entityData = this.entityMap_.get(entity as number);
        if (entityData) {
            entityData.name = name;
            this.state_.isDirty = true;
            this.notify();
        }
    }

    // =========================================================================
    // Component Operations
    // =========================================================================

    addComponent(entity: Entity, type: string, data: Record<string, unknown>): void {
        const cmd = new AddComponentCommand(this.state_.scene, entity, type, data);
        this.executeCommand(cmd);
    }

    removeComponent(entity: Entity, type: string): void {
        const cmd = new RemoveComponentCommand(this.state_.scene, entity, type);
        this.executeCommand(cmd);
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
            entity,
            componentType,
            propertyName,
            oldValue,
            newValue
        );
        this.executeCommand(cmd);
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

        component.data[propertyName] = newValue;
        this.state_.isDirty = true;

        if (componentType === 'LocalTransform') {
            this.worldTransforms_.updateEntity(entityData);
            this.worldTransforms_.markDirty(entity as number);
        }

        this.notify();
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
    // Undo/Redo
    // =========================================================================

    undo(): void {
        if (this.history_.undo()) {
            this.state_.isDirty = true;
            this.rebuildEntityMap();
            this.worldTransforms_.invalidateAll();
            this.notify();
        }
    }

    redo(): void {
        if (this.history_.redo()) {
            this.state_.isDirty = true;
            this.rebuildEntityMap();
            this.worldTransforms_.invalidateAll();
            this.notify();
        }
    }

    // =========================================================================
    // Subscription
    // =========================================================================

    subscribe(listener: EditorListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    // =========================================================================
    // Private
    // =========================================================================

    private executeCommand(cmd: import('../commands').Command): void {
        this.history_.execute(cmd);
        this.state_.isDirty = true;
        this.rebuildEntityMap();
        this.worldTransforms_.invalidateAll();
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners_) {
            listener(this.state_);
        }
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
