import type { Entity } from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import {
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
} from '../commands';
import {
    recordPropertyOverride,
    recordNameOverride,
    recordVisibilityOverride,
    recordComponentAddedOverride,
    recordComponentRemovedOverride,
} from '../prefab';
import { isComponentRemovable } from '../schemas/ComponentSchemas';
import type {
    DirtyFlag,
    PropertyChangeEvent,
    VisibilityChangeEvent,
} from './EditorStore';

export interface SceneOperationsHost {
    readonly state_: {
        scene: SceneData;
        selectedEntities: Set<number>;
        isDirty: boolean;
    };
    readonly entityMap_: Map<number, EntityData>;
    nextEntityId_: number;
    executeCommand(cmd: import('../commands').Command): void;
    notify(flag: DirtyFlag): void;
    notifyPropertyChange(event: PropertyChangeEvent): void;
    notifyVisibilityChange(event: VisibilityChangeEvent): void;
    selectEntity(entity: Entity | null): void;
    worldTransforms_: {
        updateEntity(entity: EntityData): void;
        markDirty(entityId: number): void;
    };
}

export class SceneOperations {
    private host_: SceneOperationsHost;

    constructor(host: SceneOperationsHost) {
        this.host_ = host;
    }

    createEntity(name?: string, parent: Entity | null = null): Entity {
        const id = this.host_.nextEntityId_++;
        const entityName = name ?? `Entity_${id}`;

        const cmd = new CreateEntityCommand(
            this.host_.state_.scene,
            this.host_.entityMap_,
            id,
            entityName,
            parent
        );
        this.host_.executeCommand(cmd);

        if (parent !== null) {
            const parentData = this.host_.entityMap_.get(parent as number);
            if (parentData && !parentData.visible) {
                const newEntityData = this.host_.entityMap_.get(id);
                if (newEntityData) {
                    newEntityData.visible = false;
                    this.host_.notifyVisibilityChange({ entity: id, visible: false });
                }
            }
        }

        this.host_.selectEntity(id as Entity);

        return id as Entity;
    }

    deleteEntity(entity: Entity): void {
        const descendants = this.collectDescendantIds(entity as number);
        const cmd = new DeleteEntityCommand(this.host_.state_.scene, this.host_.entityMap_, entity);
        this.host_.executeCommand(cmd);

        const hadSelection = this.host_.state_.selectedEntities.size > 0;
        this.host_.state_.selectedEntities.delete(entity as number);
        for (const id of descendants) {
            this.host_.state_.selectedEntities.delete(id);
        }
        if (hadSelection) {
            this.host_.notify('selection');
        }
    }

    deleteSelectedEntities(): void {
        const toDelete = Array.from(this.host_.state_.selectedEntities);

        const commands = toDelete.map(id =>
            new DeleteEntityCommand(this.host_.state_.scene, this.host_.entityMap_, id as Entity)
        );
        const compound = new CompoundCommand(commands, 'Delete entities');
        this.host_.executeCommand(compound);

        this.host_.state_.selectedEntities.clear();
    }

    reparentEntity(entity: Entity, newParent: Entity | null): void {
        const cmd = new ReparentCommand(this.host_.state_.scene, this.host_.entityMap_, entity, newParent);
        this.host_.executeCommand(cmd);
    }

    moveEntity(entity: Entity, newParent: Entity | null, index: number): void {
        const cmd = new MoveEntityCommand(this.host_.state_.scene, this.host_.entityMap_, entity, newParent, index);
        this.host_.executeCommand(cmd);
    }

    renameEntity(entity: Entity, name: string): void {
        const entityData = this.host_.entityMap_.get(entity as number);
        if (!entityData) return;

        const oldName = entityData.name;
        const cmd = new RenameEntityCommand(
            this.host_.state_.scene,
            this.host_.entityMap_,
            entity,
            oldName,
            name
        );
        this.host_.executeCommand(cmd);

        if (entityData.prefab) {
            recordNameOverride(this.host_.state_.scene, entity as number, name);
        }
    }

