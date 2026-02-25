import type { Entity } from 'esengine';
import type { GameViewBridge, RuntimeEntityData } from '../panels/game-view/GameViewBridge';
import type { EditorStore } from '../store/EditorStore';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { getPlayModeService } from './PlayModeService';

export class RuntimeStoreProxy {
    private bridge_: GameViewBridge;
    private editorStore_: EditorStore;
    private runtimeCache_ = new Map<number, Record<string, Record<string, unknown>>>();
    private pendingWrites_ = new Map<string, { value: unknown; stale: boolean }>();

    constructor(bridge: GameViewBridge, editorStore: EditorStore) {
        this.bridge_ = bridge;
        this.editorStore_ = editorStore;
    }

    get scene(): SceneData {
        return this.editorStore_.scene;
    }

    get selectedEntities(): ReadonlySet<number> {
        return this.editorStore_.selectedEntities;
    }

    get selectedEntity(): Entity | null {
        return this.editorStore_.selectedEntity;
    }

    get selectedAsset() {
        return null;
    }

    get isEditingPrefab(): boolean {
        return false;
    }

    get prefabEditingPath(): string | null {
        return null;
    }

    getEntityData(entityId: number): EntityData | null {
        const pms = getPlayModeService();
        const runtimeData = pms.getRuntimeEntityData(entityId);
        if (runtimeData) {
            const cache = this.runtimeCache_.get(entityId);
            let components = runtimeData.components;
            if (cache) {
                components = components.map(comp => {
                    const runtimeValues = cache[comp.type];
                    if (!runtimeValues) return comp;
                    return { type: comp.type, data: { ...comp.data, ...runtimeValues } };
                });
            }

            const prefix = `${entityId}:`;
            for (const [key, pw] of this.pendingWrites_) {
                if (!key.startsWith(prefix)) continue;
                for (let i = 0; i < components.length; i++) {
                    const compPrefix = `${entityId}:${components[i].type}:`;
                    if (key.startsWith(compPrefix)) {
                        const prop = key.slice(compPrefix.length);
                        components[i] = {
                            type: components[i].type,
                            data: { ...components[i].data, [prop]: pw.value },
                        };
                    }
                }
            }

            return { ...runtimeData, components };
        }
        return null;
    }

    getSelectedEntityData(): EntityData | null {
        const entity = this.selectedEntity;
        if (entity === null) return null;
        return this.getEntityData(entity as number);
    }

    getSelectedEntitiesData(): EntityData[] {
        const result: EntityData[] = [];
        for (const id of this.selectedEntities) {
            const data = this.getEntityData(id);
            if (data) result.push(data);
        }
        return result;
    }

    isEntityVisible(_entityId: number): boolean {
        return true;
    }

    getComponent(entity: Entity, type: string): ComponentData | null {
        const data = this.getEntityData(entity as number);
        return data?.components.find(c => c.type === type) ?? null;
    }

    updateProperty(
        entity: Entity,
        componentType: string,
        propertyName: string,
        _oldValue: unknown,
        newValue: unknown,
    ): void {
        this.recordPendingWrite(entity as number, componentType, propertyName, newValue);
        this.bridge_.setEntityProperty(entity as number, componentType, propertyName, newValue);
    }

    updateProperties(
        entity: Entity,
        componentType: string,
        changes: { property: string; oldValue: unknown; newValue: unknown }[],
    ): void {
        for (const change of changes) {
            this.recordPendingWrite(entity as number, componentType, change.property, change.newValue);
            this.bridge_.setEntityProperty(entity as number, componentType, change.property, change.newValue);
        }
    }

    updatePropertyDirect(
        entity: Entity,
        componentType: string,
        propertyName: string,
        newValue: unknown,
    ): void {
        this.recordPendingWrite(entity as number, componentType, propertyName, newValue);
        this.bridge_.setEntityProperty(entity as number, componentType, propertyName, newValue);
    }

    renameEntity(entity: Entity, name: string): void {
        const pms = getPlayModeService();
        pms.renameEntity(entity as number, name);
    }

    toggleVisibility(_entityId: number): void {
        // visibility toggle not applicable in play mode
    }

    removeComponent(entity: Entity, type: string): void {
        const pms = getPlayModeService();
        pms.removeComponent(entity as number, type);
    }

    reorderComponent(_entity: Entity, _fromIndex: number, _toIndex: number): void {
        // reorder not supported via bridge
    }

    addComponent(entity: Entity, type: string, data: Record<string, unknown>): void {
        const pms = getPlayModeService();
        pms.addComponent(entity as number, type, data);
    }

    deleteEntity(entity: Entity): void {
        const pms = getPlayModeService();
        pms.despawnEntity(entity as number);
    }

    createEntity(name?: string, parent?: Entity | null): Entity {
        const pms = getPlayModeService();
        const parentId = parent != null ? Number(parent) : null;
        pms.spawnEntity(name, parentId);
        return 0 as Entity;
    }

    selectEntity(entity: Entity | null, _mode?: 'replace' | 'add' | 'toggle'): void {
        this.editorStore_.selectEntity(entity, _mode);
    }

    selectEntities(entities: number[]): void {
        this.editorStore_.selectEntities(entities);
    }

    focusEntity(entityId: number): void {
        this.editorStore_.focusEntity(entityId);
    }

    onFocusEntity(listener: (entityId: number) => void): () => void {
        return this.editorStore_.onFocusEntity(listener);
    }

    subscribe(listener: any): () => void {
        return this.editorStore_.subscribe(listener);
    }

    subscribeToPropertyChanges(listener: any): () => void {
        return this.editorStore_.subscribeToPropertyChanges(listener);
    }

    isPrefabInstance(_entityId: number): boolean {
        return false;
    }

    isPrefabRoot(_entityId: number): boolean {
        return false;
    }

    getPrefabInstanceId(_entityId: number): string | undefined {
        return undefined;
    }

    getPrefabPath(_entityId: number): string | undefined {
        return undefined;
    }

    prepareForQuery(entityId: number): void {
        const prefix = `${entityId}:`;
        for (const [key, pw] of this.pendingWrites_) {
            if (key.startsWith(prefix)) {
                pw.stale = true;
            }
        }
    }

    applyRuntimeData(entityId: number, runtimeEntity: RuntimeEntityData): void {
        const prefix = `${entityId}:`;
        for (const [key, pw] of this.pendingWrites_) {
            if (key.startsWith(prefix) && pw.stale) {
                this.pendingWrites_.delete(key);
            }
        }

        const compCache: Record<string, Record<string, unknown>> = {};
        for (const comp of runtimeEntity.components) {
            compCache[comp.type] = comp.data;
        }
        this.runtimeCache_.set(entityId, compCache);
    }

    clearCache(): void {
        this.runtimeCache_.clear();
        this.pendingWrites_.clear();
    }

    private pendingKey(entityId: number, componentType: string, propertyName: string): string {
        return `${entityId}:${componentType}:${propertyName}`;
    }

    private recordPendingWrite(entityId: number, componentType: string, propertyName: string, value: unknown): void {
        const key = this.pendingKey(entityId, componentType, propertyName);
        this.pendingWrites_.set(key, { value, stale: false });
    }
}
