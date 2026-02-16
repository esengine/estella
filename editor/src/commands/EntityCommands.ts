/**
 * @file    EntityCommands.ts
 * @brief   Commands for entity operations (create, delete, reparent)
 */

import type { SceneData, EntityData } from '../types/SceneTypes';
import { createEntityData } from '../types/SceneTypes';
import { BaseCommand } from './Command';

// =============================================================================
// CreateEntityCommand
// =============================================================================

export class CreateEntityCommand extends BaseCommand {
    readonly type = 'create_entity';
    readonly structural = true;
    readonly description: string;
    private entityData_: EntityData;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private name_: string,
        private parent_: number | null = null
    ) {
        super();
        this.description = `Create entity "${name_}"`;
        this.entityData_ = createEntityData(entityId_, name_, parent_);
    }

    execute(): void {
        this.scene_.entities.push(this.entityData_);

        if (this.parent_ !== null) {
            const parentData = this.entityMap_.get(this.parent_);
            if (parentData && !parentData.children.includes(this.entityId_)) {
                parentData.children.push(this.entityId_);
            }
        }
    }

    undo(): void {
        const idx = this.scene_.entities.findIndex(e => e.id === this.entityId_);
        if (idx !== -1) {
            this.scene_.entities.splice(idx, 1);
        }

        if (this.parent_ !== null) {
            const parentData = this.entityMap_.get(this.parent_);
            if (parentData) {
                const childIdx = parentData.children.indexOf(this.entityId_);
                if (childIdx !== -1) {
                    parentData.children.splice(childIdx, 1);
                }
            }
        }
    }

    updateEntityMap(map: Map<number, EntityData>, isUndo: boolean): void {
        if (isUndo) {
            map.delete(this.entityId_);
        } else {
            map.set(this.entityId_, this.entityData_);
        }
    }

    get entityId(): number {
        return this.entityId_;
    }
}

// =============================================================================
// DeleteEntityCommand
// =============================================================================

export class DeleteEntityCommand extends BaseCommand {
    readonly type = 'delete_entity';
    readonly structural = true;
    readonly description: string;
    private deletedData_: EntityData | null = null;
    private deletedChildren_: EntityData[] = [];

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number
    ) {
        super();
        const entity = entityMap_.get(entityId_);
        this.description = `Delete entity "${entity?.name ?? entityId_}"`;
    }

    execute(): void {
        this.deletedData_ = this.entityMap_.get(this.entityId_) ?? null;
        if (!this.deletedData_) return;

        this.deletedChildren_ = this.collectDescendants(this.entityId_);

        if (this.deletedData_.parent !== null) {
            const parentData = this.entityMap_.get(this.deletedData_.parent);
            if (parentData) {
                const idx = parentData.children.indexOf(this.entityId_);
                if (idx !== -1) {
                    parentData.children.splice(idx, 1);
                }
            }
        }

        const idsToRemove = new Set([this.entityId_, ...this.deletedChildren_.map(e => e.id)]);
        this.scene_.entities = this.scene_.entities.filter(e => !idsToRemove.has(e.id));
    }

    undo(): void {
        if (!this.deletedData_) return;

        this.scene_.entities.push(this.deletedData_);
        this.scene_.entities.push(...this.deletedChildren_);

        if (this.deletedData_.parent !== null) {
            const parentData = this.entityMap_.get(this.deletedData_.parent);
            if (parentData && !parentData.children.includes(this.entityId_)) {
                parentData.children.push(this.entityId_);
            }
        }
    }

    updateEntityMap(map: Map<number, EntityData>, isUndo: boolean): void {
        if (isUndo) {
            if (this.deletedData_) {
                map.set(this.entityId_, this.deletedData_);
            }
            for (const child of this.deletedChildren_) {
                map.set(child.id, child);
            }
        } else {
            map.delete(this.entityId_);
            for (const child of this.deletedChildren_) {
                map.delete(child.id);
            }
        }
    }

    private collectDescendants(entityId: number): EntityData[] {
        const result: EntityData[] = [];
        const entity = this.entityMap_.get(entityId);
        if (!entity) return result;

        for (const childId of entity.children) {
            const child = this.entityMap_.get(childId);
            if (child) {
                result.push(child);
                result.push(...this.collectDescendants(childId));
            }
        }
        return result;
    }
}

// =============================================================================
// ReparentCommand
// =============================================================================

export class ReparentCommand extends BaseCommand {
    readonly type = 'reparent';
    readonly structural = true;
    readonly description: string;
    private oldParent_: number | null;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private newParent_: number | null
    ) {
        super();
        const entity = entityMap_.get(entityId_);
        this.oldParent_ = entity?.parent ?? null;
        this.description = `Reparent entity "${entity?.name ?? entityId_}"`;
    }

    execute(): void {
        this.setParent(this.newParent_);
    }

    undo(): void {
        this.setParent(this.oldParent_);
    }

    private setParent(newParent: number | null): void {
        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;

        const oldParent = entity.parent;

        if (oldParent !== null) {
            const oldParentData = this.entityMap_.get(oldParent);
            if (oldParentData) {
                const idx = oldParentData.children.indexOf(this.entityId_);
                if (idx !== -1) {
                    oldParentData.children.splice(idx, 1);
                }
            }
        }

        entity.parent = newParent;

        if (newParent !== null) {
            const newParentData = this.entityMap_.get(newParent);
            if (newParentData && !newParentData.children.includes(this.entityId_)) {
                newParentData.children.push(this.entityId_);
            }
        }
    }
}

