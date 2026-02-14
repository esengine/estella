/**
 * @file    PrefabCommands.ts
 * @brief   Prefab-related undo/redo commands
 */

import type { SceneData, EntityData } from '../types/SceneTypes';
import type { PrefabData, PrefabOverride } from '../types/PrefabTypes';
import { BaseCommand } from './Command';
import { instantiatePrefab, computeNextEntityId } from '../prefab/PrefabInstantiator';

// =============================================================================
// InstantiatePrefabCommand
// =============================================================================

export class InstantiatePrefabCommand extends BaseCommand {
    readonly type = 'instantiate_prefab';
    readonly structural = true;
    readonly description: string;
    private createdEntityIds_: number[] = [];
    private createdEntities_: EntityData[] = [];

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private prefab_: PrefabData,
        private prefabPath_: string,
        private parentEntityId_: number | null,
        private nextEntityId_: number
    ) {
        super();
        this.description = `Instantiate prefab "${prefab_.name}"`;
    }

    execute(): void {
        const result = instantiatePrefab(
            this.prefab_,
            this.prefabPath_,
            this.scene_,
            this.parentEntityId_,
            this.nextEntityId_
        );

        for (const entity of result.createdEntities) {
            this.scene_.entities.push(entity);
        }

        if (this.parentEntityId_ !== null) {
            const parent = this.entityMap_.get(this.parentEntityId_);
            if (parent && !parent.children.includes(result.rootEntityId)) {
                parent.children.push(result.rootEntityId);
            }
        }

        this.createdEntities_ = result.createdEntities;
        this.createdEntityIds_ = result.createdEntities.map(e => e.id);
    }

    undo(): void {
        const idsToRemove = new Set(this.createdEntityIds_);

        if (this.parentEntityId_ !== null) {
            const parent = this.entityMap_.get(this.parentEntityId_);
            if (parent) {
                parent.children = parent.children.filter(id => !idsToRemove.has(id));
            }
        }

        this.scene_.entities = this.scene_.entities.filter(e => !idsToRemove.has(e.id));
    }

    updateEntityMap(map: Map<number, EntityData>, isUndo: boolean): void {
        if (isUndo) {
            for (const id of this.createdEntityIds_) {
                map.delete(id);
            }
        } else {
            for (const entity of this.createdEntities_) {
                map.set(entity.id, entity);
            }
        }
    }

    get rootEntityId(): number {
        return this.createdEntityIds_[0] ?? -1;
    }

    get createdEntityIds(): number[] {
        return this.createdEntityIds_;
    }
}

// =============================================================================
// UnpackPrefabCommand
// =============================================================================

export class UnpackPrefabCommand extends BaseCommand {
    readonly type = 'unpack_prefab';
    readonly structural = true;
    readonly description: string;
    private savedPrefabData_: Map<number, EntityData['prefab']> = new Map();

    constructor(
        private scene_: SceneData,
        private instanceId_: string
    ) {
        super();
        this.description = 'Unpack prefab';
    }

    execute(): void {
        this.savedPrefabData_.clear();
        for (const entity of this.scene_.entities) {
            if (entity.prefab?.instanceId === this.instanceId_) {
                this.savedPrefabData_.set(entity.id, { ...entity.prefab });
                delete entity.prefab;
            }
        }
    }

    undo(): void {
        for (const [entityId, prefabData] of this.savedPrefabData_) {
            const entity = this.scene_.entities.find(e => e.id === entityId);
            if (entity) {
                entity.prefab = prefabData;
            }
        }
    }
}

// =============================================================================
// RevertPrefabInstanceCommand
// =============================================================================

export class RevertPrefabInstanceCommand extends BaseCommand {
    readonly type = 'revert_prefab';
    readonly structural = true;
    readonly description: string;
    private savedSnapshot_: EntityData[] = [];
    private savedIndices_: Map<number, number> = new Map();
    private addedEntityIds_: number[] = [];

