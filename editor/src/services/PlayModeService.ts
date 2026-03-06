import type { EntityData } from '../types/SceneTypes';
import { Assets, Name, Parent, Children, getComponent, getComponentAssetFields, Audio, audioPlugin, SceneManager } from 'esengine';
import { getSettingsValue, MAX_COLLISION_LAYERS } from '../settings';
import type { Entity, World } from 'esengine';
import { getEditorStore, type SceneSnapshot } from '../store/EditorStore';
import { getSharedRenderContext } from '../renderer/SharedRenderContext';
import { ScriptInjector } from './ScriptInjector';
import { getEditorInstance, getEditorContext } from '../context/EditorContext';
import { getAssetDatabase, isUUID } from '../asset';

export interface EntityComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface RuntimeEntityData {
    entityId: number;
    name: string;
    parentId: number | null;
    children: number[];
    components: EntityComponentData[];
}

export type PlayState = 'stopped' | 'playing';

type StateChangeCallback = (state: PlayState) => void;
type EntityListCallback = (entities: RuntimeEntityData[]) => void;
type SelectionCallback = (entityId: number | null) => void;

function isBuiltinComponent(comp: ReturnType<typeof getComponent>): boolean {
    return !!(comp && (comp as any)._builtin);
}

export function runtimeToEntityData(re: RuntimeEntityData): EntityData {
    return {
        id: re.entityId,
        name: re.name,
        parent: re.parentId,
        children: re.children,
        components: re.components.map(c => ({ type: c.type, data: c.data })),
        visible: true,
    };
}

export class PlayModeService {
    private state_: PlayState = 'stopped';
    private selectedEntityId_: number | null = null;
    private cachedEntities_: RuntimeEntityData[] = [];
    private stateListeners_ = new Set<StateChangeCallback>();
    private entityListListeners_ = new Set<EntityListCallback>();
    private selectionListeners_ = new Set<SelectionCallback>();
    private snapshot_: SceneSnapshot | null = null;
    private scriptInjector_: ScriptInjector | null = null;
    private sharedCleanups_: Array<() => void> = [];
    private sharedWorld_: World | null = null;
    private entityNameMap_: Map<number, string> | null = null;
    private entitySceneDataMap_: Map<number, { type: string; data: Record<string, unknown> }[]> | null = null;

    get state(): PlayState { return this.state_; }
    get runtimeEntities(): RuntimeEntityData[] { return this.cachedEntities_; }
    get selectedEntityId(): number | null { return this.selectedEntityId_; }

    getRuntimeEntityData(entityId: number): EntityData | null {
        const re = this.cachedEntities_.find(e => e.entityId === entityId);
        if (re) return runtimeToEntityData(re);
        return null;
    }

    querySharedEntity(entityId: number): RuntimeEntityData | null {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return null;
        return this.entityToRuntimeData(this.sharedWorld_, entityId as Entity);
    }

    async enter(): Promise<void> {
        this.snapshot_ = getEditorStore().takeSnapshot();
        this.state_ = 'playing';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;

        const ctx = getSharedRenderContext();
        this.configureAssetBaseUrl(ctx);
        this.registerProjectScenes(ctx);
        await this.injectUserScripts(ctx);

        const enablePhysics = getSettingsValue<boolean>('project.enablePhysics') ?? false;
        const physicsConfig = enablePhysics ? {
            gravity: {
                x: getSettingsValue<number>('physics.gravityX') ?? 0,
                y: getSettingsValue<number>('physics.gravityY') ?? -9.81,
            },
            fixedTimestep: getSettingsValue<number>('physics.fixedTimestep') ?? 1 / 60,
            subStepCount: getSettingsValue<number>('physics.subStepCount') ?? 4,
            contactHertz: getSettingsValue<number>('physics.contactHertz') ?? 30,
            contactDampingRatio: getSettingsValue<number>('physics.contactDampingRatio') ?? 10,
            contactSpeed: getSettingsValue<number>('physics.contactSpeed') ?? 3,
            collisionLayerMasks: Array.from({ length: MAX_COLLISION_LAYERS }, (_, i) =>
                getSettingsValue<number>(`physics.layerMask${i}`) ?? 0xFFFF
            ),
        } : undefined;
        await ctx.enterPlayMode(physicsConfig);

        this.startSharedEntityTracking(ctx);
        this.emitStateChange();
    }