// =============================================================================
// MoveEntityCommand
// =============================================================================

export class MoveEntityCommand extends BaseCommand {
    readonly type = 'move_entity';
    readonly structural = true;
    readonly description: string;
    private oldParent_: number | null;
    private oldIndex_: number;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private newParent_: number | null,
        private newIndex_: number
    ) {
        super();
        const entity = entityMap_.get(entityId_);
        this.oldParent_ = entity?.parent ?? null;
        this.oldIndex_ = this.computeIndex(this.oldParent_);
        this.description = `Move entity "${entity?.name ?? entityId_}"`;
    }

    execute(): void {
        this.applyMove(this.newParent_, this.newIndex_);
    }

    undo(): void {
        this.applyMove(this.oldParent_, this.oldIndex_);
    }

    private computeIndex(parent: number | null): number {
        if (parent !== null) {
            const parentData = this.entityMap_.get(parent);
            return parentData?.children.indexOf(this.entityId_) ?? 0;
        }
        const roots = this.scene_.entities.filter(e => e.parent === null);
        return roots.findIndex(e => e.id === this.entityId_);
    }

    private applyMove(targetParent: number | null, targetIndex: number): void {
        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;

        if (entity.parent !== null) {
            const parent = this.entityMap_.get(entity.parent);
            if (parent) {
                const idx = parent.children.indexOf(this.entityId_);
                if (idx !== -1) parent.children.splice(idx, 1);
            }
        }

        entity.parent = targetParent;

        if (targetParent !== null) {
            const parent = this.entityMap_.get(targetParent);
            if (parent) {
                const i = Math.min(targetIndex, parent.children.length);
                parent.children.splice(i, 0, this.entityId_);
            }
        } else {
            const arrIdx = this.scene_.entities.indexOf(entity);
            this.scene_.entities.splice(arrIdx, 1);
            const roots = this.scene_.entities.filter(e => e.parent === null);
            if (targetIndex >= roots.length) {
                this.scene_.entities.push(entity);
            } else {
                const refIdx = this.scene_.entities.indexOf(roots[targetIndex]);
                this.scene_.entities.splice(refIdx, 0, entity);
            }
        }
    }
}

// =============================================================================
// AddComponentCommand
// =============================================================================

export class AddComponentCommand extends BaseCommand {
    readonly type = 'add_component';
    readonly description: string;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private componentType_: string,
        private componentData_: Record<string, unknown>
    ) {
        super();
        this.description = `Add ${componentType_}`;
    }

    execute(): void {
        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;

        if (!entity.components.find(c => c.type === this.componentType_)) {
            entity.components.push({
                type: this.componentType_,
                data: { ...this.componentData_ },
            });
        }
    }

    undo(): void {
        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;

        const idx = entity.components.findIndex(c => c.type === this.componentType_);
        if (idx !== -1) {
            entity.components.splice(idx, 1);
        }
    }
}

// =============================================================================
// RemoveComponentCommand
// =============================================================================

export class RemoveComponentCommand extends BaseCommand {
    readonly type = 'remove_component';
    readonly description: string;
    private removedData_: Record<string, unknown> | null = null;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private componentType_: string
    ) {
        super();
        this.description = `Remove ${componentType_}`;
    }

    execute(): void {
        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;

        const idx = entity.components.findIndex(c => c.type === this.componentType_);
        if (idx !== -1) {
            this.removedData_ = { ...entity.components[idx].data };
            entity.components.splice(idx, 1);
        }
    }

    undo(): void {
        if (!this.removedData_) return;

        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;

        entity.components.push({
            type: this.componentType_,
            data: this.removedData_,
        });
    }
}

// =============================================================================
// ReorderComponentCommand
// =============================================================================

export class ReorderComponentCommand extends BaseCommand {
    readonly type = 'reorder_component';
    readonly description: string;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private fromIndex_: number,
        private toIndex_: number
    ) {
        super();
        this.description = `Reorder component`;
    }

    execute(): void {
        this.swap(this.fromIndex_, this.toIndex_);
    }

    undo(): void {
        this.swap(this.toIndex_, this.fromIndex_);
    }

    private swap(from: number, to: number): void {
        const entity = this.entityMap_.get(this.entityId_);
        if (!entity) return;
        const components = entity.components;
        if (from < 0 || from >= components.length || to < 0 || to >= components.length) return;
        const [removed] = components.splice(from, 1);
        components.splice(to, 0, removed);
    }
}
