import { describe, it, expect, beforeEach } from 'vitest';
import { EditorStore } from '../../store/EditorStore';
import type { Entity } from 'esengine';

describe('EditorStore multi-selection', () => {
    let store: EditorStore;

    beforeEach(() => {
        store = new EditorStore();
        store.newScene('Test Scene');
    });

    it('initializes with empty selection', () => {
        expect(store.selectedEntities.size).toBe(0);
        expect(store.selectedEntity).toBeNull();
    });

    it('selects single entity with replace mode', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');

        store.selectEntity(entity1, 'replace');
        expect(store.selectedEntities.size).toBe(1);
        expect(store.selectedEntities.has(entity1 as number)).toBe(true);
        expect(store.selectedEntity).toBe(entity1);

        store.selectEntity(entity2, 'replace');
        expect(store.selectedEntities.size).toBe(1);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);
        expect(store.selectedEntities.has(entity1 as number)).toBe(false);
    });

    it('adds entities with add mode', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');
        const entity3 = store.createEntity('Entity3');

        store.selectEntity(entity1, 'replace');
        store.selectEntity(entity2, 'add');
        store.selectEntity(entity3, 'add');

        expect(store.selectedEntities.size).toBe(3);
        expect(store.selectedEntities.has(entity1 as number)).toBe(true);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);
        expect(store.selectedEntities.has(entity3 as number)).toBe(true);
        expect(store.selectedEntity).toBeNull();
    });

    it('toggles entities with toggle mode', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');

        store.selectEntity(entity1, 'replace');
        expect(store.selectedEntities.size).toBe(1);

        store.selectEntity(entity2, 'toggle');
        expect(store.selectedEntities.size).toBe(2);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);

        store.selectEntity(entity1, 'toggle');
        expect(store.selectedEntities.size).toBe(1);
        expect(store.selectedEntities.has(entity1 as number)).toBe(false);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);
    });

    it('selects range of entities', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');
        const entity3 = store.createEntity('Entity3');
        const entity4 = store.createEntity('Entity4');

        store.selectRange(entity1 as number, entity3 as number);

        expect(store.selectedEntities.size).toBe(3);
        expect(store.selectedEntities.has(entity1 as number)).toBe(true);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);
        expect(store.selectedEntities.has(entity3 as number)).toBe(true);
        expect(store.selectedEntities.has(entity4 as number)).toBe(false);
    });

    it('selects range in reverse order', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');
        const entity3 = store.createEntity('Entity3');

        store.selectRange(entity3 as number, entity1 as number);

        expect(store.selectedEntities.size).toBe(3);
        expect(store.selectedEntities.has(entity1 as number)).toBe(true);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);
        expect(store.selectedEntities.has(entity3 as number)).toBe(true);
    });

    it('clears selection when selecting null', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');

        store.selectEntity(entity1, 'replace');
        store.selectEntity(entity2, 'add');
        expect(store.selectedEntities.size).toBe(2);

        store.selectEntity(null);
        expect(store.selectedEntities.size).toBe(0);
        expect(store.selectedEntity).toBeNull();
    });

    it('clears selection when selecting asset', () => {
        const entity1 = store.createEntity('Entity1');

        store.selectEntity(entity1, 'replace');
        expect(store.selectedEntities.size).toBe(1);

        store.selectAsset({ path: 'test.png', type: 'image', name: 'test.png' });
        expect(store.selectedEntities.size).toBe(0);
    });

    it('removes deleted entity from selection', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');

        store.selectEntity(entity1, 'replace');
        store.selectEntity(entity2, 'add');
        expect(store.selectedEntities.size).toBe(2);

        store.deleteEntity(entity1);
        expect(store.selectedEntities.size).toBe(1);
        expect(store.selectedEntities.has(entity2 as number)).toBe(true);
    });

    it('deletes all selected entities', () => {
        const initialCount = store.scene.entities.length;
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');
        const entity3 = store.createEntity('Entity3');

        store.selectEntity(entity1, 'replace');
        store.selectEntity(entity2, 'add');

        expect(store.scene.entities.length).toBe(initialCount + 3);
        store.deleteSelectedEntities();

        expect(store.scene.entities.length).toBe(initialCount + 1);
        expect(store.selectedEntities.size).toBe(0);
        expect(store.scene.entities.find(e => e.id === entity3 as number)).toBeDefined();
    });

    it('returns single entity for single selection', () => {
        const entity1 = store.createEntity('Entity1');

        store.selectEntity(entity1, 'replace');
        expect(store.selectedEntity).toBe(entity1);

        const entityData = store.getSelectedEntityData();
        expect(entityData).toBeDefined();
        expect(entityData?.id).toBe(entity1 as number);
    });

    it('returns null for multi-selection', () => {
        const entity1 = store.createEntity('Entity1');
        const entity2 = store.createEntity('Entity2');

        store.selectEntity(entity1, 'replace');
        store.selectEntity(entity2, 'add');

        expect(store.selectedEntity).toBeNull();
        expect(store.getSelectedEntityData()).toBeNull();

        const entitiesData = store.getSelectedEntitiesData();
        expect(entitiesData.length).toBe(2);
    });
});
