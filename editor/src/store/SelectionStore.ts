import type { Entity } from 'esengine';
import type { EntityData } from '../types/SceneTypes';
import type { EditorEventBus, AssetSelection } from '../events/EditorEventBus';

export class SelectionStore {
    private selectedEntities_ = new Set<number>();
    private selectedAsset_: AssetSelection | null = null;
    private focusListeners_ = new Set<(entityId: number) => void>();
    private selectionListeners_ = new Set<() => void>();
    private bus_: EditorEventBus;
    private getEntityData_: (id: number) => EntityData | null;
    private getSceneEntities_: () => EntityData[];

    constructor(
        bus: EditorEventBus,
        getEntityData: (id: number) => EntityData | null,
        getSceneEntities: () => EntityData[],
    ) {
        this.bus_ = bus;
        this.getEntityData_ = getEntityData;
        this.getSceneEntities_ = getSceneEntities;
    }

    get selectedEntities(): ReadonlySet<number> {
        return this.selectedEntities_;
    }

    get selectedEntity(): Entity | null {
        if (this.selectedEntities_.size !== 1) return null;
        return this.selectedEntities_.values().next().value as Entity;
    }

    get selectedAsset(): AssetSelection | null {
        return this.selectedAsset_;
    }

    selectEntity(entity: Entity | null, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
        const sel = this.selectedEntities_;
        const oldSnapshot = new Set(sel);

        if (entity === null) {
            sel.clear();
        } else {
            const id = entity as number;
            if (mode === 'replace') {
                sel.clear();
                sel.add(id);
            } else if (mode === 'add') {
                sel.add(id);
            } else if (mode === 'toggle') {
                if (sel.has(id)) {
                    sel.delete(id);
                } else {
                    sel.add(id);
                }
            }
        }

        if (!this.setsEqual_(oldSnapshot, sel)) {
            this.selectedAsset_ = null;
            this.notifySelection_();
        }
    }

    selectEntities(entities: number[]): void {
        this.selectedEntities_.clear();
        for (const id of entities) {
            this.selectedEntities_.add(id);
        }
        this.selectedAsset_ = null;
        this.notifySelection_();
    }

    selectRange(fromEntity: number, toEntity: number): void {
        const flatList: number[] = [];
        const visited = new Set<number>();

        const traverse = (entityId: number | null) => {
            if (entityId === null) return;
            const entity = this.getEntityData_(entityId);
            if (!entity || visited.has(entityId)) return;
            visited.add(entityId);
            flatList.push(entityId);
            for (const childId of entity.children) {
                traverse(childId);
            }
        };

        for (const entity of this.getSceneEntities_()) {
            if (entity.parent === null) {
                traverse(entity.id);
            }
        }

        const fromIndex = flatList.indexOf(fromEntity);
        const toIndex = flatList.indexOf(toEntity);

        if (fromIndex === -1 || toIndex === -1) return;

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        this.selectEntities(flatList.slice(start, end + 1));
    }

    selectAsset(asset: AssetSelection | null): void {
        this.selectedAsset_ = asset;
        this.selectedEntities_.clear();
        this.bus_.emit('selection:asset', { asset });
        this.notifySelection_();
    }

    getSelectedEntityData(): EntityData | null {
        if (this.selectedEntities_.size !== 1) return null;
        const id = this.selectedEntities_.values().next().value as number;
        return this.getEntityData_(id);
    }

    getSelectedEntitiesData(): EntityData[] {
        const result: EntityData[] = [];
        for (const id of this.selectedEntities_) {
            const entity = this.getEntityData_(id);
            if (entity) {
                result.push(entity);
            }
        }
        return result;
    }

    focusEntity(entityId: number): void {
        this.bus_.emit('selection:focus', { entityId });
        for (const listener of this.focusListeners_) {
            listener(entityId);
        }
    }

    onFocusEntity(listener: (entityId: number) => void): () => void {
        this.focusListeners_.add(listener);
        return () => this.focusListeners_.delete(listener);
    }

    onSelectionChanged(listener: () => void): () => void {
        this.selectionListeners_.add(listener);
        return () => this.selectionListeners_.delete(listener);
    }

    removeFromSelection(entityId: number): void {
        if (this.selectedEntities_.delete(entityId)) {
            this.notifySelection_();
        }
    }

    clearSelection(): void {
        if (this.selectedEntities_.size > 0 || this.selectedAsset_ !== null) {
            this.selectedEntities_.clear();
            this.selectedAsset_ = null;
            this.notifySelection_();
        }
    }

    private notifySelection_(): void {
        this.bus_.emit('selection:changed', { entities: this.selectedEntities_ });
        for (const listener of this.selectionListeners_) {
            listener();
        }
    }

    private setsEqual_(a: Set<number>, b: Set<number>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }
}
