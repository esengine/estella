import type { Entity } from 'esengine';
import type { EntityData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import { generateUniqueName } from '../utils/naming';

export class ClipboardService {
    private clipboard_: EntityData[] | null = null;
    private store_: EditorStore;

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    duplicateSelected(): void {
        const selected = Array.from(this.store_.selectedEntities);
        if (selected.length === 0) return;

        for (const id of selected) {
            const entityData = this.store_.getEntityData(id);
            if (!entityData) continue;

            const scene = this.store_.scene;
            const siblings = scene.entities
                .filter(e => e.parent === entityData.parent)
                .map(e => e.name);
            const siblingNames = new Set(siblings);
            const newName = generateUniqueName(entityData.name, siblingNames);

            const newEntity = this.store_.createEntity(
                newName,
                entityData.parent as Entity | null
            );

            for (const comp of entityData.components) {
                this.store_.addComponent(newEntity, comp.type, JSON.parse(JSON.stringify(comp.data)));
            }
        }
    }

    copySelected(): void {
        const selected = Array.from(this.store_.selectedEntities);
        if (selected.length === 0) return;

        const allTrees: EntityData[] = [];
        for (const id of selected) {
            const tree = this.collectEntityTree_(id);
            allTrees.push(...tree);
        }
        if (allTrees.length === 0) return;

        this.clipboard_ = JSON.parse(JSON.stringify(allTrees));
        for (const e of this.clipboard_!) {
            delete e.prefab;
        }
    }

    pasteEntity(): void {
        if (!this.clipboard_ || this.clipboard_.length === 0) return;

        const cloned: EntityData[] = JSON.parse(JSON.stringify(this.clipboard_));
        const parent = this.store_.selectedEntity;
        const clipboardIds = new Set(cloned.map(e => e.id));
        const oldIdToNewId = new Map<number, Entity>();

        const scene = this.store_.scene;
        const siblings = scene.entities
            .filter(e => e.parent === (parent as number | null))
            .map(e => e.name);
        const siblingNames = new Set(siblings);

        let lastRoot: Entity | null = null;

        for (const entityData of cloned) {
            const isRoot = entityData.parent === null || !clipboardIds.has(entityData.parent);
            const newParent = isRoot ? parent : (oldIdToNewId.get(entityData.parent!) ?? null);
            if (!isRoot && newParent === null) continue;

            const name = isRoot
                ? generateUniqueName(entityData.name, siblingNames)
                : entityData.name;

            const newEntity = this.store_.createEntity(name, newParent);
            oldIdToNewId.set(entityData.id, newEntity);

            if (isRoot) {
                siblingNames.add(name);
                lastRoot = newEntity;
            }

            for (const comp of entityData.components) {
                this.store_.addComponent(newEntity, comp.type, { ...comp.data });
            }
        }

        if (lastRoot !== null) {
            this.store_.selectEntity(lastRoot);
        }
    }

    hasClipboard(): boolean {
        return this.clipboard_ !== null && this.clipboard_.length > 0;
    }

    private collectEntityTree_(entityId: number): EntityData[] {
        const entity = this.store_.getEntityData(entityId);
        if (!entity) return [];
        const result: EntityData[] = [entity];
        for (const childId of entity.children) {
            result.push(...this.collectEntityTree_(childId));
        }
        return result;
    }
}
