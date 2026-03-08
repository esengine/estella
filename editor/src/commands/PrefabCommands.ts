import type { SceneData, EntityData } from '../types/SceneTypes';
import type { PrefabData, PrefabOverride } from '../types/PrefabTypes';
import { applyOverrides, type ProcessedEntity } from 'esengine';
import { BaseCommand } from './Command';
import { instantiatePrefab, computeNextEntityId } from '../prefab/PrefabInstantiator';

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
                this.savedPrefabData_.set(entity.id, { ...entity.prefab, overrides: [...entity.prefab.overrides] });
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

export class RevertPrefabInstanceCommand extends BaseCommand {
    readonly type = 'revert_prefab';
    readonly structural = true;
    readonly description: string;
    private savedSnapshot_: EntityData[] = [];
    private newEntityIds_: number[] = [];

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

        this.savedSnapshot_ = instanceEntities.map(e => snapshotEntity(e));

        const rootEntity = instanceEntities.find(e => e.prefab?.isRoot);
        if (!rootEntity) return;
        const rootParent = rootEntity.parent;

        for (const e of instanceEntities) {
            const idx = this.scene_.entities.indexOf(e);
            if (idx !== -1) this.scene_.entities.splice(idx, 1);
        }

        if (rootParent !== null) {
            const parent = this.scene_.entities.find(e => e.id === rootParent);
            if (parent) {
                const oldIds = new Set(instanceEntities.map(e => e.id));
                parent.children = parent.children.filter(c => !oldIds.has(c));
            }
        }

        const nextId = computeNextEntityId(this.scene_);
        const result = instantiatePrefab(
            this.prefab_, this.prefabPath_, this.scene_, rootParent, nextId,
        );

        for (const entity of result.createdEntities) {
            this.scene_.entities.push(entity);
        }
        this.newEntityIds_ = result.createdEntities.map(e => e.id);

        if (rootParent !== null) {
            const parent = this.scene_.entities.find(e => e.id === rootParent);
            if (parent && !parent.children.includes(result.rootEntityId)) {
                parent.children.push(result.rootEntityId);
            }
        }
    }

    undo(): void {
        const newIds = new Set(this.newEntityIds_);
        this.scene_.entities = this.scene_.entities.filter(e => !newIds.has(e.id));

        for (const saved of this.savedSnapshot_) {
            this.scene_.entities.push(saved);
        }

        const root = this.savedSnapshot_.find(e => e.prefab?.isRoot);
        if (root?.parent !== null && root?.parent !== undefined) {
            const parent = this.scene_.entities.find(e => e.id === root.parent);
            if (parent) {
                for (const e of this.savedSnapshot_) {
                    if (e.parent === root.parent && !parent.children.includes(e.id)) {
                        parent.children.push(e.id);
                    }
                }
                for (const id of this.newEntityIds_) {
                    parent.children = parent.children.filter(c => c !== id);
                }
            }
        }
    }
}

export class ApplyPrefabOverridesCommand extends BaseCommand {
    readonly type = 'apply_prefab';
    readonly structural = true;
    readonly description: string;
    private savedPrefab_: PrefabData | null = null;
    private savedOtherInstances_: Map<number, EntityData>[] = [];
    private savedSourceOverrides_: Map<number, PrefabOverride[]> = new Map();

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

        this.savedSourceOverrides_.clear();
        for (const entity of instanceEntities) {
            if (entity.prefab && entity.prefab.overrides.length > 0) {
                this.savedSourceOverrides_.set(entity.id, [...entity.prefab.overrides]);
                entity.prefab.overrides = [];
            }
        }

        this.updateOtherInstances();

        this.onSave_(this.prefab_, this.prefabPath_).catch(err => {
            console.error('Failed to save prefab:', err);
        });
    }

    undo(): void {
        if (this.savedPrefab_) {
            this.prefab_.entities = this.savedPrefab_.entities;
        }

        for (const [entityId, overrides] of this.savedSourceOverrides_) {
            const entity = this.scene_.entities.find(e => e.id === entityId);
            if (entity?.prefab) {
                entity.prefab.overrides = overrides;
            }
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

    private updateOtherInstances(): void {
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

                const entityOverrides = entity.prefab.overrides;
                if (entityOverrides.length > 0) {
                    const processed: ProcessedEntity = {
                        id: entity.id,
                        prefabEntityId: entity.prefab.prefabEntityId,
                        name: entity.name,
                        parent: entity.parent,
                        children: entity.children,
                        components: entity.components,
                        visible: entity.visible,
                    };
                    applyOverrides(processed, entityOverrides);
                    entity.name = processed.name;
                    entity.visible = processed.visible;
                    entity.components = processed.components;
                }
            }
        }
    }
}

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

function snapshotEntity(e: EntityData): EntityData {
    return {
        ...e,
        children: [...e.children],
        components: e.components.map(c => ({ type: c.type, data: JSON.parse(JSON.stringify(c.data)) })),
        prefab: e.prefab ? { ...e.prefab, overrides: [...e.prefab.overrides] } : undefined,
    };
}
