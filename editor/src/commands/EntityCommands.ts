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
    readonly description: string;
    private entityData_: EntityData;

    constructor(
        private scene_: SceneData,
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
            const parentData = this.scene_.entities.find(e => e.id === this.parent_);
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
            const parentData = this.scene_.entities.find(e => e.id === this.parent_);
            if (parentData) {
                const childIdx = parentData.children.indexOf(this.entityId_);
                if (childIdx !== -1) {
                    parentData.children.splice(childIdx, 1);
                }
            }
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
    readonly description: string;
    private deletedData_: EntityData | null = null;
    private deletedChildren_: EntityData[] = [];

    constructor(
        private scene_: SceneData,
        private entityId_: number
    ) {
        super();
        const entity = scene_.entities.find(e => e.id === entityId_);
        this.description = `Delete entity "${entity?.name ?? entityId_}"`;
    }

    execute(): void {
        this.deletedData_ = this.scene_.entities.find(e => e.id === this.entityId_) ?? null;
        if (!this.deletedData_) return;

        this.deletedChildren_ = this.collectDescendants(this.entityId_);

        if (this.deletedData_.parent !== null) {
            const parentData = this.scene_.entities.find(e => e.id === this.deletedData_!.parent);
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
            const parentData = this.scene_.entities.find(e => e.id === this.deletedData_!.parent);
            if (parentData && !parentData.children.includes(this.entityId_)) {
                parentData.children.push(this.entityId_);
            }
        }
    }

    private collectDescendants(entityId: number): EntityData[] {
        const result: EntityData[] = [];
        const entity = this.scene_.entities.find(e => e.id === entityId);
        if (!entity) return result;

        for (const childId of entity.children) {
            const child = this.scene_.entities.find(e => e.id === childId);
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
    readonly description: string;
    private oldParent_: number | null;

    constructor(
        private scene_: SceneData,
        private entityId_: number,
        private newParent_: number | null
    ) {
        super();
        const entity = scene_.entities.find(e => e.id === entityId_);
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
        const entity = this.scene_.entities.find(e => e.id === this.entityId_);
        if (!entity) return;

        const oldParent = entity.parent;

        if (oldParent !== null) {
            const oldParentData = this.scene_.entities.find(e => e.id === oldParent);
            if (oldParentData) {
                const idx = oldParentData.children.indexOf(this.entityId_);
                if (idx !== -1) {
                    oldParentData.children.splice(idx, 1);
                }
            }
        }

        entity.parent = newParent;

        if (newParent !== null) {
            const newParentData = this.scene_.entities.find(e => e.id === newParent);
            if (newParentData && !newParentData.children.includes(this.entityId_)) {
                newParentData.children.push(this.entityId_);
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
        private entityId_: number,
        private componentType_: string,
        private componentData_: Record<string, unknown>
    ) {
        super();
        this.description = `Add ${componentType_}`;
    }

    execute(): void {
        const entity = this.scene_.entities.find(e => e.id === this.entityId_);
        if (!entity) return;

        if (!entity.components.find(c => c.type === this.componentType_)) {
            entity.components.push({
                type: this.componentType_,
                data: { ...this.componentData_ },
            });
        }
    }

    undo(): void {
        const entity = this.scene_.entities.find(e => e.id === this.entityId_);
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
        private entityId_: number,
        private componentType_: string
    ) {
        super();
        this.description = `Remove ${componentType_}`;
    }

    execute(): void {
        const entity = this.scene_.entities.find(e => e.id === this.entityId_);
        if (!entity) return;

        const idx = entity.components.findIndex(c => c.type === this.componentType_);
        if (idx !== -1) {
            this.removedData_ = { ...entity.components[idx].data };
            entity.components.splice(idx, 1);
        }
    }

    undo(): void {
        if (!this.removedData_) return;

        const entity = this.scene_.entities.find(e => e.id === this.entityId_);
        if (!entity) return;

        entity.components.push({
            type: this.componentType_,
            data: this.removedData_,
        });
    }
}
