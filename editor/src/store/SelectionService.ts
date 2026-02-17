import type { Entity } from 'esengine';
import type { EntityData } from '../types/SceneTypes';
import type { AssetSelection, DirtyFlag } from './EditorStore';

export interface SelectionHost {
    readonly state_: {
        selectedEntities: Set<number>;
        selectedAsset: AssetSelection | null;
        scene: { entities: EntityData[] };
    };
    readonly entityMap_: Map<number, EntityData>;
    notify(flag: DirtyFlag): void;
}

export class SelectionService {
    private host_: SelectionHost;
    private focusListeners_ = new Set<(entityId: number) => void>();

    constructor(host: SelectionHost) {
        this.host_ = host;
    }

    selectEntity(entity: Entity | null, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
        const sel = this.host_.state_.selectedEntities;
        const oldSize = sel.size;
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

        if (!this.setsEqual(oldSnapshot, sel)) {
            this.host_.state_.selectedAsset = null;
            this.host_.notify('selection');
        }
    }

    selectEntities(entities: number[]): void {
        const sel = this.host_.state_.selectedEntities;
        sel.clear();
        for (const id of entities) {
            sel.add(id);
        }
        this.host_.state_.selectedAsset = null;
        this.host_.notify('selection');
    }

    selectRange(fromEntity: number, toEntity: number): void {
        const flatList: number[] = [];
        const visited = new Set<number>();

        const traverse = (entityId: number | null) => {
            if (entityId === null) return;
            const entity = this.host_.entityMap_.get(entityId);
            if (!entity || visited.has(entityId)) return;
            visited.add(entityId);
            flatList.push(entityId);
            for (const childId of entity.children) {
                traverse(childId);
            }
        };

        for (const entity of this.host_.state_.scene.entities) {
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
        this.host_.state_.selectedAsset = asset;
        this.host_.state_.selectedEntities.clear();
        this.host_.notify('selection');
    }

    getSelectedEntityData(): EntityData | null {
        const sel = this.host_.state_.selectedEntities;
        if (sel.size !== 1) return null;
        const id = sel.values().next().value as number;
        return this.host_.entityMap_.get(id) ?? null;
    }

    getSelectedEntitiesData(): EntityData[] {
        const result: EntityData[] = [];
        for (const id of this.host_.state_.selectedEntities) {
            const entity = this.host_.entityMap_.get(id);
            if (entity) {
                result.push(entity);
            }
        }
        return result;
    }

    focusEntity(entityId: number): void {
        for (const listener of this.focusListeners_) {
            listener(entityId);
        }
    }

    onFocusEntity(listener: (entityId: number) => void): () => void {
        this.focusListeners_.add(listener);
        return () => this.focusListeners_.delete(listener);
    }

    private setsEqual(a: Set<number>, b: Set<number>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }
}