    async exit(): Promise<void> {
        if (this.state_ !== 'playing') return;

        Audio.stopAll();
        Audio.baseUrl = '';
        audioPlugin.stopAllSources();
        this.cleanupSceneManager();

        for (const cleanup of this.sharedCleanups_) cleanup();
        this.sharedCleanups_ = [];

        const snapshot = this.snapshot_;
        this.snapshot_ = null;
        this.state_ = 'stopped';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;
        this.sharedWorld_ = null;
        this.entityNameMap_ = null;
        this.entitySceneDataMap_ = null;

        this.ejectUserScripts();
        await getSharedRenderContext().exitPlayMode(snapshot?.scene);

        if (snapshot) {
            getEditorStore().restoreSnapshot(snapshot);
        }

        this.emitStateChange();
        this.emitSelectionChange();
    }

    selectEntity(id: number | null): void {
        this.selectedEntityId_ = id;
        this.emitSelectionChange();
    }

    onStateChange(cb: StateChangeCallback): () => void {
        this.stateListeners_.add(cb);
        return () => { this.stateListeners_.delete(cb); };
    }

    onEntityListUpdate(cb: EntityListCallback): () => void {
        this.entityListListeners_.add(cb);
        return () => { this.entityListListeners_.delete(cb); };
    }

    onSelectionChange(cb: SelectionCallback): () => void {
        this.selectionListeners_.add(cb);
        return () => { this.selectionListeners_.delete(cb); };
    }

    setEntityProperty(entityId: number, componentType: string, property: string, value: unknown): void {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return;

        const compDef = getComponent(componentType);
        if (!compDef) return;

        if (isBuiltinComponent(compDef)) {
            const current = this.sharedWorld_.tryGet(entityId as Entity, compDef);
            if (!current) return;
            const snapshot = { ...current, [property]: value };
            this.sharedWorld_.insert(entityId as Entity, compDef, snapshot);
        } else {
            const current = this.sharedWorld_.tryGet(entityId as Entity, compDef);
            if (!current) return;
            (current as Record<string, unknown>)[property] = value;
        }
    }

    spawnEntity(name?: string, parentId?: number | null): number | null {
        if (!this.sharedWorld_) return null;
        const world = this.sharedWorld_;
        const entity = world.spawn();
        if (name) {
            world.insert(entity, Name, { value: name });
        }
        if (parentId != null && world.valid(parentId as Entity)) {
            world.insert(entity, Parent, { entity: parentId as Entity });
        }
        return entity as number;
    }

    despawnEntity(entityId: number): void {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return;
        this.sharedWorld_.despawn(entityId as Entity);
        if (this.selectedEntityId_ === entityId) {
            this.selectedEntityId_ = null;
            this.emitSelectionChange();
        }
    }

    addComponent(entityId: number, componentType: string, data?: Record<string, unknown>): void {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return;
        const compDef = getComponent(componentType);
        if (!compDef) return;
        this.sharedWorld_.insert(entityId as Entity, compDef, data ?? {});
    }

    removeComponent(entityId: number, componentType: string): void {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return;
        const compDef = getComponent(componentType);
        if (!compDef) return;
        this.sharedWorld_.remove(entityId as Entity, compDef);
    }

    renameEntity(entityId: number, name: string): void {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return;
        this.sharedWorld_.insert(entityId as Entity, Name, { value: name });
    }

    reparentEntity(entityId: number, newParentId: number | null): void {
        if (!this.sharedWorld_ || !this.sharedWorld_.valid(entityId as Entity)) return;
        if (newParentId != null) {
            this.sharedWorld_.insert(entityId as Entity, Parent, { entity: newParentId as Entity });
        } else {
            this.sharedWorld_.remove(entityId as Entity, Parent);
        }
    }

