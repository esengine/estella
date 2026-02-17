import type { Entity } from 'esengine';
import type { SceneData, EntityData } from '../types/SceneTypes';
import {
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
} from '../prefab';
import { getGlobalPathResolver, getAssetDatabase, isUUID } from '../asset';
import { showConfirmDialog } from '../ui/dialog';
import type { DirtyFlag, EntityLifecycleEvent } from './EditorStore';

export interface PrefabEditHost {
    readonly state_: {
        scene: SceneData;
        filePath: string | null;
        isDirty: boolean;
    };
    readonly entityMap_: Map<number, EntityData>;
    nextEntityId_: number;
    executeCommand(cmd: import('../commands').Command): void;
    notify(flag: DirtyFlag): void;
    notifyEntityLifecycle(event: EntityLifecycleEvent): void;
    selectEntity(entity: Entity | null): void;
    loadScene(scene: SceneData, filePath: string | null): void;
}

export class PrefabEditService {
    private host_: PrefabEditHost;
    private prefabLock_: Promise<void> | null = null;
    private prefabEditingPath_: string | null = null;
    private savedSceneState_: {
        scene: SceneData;
        filePath: string | null;
        isDirty: boolean;
    } | null = null;

    constructor(host: PrefabEditHost) {
        this.host_ = host;
    }

    get prefabEditingPath(): string | null {
        return this.prefabEditingPath_;
    }

