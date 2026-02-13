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
    readonly description: string;
    private createdEntityIds_: number[] = [];
    private nextEntityIdBefore_: number;

    constructor(
        private scene_: SceneData,
        private prefab_: PrefabData,
        private prefabPath_: string,
        private parentEntityId_: number | null,
        private nextEntityId_: number
    ) {
        super();
        this.description = `Instantiate prefab "${prefab_.name}"`;
        this.nextEntityIdBefore_ = nextEntityId_;
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
            const parent = this.scene_.entities.find(e => e.id === this.parentEntityId_);
            if (parent && !parent.children.includes(result.rootEntityId)) {
                parent.children.push(result.rootEntityId);
            }
        }

        this.createdEntityIds_ = result.createdEntities.map(e => e.id);
    }

    undo(): void {
        const idsToRemove = new Set(this.createdEntityIds_);

        if (this.parentEntityId_ !== null) {
            const parent = this.scene_.entities.find(e => e.id === this.parentEntityId_);
            if (parent) {
                parent.children = parent.children.filter(id => !idsToRemove.has(id));
            }
        }

        this.scene_.entities = this.scene_.entities.filter(e => !idsToRemove.has(e.id));
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
    readonly description: string;
    private savedEntities_: Map<number, EntityData> = new Map();

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
        this.savedEntities_.clear();

        const instanceEntities = this.scene_.entities.filter(
            e => e.prefab?.instanceId === this.instanceId_
        );
        if (instanceEntities.length === 0) return;

        for (const entity of instanceEntities) {
            this.savedEntities_.set(entity.id, {
                ...entity,
                components: entity.components.map(c => ({ type: c.type, data: { ...c.data } })),
                prefab: entity.prefab ? { ...entity.prefab, overrides: [...entity.prefab.overrides] } : undefined,
            });
        }

        const rootEntity = instanceEntities.find(e => e.prefab?.isRoot);
        if (!rootEntity) return;

        const idMapping = new Map<number, number>();
        for (const entity of instanceEntities) {
            if (entity.prefab) {
                idMapping.set(entity.prefab.prefabEntityId, entity.id);
            }
        }

        for (const pe of this.prefab_.entities) {
            const sceneId = idMapping.get(pe.prefabEntityId);
            if (sceneId === undefined) continue;

            const entity = this.scene_.entities.find(e => e.id === sceneId);
            if (!entity) continue;

            entity.name = pe.name;
            entity.visible = pe.visible;
            entity.components = pe.components.map(c => ({
                type: c.type,
                data: JSON.parse(JSON.stringify(c.data)),
            }));

            if (entity.prefab) {
                entity.prefab.overrides = [];
            }
        }
    }

    undo(): void {
        for (const [entityId, saved] of this.savedEntities_) {
            const entity = this.scene_.entities.find(e => e.id === entityId);
            if (!entity) continue;

            entity.name = saved.name;
            entity.visible = saved.visible;
            entity.components = saved.components;
            if (saved.prefab) {
                entity.prefab = saved.prefab;
            }
        }
    }
}

// =============================================================================
// ApplyPrefabOverridesCommand
// =============================================================================

export class ApplyPrefabOverridesCommand extends BaseCommand {
    readonly type = 'apply_prefab';
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

    private updateOtherInstances(sourceEntities: EntityData[]): void {
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