    private registerProjectScenes(ctx: ReturnType<typeof getSharedRenderContext>): void {
        const app = ctx.app_;
        if (!app || !app.hasResource(SceneManager)) return;

        const mgr = app.getResource(SceneManager);
        const db = getAssetDatabase();

        for (const entry of db.getAllEntries()) {
            if (!entry.path.endsWith('.esscene')) continue;
            const name = entry.path.replace(/.*\//, '').replace('.esscene', '');
            mgr.register({ name, path: entry.path });
        }
    }

    private cleanupSceneManager(): void {
        const app = getSharedRenderContext().app_;
        if (!app || !app.hasResource(SceneManager)) return;
        app.getResource(SceneManager).reset();
    }

    private configureAssetBaseUrl(ctx: ReturnType<typeof getSharedRenderContext>): void {
        const app = ctx.app_;
        if (!app || !app.hasResource(Assets)) return;

        const projectDir = ctx.pathResolver_.getProjectDir();
        if (!projectDir) return;

        const fs = getEditorContext().fs;
        if (!fs?.toAssetUrl) return;

        const assetServer = app.getResource(Assets);
        const assetBaseUrl = fs.toAssetUrl(projectDir);
        assetServer.baseUrl = assetBaseUrl;
        Audio.baseUrl = assetBaseUrl;

        const db = getAssetDatabase();
        assetServer.setAssetRefResolver((ref: string) => {
            if (isUUID(ref)) {
                return db.getPath(ref) ?? null;
            }
            return null;
        });
    }

    private async injectUserScripts(ctx: ReturnType<typeof getSharedRenderContext>): Promise<void> {
        const app = ctx.app_;
        if (!app) return;

        const editor = getEditorInstance();
        if (!editor) return;

        const compiledCode = editor.getCompiledScripts();
        if (!compiledCode) return;

        this.scriptInjector_ = new ScriptInjector();
        await this.scriptInjector_.inject(app, compiledCode);
    }

    private ejectUserScripts(): void {
        if (this.scriptInjector_) {
            this.scriptInjector_.eject();
            this.scriptInjector_ = null;
        }
    }

    private buildRuntimeEntityData(world: import('esengine').World): RuntimeEntityData[] {
        const entities = world.getAllEntities();
        const result: RuntimeEntityData[] = [];
        for (const entity of entities) {
            result.push(this.entityToRuntimeData(world, entity));
        }
        return result;
    }

    private entityToRuntimeData(world: import('esengine').World, entity: Entity): RuntimeEntityData {
        const nameData = world.tryGet(entity, Name);
        const parentData = world.tryGet(entity, Parent);
        const childrenData = world.tryGet(entity, Children);

        const componentTypes = world.getComponentTypes(entity);
        const components = componentTypes.map(type => {
            const comp = getComponent(type);
            if (!comp) return { type, data: {} };
            const data = world.tryGet(entity, comp);
            return { type, data: data ? { ...data } : {} };
        });

        const originalComps = this.entitySceneDataMap_?.get(entity as number);
        if (originalComps) {
            for (const comp of components) {
                const assetFields = getComponentAssetFields(comp.type);
                if (assetFields.length === 0) continue;
                const originalComp = originalComps.find(c => c.type === comp.type);
                if (!originalComp) continue;
                for (const field of assetFields) {
                    const originalValue = originalComp.data[field];
                    if (typeof originalValue === 'string' && originalValue) {
                        comp.data[field] = originalValue;
                    }
                }
            }
        }

        return {
            entityId: entity as number,
            name: nameData?.value
                ?? this.entityNameMap_?.get(entity as number)
                ?? `Entity ${entity}`,
            parentId: parentData?.entity ?? null,
            children: childrenData?.entities ? [...childrenData.entities] : [],
            components,
        };
    }

    private startSharedEntityTracking(ctx: ReturnType<typeof getSharedRenderContext>): void {
        const app = ctx.app_;
        if (!app) return;

        const world = app.world;
        this.sharedWorld_ = world;

        this.entityNameMap_ = new Map();
        this.entitySceneDataMap_ = new Map();
        const sm = ctx.sceneManager_;
        if (sm) {
            const scene = getEditorStore().scene;
            const entityMap = sm.getEntityMap();
            for (const [editorId, ecsEntity] of entityMap) {
                const ed = scene.entities.find(e => e.id === editorId);
                if (ed) {
                    this.entityNameMap_.set(ecsEntity as number, ed.name);
                    this.entitySceneDataMap_.set(ecsEntity as number, ed.components);
                }
            }
        }

        this.cachedEntities_ = this.buildRuntimeEntityData(world);
        this.emitEntityListUpdate();

        const unsubSpawn = world.onSpawn((entity: Entity) => {
            this.cachedEntities_ = this.buildRuntimeEntityData(world);
            this.emitEntityListUpdate();
        });

        const unsubDespawn = world.onDespawn((entity: Entity) => {
            if (this.selectedEntityId_ === (entity as number)) {
                this.selectedEntityId_ = null;
                this.emitSelectionChange();
            }
            this.cachedEntities_ = this.buildRuntimeEntityData(world);
            this.emitEntityListUpdate();
        });

        this.sharedCleanups_.push(unsubSpawn, unsubDespawn);
    }

    private emitStateChange(): void {
        for (const cb of this.stateListeners_) cb(this.state_);
    }

    private emitEntityListUpdate(): void {
        for (const cb of this.entityListListeners_) cb(this.cachedEntities_);
    }

    private emitSelectionChange(): void {
        for (const cb of this.selectionListeners_) cb(this.selectedEntityId_);
    }
}

import { getEditorContainer } from '../container/EditorContainer';
import { PLAY_MODE_SERVICE } from '../container/tokens';

export function getPlayModeService(): PlayModeService {
    return getEditorContainer().get(PLAY_MODE_SERVICE, 'default')!;
}