    constructor(
        private scene_: SceneData,
        private instanceId_: string,
        private prefab_: PrefabData,
        private prefabPath_: string
    ) {
        super();
        this.description = `Revert prefab "${prefab_.name}"`;
    }

    execute(): void {
        const instanceEntities = this.scene_.entities.filter(
            e => e.prefab?.instanceId === this.instanceId_
        );
        if (instanceEntities.length === 0) return;

        this.savedIndices_.clear();
        for (const e of instanceEntities) {
            this.savedIndices_.set(e.id, this.scene_.entities.indexOf(e));
        }

        this.savedSnapshot_ = instanceEntities.map(e => ({
            ...e,
            children: [...e.children],
            components: e.components.map(c => ({ type: c.type, data: JSON.parse(JSON.stringify(c.data)) })),
            prefab: e.prefab ? { ...e.prefab, overrides: [...e.prefab.overrides] } : undefined,
        }));

        const rootEntity = instanceEntities.find(e => e.prefab?.isRoot);
        if (!rootEntity) return;
        const rootParent = rootEntity.parent;

        const existingByPrefabId = new Map<number, EntityData>();
        for (const entity of instanceEntities) {
            if (entity.prefab) {
                existingByPrefabId.set(entity.prefab.prefabEntityId, entity);
            }
        }

        const prefabEntityIds = new Set(this.prefab_.entities.map(pe => pe.prefabEntityId));

        const removedEntities = instanceEntities.filter(
            e => !prefabEntityIds.has(e.prefab!.prefabEntityId)
        );
        for (const removed of removedEntities) {
            const idx = this.scene_.entities.indexOf(removed);
            if (idx !== -1) this.scene_.entities.splice(idx, 1);
            existingByPrefabId.delete(removed.prefab!.prefabEntityId);
        }

        let nextId = computeNextEntityId(this.scene_);
        const newIdMapping = new Map<number, number>();
        this.addedEntityIds_ = [];

        const missingEntities = this.prefab_.entities.filter(
            pe => !existingByPrefabId.has(pe.prefabEntityId)
        );
        for (const pe of missingEntities) {
            newIdMapping.set(pe.prefabEntityId, nextId++);
        }

        for (const pe of missingEntities) {
            const sceneId = newIdMapping.get(pe.prefabEntityId)!;
            const isRoot = pe.prefabEntityId === this.prefab_.rootEntityId;

            let parent: number | null;
            if (isRoot) {
                parent = rootParent;
            } else if (pe.parent !== null) {
                parent = existingByPrefabId.get(pe.parent)?.id
                    ?? newIdMapping.get(pe.parent) ?? null;
            } else {
                parent = null;
            }

            const entity: EntityData = {
                id: sceneId,
                name: pe.name,
                parent,
                children: [],
                components: pe.components.map(c => ({
                    type: c.type,
                    data: JSON.parse(JSON.stringify(c.data)),
                })),
                visible: pe.visible,
                prefab: {
                    prefabPath: this.prefabPath_,
                    prefabEntityId: pe.prefabEntityId,
                    isRoot: false,
                    instanceId: this.instanceId_,
                    overrides: [],
                },
            };

            this.scene_.entities.push(entity);
            existingByPrefabId.set(pe.prefabEntityId, entity);
            this.addedEntityIds_.push(sceneId);
        }

        for (const pe of this.prefab_.entities) {
            const entity = existingByPrefabId.get(pe.prefabEntityId);
            if (!entity) continue;

            entity.name = pe.name;
            entity.visible = pe.visible;
            entity.components = pe.components.map(c => ({
                type: c.type,
                data: JSON.parse(JSON.stringify(c.data)),
            }));

            entity.children = pe.children
                .map(cid => existingByPrefabId.get(cid)?.id)
                .filter((id): id is number => id !== undefined);

            if (entity.prefab) {
                entity.prefab.overrides = [];
            }
        }

        if (rootParent !== null) {
            const parentEntity = this.scene_.entities.find(e => e.id === rootParent);
            if (parentEntity) {
                for (const removed of removedEntities) {
                    parentEntity.children = parentEntity.children.filter(c => c !== removed.id);
                }
            }
        }
    }