    toggleVisibility(entityId: number): void {
        const entityData = this.host_.entityMap_.get(entityId);
        if (!entityData) return;

        const cmd = new ToggleVisibilityCommand(
            this.host_.state_.scene,
            this.host_.entityMap_,
            entityId
        );
        this.host_.executeCommand(cmd);

        if (entityData.prefab) {
            recordVisibilityOverride(this.host_.state_.scene, entityId, entityData.visible);
        }
    }

    addComponent(entity: Entity, type: string, data: Record<string, unknown>): void {
        const cmd = new AddComponentCommand(this.host_.state_.scene, this.host_.entityMap_, entity, type, data);
        this.host_.executeCommand(cmd);

        if (this.isPrefabInstance(entity as number)) {
            recordComponentAddedOverride(this.host_.state_.scene, entity as number, type, data);
        }
    }

    removeComponent(entity: Entity, type: string): void {
        if (!isComponentRemovable(type)) return;

        if (this.isPrefabInstance(entity as number)) {
            recordComponentRemovedOverride(this.host_.state_.scene, entity as number, type);
        }

        const cmd = new RemoveComponentCommand(this.host_.state_.scene, this.host_.entityMap_, entity, type);
        this.host_.executeCommand(cmd);
    }

    reorderComponent(entity: Entity, fromIndex: number, toIndex: number): void {
        const cmd = new ReorderComponentCommand(
            this.host_.state_.scene, this.host_.entityMap_, entity as number, fromIndex, toIndex
        );
        this.host_.executeCommand(cmd);
        this.host_.notify('selection');
    }

    updateProperty(
        entity: Entity,
        componentType: string,
        propertyName: string,
        oldValue: unknown,
        newValue: unknown
    ): void {
        const cmd = new PropertyCommand(
            this.host_.state_.scene,
            this.host_.entityMap_,
            entity,
            componentType,
            propertyName,
            oldValue,
            newValue
        );
        this.host_.executeCommand(cmd);

        if (this.isPrefabInstance(entity as number)) {
            recordPropertyOverride(
                this.host_.state_.scene,
                entity as number,
                componentType,
                propertyName,
                newValue
            );
        }
    }

    updateProperties(
        entity: Entity,
        componentType: string,
        changes: { property: string; oldValue: unknown; newValue: unknown }[]
    ): void {
        const commands = changes.map(c => new PropertyCommand(
            this.host_.state_.scene,
            this.host_.entityMap_,
            entity,
            componentType,
            c.property,
            c.oldValue,
            c.newValue
        ));
        const compound = new CompoundCommand(commands, `Change ${componentType} properties`);
        this.host_.executeCommand(compound);
    }

    getComponent(entity: Entity, type: string): ComponentData | null {
        const entityData = this.host_.entityMap_.get(entity as number);
        if (!entityData) return null;
        return entityData.components.find(c => c.type === type) ?? null;
    }

    updatePropertyDirect(
        entity: Entity,
        componentType: string,
        propertyName: string,
        newValue: unknown
    ): void {
        const entityData = this.host_.entityMap_.get(entity as number);
        if (!entityData) return;

        const component = entityData.components.find(c => c.type === componentType);
        if (!component) return;

        const oldValue = component.data[propertyName];
        component.data[propertyName] = newValue;
        this.host_.state_.isDirty = true;

        if (componentType === 'LocalTransform') {
            this.host_.worldTransforms_.updateEntity(entityData);
            this.host_.worldTransforms_.markDirty(entity as number);
        }

        this.host_.notifyPropertyChange({
            entity: entity as number,
            componentType,
            propertyName,
            oldValue,
            newValue,
        });
        this.host_.notify('property');
    }

    isPrefabInstance(entityId: number): boolean {
        const entity = this.host_.entityMap_.get(entityId);
        return entity?.prefab !== undefined;
    }

    collectDescendantIds(entityId: number): number[] {
        const result: number[] = [];
        const entityData = this.host_.entityMap_.get(entityId);
        if (!entityData) return result;
        for (const childId of entityData.children) {
            result.push(...this.collectDescendantIds(childId));
            result.push(childId);
        }
        return result;
    }
}