    get isEditingPrefab(): boolean {
        return this.prefabEditingPath_ !== null;
    }

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
            this.host_.state_.scene,
            this.host_.entityMap_,
            prefab,
            prefabPath,
            parentEntity as number | null,
            this.host_.nextEntityId_
        );
        this.host_.executeCommand(cmd);

        const createdIds = cmd.createdEntityIds;
        this.host_.nextEntityId_ = Math.max(this.host_.nextEntityId_, ...createdIds.map(id => id + 1));

        for (const id of createdIds) {
            this.host_.notifyEntityLifecycle({ entity: id, type: 'created', parent: null });
        }

        const rootId = cmd.rootEntityId;
        if (rootId !== -1) {
            this.host_.selectEntity(rootId as Entity);
        }

        return rootId as Entity;
    }

    private async instantiatePrefabNested(
        prefabPath: string,
        parentEntity: Entity | null
    ): Promise<Entity | null> {
        const result = await instantiatePrefabRecursive(
            prefabPath,
            this.host_.state_.scene,
            parentEntity as number | null,
            this.host_.nextEntityId_
        );
        if (!result) return null;

        const cmd = new InstantiateNestedPrefabCommand(
            this.host_.state_.scene,
            this.host_.entityMap_,
            result.createdEntities,
            result.rootEntityId,
            parentEntity as number | null
        );
        this.host_.executeCommand(cmd);

        this.host_.nextEntityId_ = Math.max(
            this.host_.nextEntityId_,
            ...result.createdEntities.map(e => e.id + 1)
        );

        for (const entity of result.createdEntities) {
            this.host_.notifyEntityLifecycle({ entity: entity.id, type: 'created', parent: entity.parent });
        }

        this.host_.selectEntity(result.rootEntityId as Entity);

        return result.rootEntityId as Entity;
    }

    private async prefabHasNested(prefabPath: string): Promise<boolean> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return false;
        return prefab.entities.some(e => e.nestedPrefab !== undefined);
    }

    async saveAsPrefab(entityId: number, filePath: string): Promise<boolean> {
        const entityData = this.host_.entityMap_.get(entityId);
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
            const entity = this.host_.entityMap_.get(sceneId);
            if (!entity) continue;

            entity.prefab = {
                prefabPath: uuid,
                prefabEntityId,
                isRoot: sceneId === entityId,
                instanceId,
                overrides: [],
            };
        }

        this.host_.state_.isDirty = true;
        this.host_.notify('scene');
        return true;
    }

    async revertPrefabInstance(instanceId: string, prefabPath: string): Promise<void> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return;

        const cmd = new RevertPrefabInstanceCommand(
            this.host_.state_.scene,
            instanceId,
            prefab,
            prefabPath
        );
        this.host_.executeCommand(cmd);
    }

    async applyPrefabOverrides(instanceId: string, prefabPath: string): Promise<void> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return;

        const cmd = new ApplyPrefabOverridesCommand(
            this.host_.state_.scene,
            instanceId,
            prefab,
            prefabPath,
            async (p, path) => { await savePrefabToPath(p, path); }
        );
        this.host_.executeCommand(cmd);
    }

    unpackPrefab(instanceId: string): void {
        const cmd = new UnpackPrefabCommand(this.host_.state_.scene, instanceId);
        this.host_.executeCommand(cmd);
    }

    isPrefabInstance(entityId: number): boolean {
        const entity = this.host_.entityMap_.get(entityId);
        return entity?.prefab !== undefined;
    }

    isPrefabRoot(entityId: number): boolean {
        const entity = this.host_.entityMap_.get(entityId);
        return entity?.prefab?.isRoot === true;
    }

    getPrefabInstanceId(entityId: number): string | undefined {
        return this.host_.entityMap_.get(entityId)?.prefab?.instanceId;
    }

    getPrefabPath(entityId: number): string | undefined {
        return this.host_.entityMap_.get(entityId)?.prefab?.prefabPath;
    }

    async enterPrefabEditMode(prefabPath: string): Promise<boolean> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return false;

        this.savedSceneState_ = {
            scene: JSON.parse(JSON.stringify(this.host_.state_.scene)),
            filePath: this.host_.state_.filePath,
            isDirty: this.host_.state_.isDirty,
        };

        if (!isUUID(prefabPath)) {
            const uuid = getAssetDatabase().getUuid(prefabPath);
            if (uuid) prefabPath = uuid;
        }
        this.prefabEditingPath_ = prefabPath;
        const scene = prefabToSceneData(prefab);
        this.host_.loadScene(scene, null);

        return true;
    }

    async exitPrefabEditMode(): Promise<void> {
        if (!this.savedSceneState_) return;

        let saveFailed = false;
        if (this.host_.state_.isDirty) {
            saveFailed = !(await this.trySavePrefabWithRetry());
        }

        const saved = this.savedSceneState_;
        const editedPrefabPath = this.prefabEditingPath_!;
        this.prefabEditingPath_ = null;
        this.savedSceneState_ = null;

        const synced = await syncPrefabInstances(saved.scene, editedPrefabPath);
        this.host_.loadScene(saved.scene, saved.filePath);
        this.host_.state_.isDirty = saved.isDirty || synced || saveFailed;
        this.host_.notify('scene');
    }

    async savePrefabEditing(): Promise<boolean> {
        if (!this.prefabEditingPath_) return false;

        const prefab = sceneDataToPrefab(this.host_.state_.scene);
        const saved = await savePrefabToPath(prefab, this.prefabEditingPath_);
        if (saved) {
            this.host_.state_.isDirty = false;
            this.host_.notify('scene');
        }
        return saved;
    }

    private async trySavePrefabWithRetry(): Promise<boolean> {
        while (true) {
            try {
                await this.savePrefabEditing();
                return true;
            } catch (e) {
                const retry = await showConfirmDialog({
                    title: 'Failed to save prefab',
                    message: `${String(e)}\n\nRetry saving, or discard changes?`,
                    confirmText: 'Retry',
                    cancelText: 'Discard',
                    danger: true,
                });
                if (!retry) return false;
            }
        }
    }

    private collectEntityTree(rootId: number): EntityData[] {
        const result: EntityData[] = [];
        const entity = this.host_.entityMap_.get(rootId);
        if (!entity) return result;

        result.push(entity);
        for (const childId of entity.children) {
            result.push(...this.collectEntityTree(childId));
        }
        return result;
    }
}