    undo(): void {
        for (const id of this.addedEntityIds_) {
            const idx = this.scene_.entities.findIndex(e => e.id === id);
            if (idx !== -1) this.scene_.entities.splice(idx, 1);
        }

        const instanceEntities = this.scene_.entities.filter(
            e => e.prefab?.instanceId === this.instanceId_
        );
        for (const entity of instanceEntities) {
            const idx = this.scene_.entities.indexOf(entity);
            if (idx !== -1) this.scene_.entities.splice(idx, 1);
        }

        const sorted = [...this.savedSnapshot_].sort(
            (a, b) => (this.savedIndices_.get(a.id) ?? 0) - (this.savedIndices_.get(b.id) ?? 0)
        );
        for (const saved of sorted) {
            const idx = this.savedIndices_.get(saved.id) ?? this.scene_.entities.length;
            this.scene_.entities.splice(Math.min(idx, this.scene_.entities.length), 0, saved);
        }

        if (this.savedSnapshot_.length > 0) {
            const root = this.savedSnapshot_.find(e => e.prefab?.isRoot);
            if (root?.parent !== null && root?.parent !== undefined) {
                const parentEntity = this.scene_.entities.find(e => e.id === root.parent);
                if (parentEntity) {
                    const childIds = this.savedSnapshot_.filter(e => e.parent === root.parent).map(e => e.id);
                    for (const cid of childIds) {
                        if (!parentEntity.children.includes(cid)) {
                            parentEntity.children.push(cid);
                        }
                    }
                }
            }
        }
    }
}

// =============================================================================
// ApplyPrefabOverridesCommand
// =============================================================================

export class ApplyPrefabOverridesCommand extends BaseCommand {
    readonly type = 'apply_prefab';
    readonly structural = true;
    readonly description: string;
    private savedPrefab_: PrefabData | null = null;
    private savedOtherInstances_: Map<number, EntityData>[] = [];

    constructor(
        private scene_: SceneData,
        private instanceId_: string,
        private prefab_: PrefabData,
        private prefabPath_: string,
        private onSave_: (prefab: PrefabData, path: string) => Promise<void>
    ) {
        super();
        this.description = `Apply to prefab "${prefab_.name}"`;
    }

    execute(): void {
        this.savedPrefab_ = JSON.parse(JSON.stringify(this.prefab_));

        const instanceEntities = this.scene_.entities.filter(
            e => e.prefab?.instanceId === this.instanceId_
        );

        for (const entity of instanceEntities) {
            if (!entity.prefab) continue;
            const pe = this.prefab_.entities.find(
                pe => pe.prefabEntityId === entity.prefab!.prefabEntityId
            );
            if (!pe) continue;

            pe.name = entity.name;
            pe.visible = entity.visible;
            pe.components = entity.components.map(c => ({
                type: c.type,
                data: JSON.parse(JSON.stringify(c.data)),
            }));
        }

        const rootEntity = instanceEntities.find(e => e.prefab?.isRoot);
        if (rootEntity?.prefab) {
            rootEntity.prefab.overrides = [];
        }

        this.updateOtherInstances(instanceEntities);

        this.onSave_(this.prefab_, this.prefabPath_);
    }

    undo(): void {
        if (this.savedPrefab_) {
            this.prefab_.entities = this.savedPrefab_.entities;
        }

        for (const savedMap of this.savedOtherInstances_) {
            for (const [entityId, saved] of savedMap) {
                const entity = this.scene_.entities.find(e => e.id === entityId);
                if (!entity) continue;
                entity.name = saved.name;
                entity.visible = saved.visible;
                entity.components = saved.components;
            }
        }
    }

    private updateOtherInstances(_sourceEntities: EntityData[]): void {
        const otherInstanceIds = new Set<string>();
        for (const entity of this.scene_.entities) {
            if (entity.prefab?.prefabPath === this.prefabPath_ &&
                entity.prefab.instanceId !== this.instanceId_ &&
                entity.prefab.isRoot) {
                otherInstanceIds.add(entity.prefab.instanceId);
            }
        }

        for (const otherId of otherInstanceIds) {
            const savedMap = new Map<number, EntityData>();
            const otherEntities = this.scene_.entities.filter(
                e => e.prefab?.instanceId === otherId
            );

            for (const entity of otherEntities) {
                savedMap.set(entity.id, {
                    ...entity,
                    components: entity.components.map(c => ({ type: c.type, data: { ...c.data } })),
                });
            }
            this.savedOtherInstances_.push(savedMap);

            const otherRoot = otherEntities.find(e => e.prefab?.isRoot);
            const otherOverrides = otherRoot?.prefab?.overrides ?? [];

            for (const entity of otherEntities) {
                if (!entity.prefab) continue;
                const pe = this.prefab_.entities.find(
                    pe => pe.prefabEntityId === entity.prefab!.prefabEntityId
                );
                if (!pe) continue;

                entity.name = pe.name;
                entity.visible = pe.visible;
                entity.components = pe.components.map(c => ({
                    type: c.type,
                    data: JSON.parse(JSON.stringify(c.data)),
                }));

                for (const override of otherOverrides) {
                    if (override.prefabEntityId !== entity.prefab.prefabEntityId) continue;
                    this.applyOverrideToEntity(entity, override);
                }
            }
        }
    }

    private applyOverrideToEntity(entity: EntityData, override: PrefabOverride): void {
        switch (override.type) {
            case 'property':
                if (override.componentType && override.propertyName !== undefined) {
                    const comp = entity.components.find(c => c.type === override.componentType);
                    if (comp) {
                        comp.data[override.propertyName!] = override.value;
                    }
                }
                break;
            case 'name':
                if (typeof override.value === 'string') {
                    entity.name = override.value;
                }
                break;
            case 'visibility':
                if (typeof override.value === 'boolean') {
                    entity.visible = override.value;
                }
                break;
        }
    }
}

// =============================================================================
// InstantiateNestedPrefabCommand
// =============================================================================

export class InstantiateNestedPrefabCommand extends BaseCommand {
    readonly type = 'instantiate_nested_prefab';
    readonly structural = true;
    readonly description: string;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private createdEntities_: EntityData[],
        private rootEntityId_: number,
        private parentEntityId_: number | null
    ) {
        super();
        this.description = 'Instantiate nested prefab';
    }

    execute(): void {
        for (const entity of this.createdEntities_) {
            this.scene_.entities.push(entity);
        }

        if (this.parentEntityId_ !== null) {
            const parent = this.entityMap_.get(this.parentEntityId_);
            if (parent && !parent.children.includes(this.rootEntityId_)) {
                parent.children.push(this.rootEntityId_);
            }
        }
    }

    undo(): void {
        const idsToRemove = new Set(this.createdEntities_.map(e => e.id));

        if (this.parentEntityId_ !== null) {
            const parent = this.entityMap_.get(this.parentEntityId_);
            if (parent) {
                parent.children = parent.children.filter(id => !idsToRemove.has(id));
            }
        }

        this.scene_.entities = this.scene_.entities.filter(e => !idsToRemove.has(e.id));
    }

    updateEntityMap(map: Map<number, EntityData>, isUndo: boolean): void {
        if (isUndo) {
            for (const entity of this.createdEntities_) {
                map.delete(entity.id);
            }
        } else {
            for (const entity of this.createdEntities_) {
                map.set(entity.id, entity);
            }
        }
    }

    get rootEntityId(): number {
        return this.rootEntityId_;
    }

    get createdEntityIds(): number[] {
        return this.createdEntities_.map(e => e.id);
    }
}
