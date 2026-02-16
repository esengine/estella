import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorStore } from '../../store/EditorStore';
import type { Entity } from 'esengine';
import type { SceneData, EntityData } from '../../types/SceneTypes';
import { createEmptyScene } from '../../types/SceneTypes';

describe('EditorStore', () => {
    let store: EditorStore;

    beforeEach(() => {
        store = new EditorStore();
        store.newScene('Test Scene');
    });

    // =========================================================================
    // Scene Operations
    // =========================================================================

    describe('newScene', () => {
        it('creates scene with default entities', () => {
            expect(store.scene.name).toBe('Test Scene');
            expect(store.scene.entities.length).toBeGreaterThanOrEqual(2);
        });

        it('clears selection', () => {
            const entity = store.createEntity('Entity1');
            store.selectEntity(entity, 'replace');
            expect(store.selectedEntities.size).toBe(1);

            store.newScene('New Scene');
            expect(store.selectedEntities.size).toBe(0);
        });

        it('clears asset selection', () => {
            store.selectAsset({ path: 'test.png', type: 'image', name: 'test.png' });
            store.newScene('New Scene');
            expect(store.selectedAsset).toBeNull();
        });

        it('resets dirty flag', () => {
            store.createEntity('Entity1');
            expect(store.isDirty).toBe(true);

            store.newScene('New Scene');
            expect(store.isDirty).toBe(false);
        });

        it('clears file path', () => {
            store.loadScene(createEmptyScene(), '/path/to/scene.json');
            expect(store.filePath).toBe('/path/to/scene.json');

            store.newScene('New Scene');
            expect(store.filePath).toBeNull();
        });

        it('clears undo/redo history', () => {
            store.createEntity('Entity1');
            expect(store.canUndo).toBe(true);

            store.newScene('New Scene');
            expect(store.canUndo).toBe(false);
            expect(store.canRedo).toBe(false);
        });
    });

    describe('loadScene', () => {
        it('replaces scene data', () => {
            const scene = createEmptyScene('Loaded Scene');
            store.loadScene(scene, '/test/scene.json');

            expect(store.scene.name).toBe('Loaded Scene');
            expect(store.filePath).toBe('/test/scene.json');
        });

        it('clears selection on load', () => {
            const entity = store.createEntity('Entity1');
            store.selectEntity(entity, 'replace');

            store.loadScene(createEmptyScene(), null);
            expect(store.selectedEntities.size).toBe(0);
        });

        it('resets dirty flag on load', () => {
            store.createEntity('Entity1');

            store.loadScene(createEmptyScene(), null);
            expect(store.isDirty).toBe(false);
        });

        it('clears undo history on load', () => {
            store.createEntity('Entity1');

            store.loadScene(createEmptyScene(), null);
            expect(store.canUndo).toBe(false);
        });
    });

    describe('markSaved', () => {
        it('clears dirty flag', () => {
            store.createEntity('Entity1');
            expect(store.isDirty).toBe(true);

            store.markSaved();
            expect(store.isDirty).toBe(false);
        });

        it('updates file path when provided', () => {
            store.markSaved('/new/path.json');
            expect(store.filePath).toBe('/new/path.json');
        });

        it('keeps existing file path when not provided', () => {
            store.loadScene(createEmptyScene(), '/original/path.json');
            store.createEntity('Entity1');
            store.markSaved();

            expect(store.filePath).toBe('/original/path.json');
        });
    });

    // =========================================================================
    // Multi-Selection
    // =========================================================================

    describe('multi-selection', () => {
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

        it('selectEntities replaces entire selection', () => {
            const entity1 = store.createEntity('Entity1');
            const entity2 = store.createEntity('Entity2');
            const entity3 = store.createEntity('Entity3');

            store.selectEntity(entity1, 'replace');
            store.selectEntities([entity2 as number, entity3 as number]);

            expect(store.selectedEntities.size).toBe(2);
            expect(store.selectedEntities.has(entity1 as number)).toBe(false);
            expect(store.selectedEntities.has(entity2 as number)).toBe(true);
            expect(store.selectedEntities.has(entity3 as number)).toBe(true);
        });
    });

    // =========================================================================
    // Entity Operations
    // =========================================================================

    describe('entity operations', () => {
        it('creates entity with auto-generated name', () => {
            const entity = store.createEntity();
            const data = store.getEntityData(entity as number);
            expect(data).not.toBeNull();
            expect(data!.name).toMatch(/^Entity_\d+$/);
        });

        it('creates entity with specified name', () => {
            const entity = store.createEntity('Player');
            const data = store.getEntityData(entity as number);
            expect(data!.name).toBe('Player');
        });

        it('creates entity as child of parent', () => {
            const parent = store.createEntity('Parent');
            const child = store.createEntity('Child', parent);

            const childData = store.getEntityData(child as number);
            expect(childData!.parent).toBe(parent as number);

            const parentData = store.getEntityData(parent as number);
            expect(parentData!.children).toContain(child as number);
        });

        it('deletes entity and removes from scene', () => {
            const entity = store.createEntity('ToDelete');
            const entityId = entity as number;

            expect(store.scene.entities.find(e => e.id === entityId)).toBeDefined();

            store.deleteEntity(entity);

            expect(store.scene.entities.find(e => e.id === entityId)).toBeUndefined();
        });

        it('deletes entity with children removes all descendants', () => {
            const parent = store.createEntity('Parent');
            const child = store.createEntity('Child', parent);
            const grandchild = store.createEntity('Grandchild', child);

            store.deleteEntity(parent);

            expect(store.scene.entities.find(e => e.id === parent as number)).toBeUndefined();
            expect(store.scene.entities.find(e => e.id === child as number)).toBeUndefined();
            expect(store.scene.entities.find(e => e.id === grandchild as number)).toBeUndefined();
        });

        it('renames entity', () => {
            const entity = store.createEntity('OldName');
            store.renameEntity(entity, 'NewName');

            const data = store.getEntityData(entity as number);
            expect(data!.name).toBe('NewName');
        });

        it('marks scene dirty after entity operations', () => {
            store.newScene('Clean');
            expect(store.isDirty).toBe(false);

            store.createEntity('Entity1');
            expect(store.isDirty).toBe(true);
        });

        it('auto-selects newly created entity', () => {
            const entity = store.createEntity('New');
            expect(store.selectedEntity).toBe(entity);
        });
    });

    // =========================================================================
    // Component Operations
    // =========================================================================

    describe('component operations', () => {
        it('adds component to entity', () => {
            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { color: { r: 255, g: 255, b: 255, a: 255 } });

            const comp = store.getComponent(entity, 'Sprite');
            expect(comp).not.toBeNull();
            expect(comp!.type).toBe('Sprite');
        });

        it('updates property on component', () => {
            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { color: { r: 255, g: 255, b: 255, a: 255 } });

            store.updateProperty(entity, 'Sprite', 'color', { r: 255, g: 255, b: 255, a: 255 }, { r: 128, g: 0, b: 0, a: 255 });

            const comp = store.getComponent(entity, 'Sprite');
            expect(comp!.data.color).toEqual({ r: 128, g: 0, b: 0, a: 255 });
        });

        it('updatePropertyDirect changes value without undo support', () => {
            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { opacity: 1.0 });

            const undoCountBefore = store.canUndo;
            store.updatePropertyDirect(entity, 'Sprite', 'opacity', 0.5);

            const comp = store.getComponent(entity, 'Sprite');
            expect(comp!.data.opacity).toBe(0.5);
        });

        it('getComponent returns null for missing component', () => {
            const entity = store.createEntity('Entity1');
            expect(store.getComponent(entity, 'NonExistent')).toBeNull();
        });

        it('getComponent returns null for missing entity', () => {
            expect(store.getComponent(9999 as Entity, 'Sprite')).toBeNull();
        });

        it('updateProperties changes multiple properties at once', () => {
            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'LocalTransform', {
                position: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
            });

            store.updateProperties(entity, 'LocalTransform', [
                { property: 'position', oldValue: { x: 0, y: 0, z: 0 }, newValue: { x: 10, y: 20, z: 0 } },
                { property: 'scale', oldValue: { x: 1, y: 1, z: 1 }, newValue: { x: 2, y: 2, z: 2 } },
            ]);

            const comp = store.getComponent(entity, 'LocalTransform');
            expect(comp!.data.position).toEqual({ x: 10, y: 20, z: 0 });
            expect(comp!.data.scale).toEqual({ x: 2, y: 2, z: 2 });
        });
    });

    // =========================================================================
    // Entity Hierarchy
    // =========================================================================

    describe('entity hierarchy', () => {
        it('reparents entity to new parent', () => {
            const parent1 = store.createEntity('Parent1');
            const parent2 = store.createEntity('Parent2');
            const child = store.createEntity('Child', parent1);

            store.reparentEntity(child, parent2);

            const childData = store.getEntityData(child as number);
            expect(childData!.parent).toBe(parent2 as number);

            const parent1Data = store.getEntityData(parent1 as number);
            expect(parent1Data!.children).not.toContain(child as number);

            const parent2Data = store.getEntityData(parent2 as number);
            expect(parent2Data!.children).toContain(child as number);
        });

        it('reparents entity to root', () => {
            const parent = store.createEntity('Parent');
            const child = store.createEntity('Child', parent);

            store.reparentEntity(child, null);

            const childData = store.getEntityData(child as number);
            expect(childData!.parent).toBeNull();
        });
    });

    // =========================================================================
    // Undo/Redo
    // =========================================================================

    describe('undo/redo', () => {
        it('initially cannot undo or redo', () => {
            expect(store.canUndo).toBe(false);
            expect(store.canRedo).toBe(false);
        });

        it('can undo after creating entity', () => {
            store.createEntity('Entity1');
            expect(store.canUndo).toBe(true);
        });

        it('undo reverses entity creation', () => {
            const initialCount = store.scene.entities.length;
            const entity = store.createEntity('Entity1');

            expect(store.scene.entities.length).toBe(initialCount + 1);

            store.undo();

            expect(store.scene.entities.length).toBe(initialCount);
        });

        it('redo re-applies entity creation', () => {
            const initialCount = store.scene.entities.length;
            store.createEntity('Entity1');
            store.undo();

            expect(store.scene.entities.length).toBe(initialCount);

            store.redo();

            expect(store.scene.entities.length).toBe(initialCount + 1);
        });

        it('undo property change restores old value', () => {
            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { opacity: 1.0 });
            store.updateProperty(entity, 'Sprite', 'opacity', 1.0, 0.5);

            const comp = store.getComponent(entity, 'Sprite');
            expect(comp!.data.opacity).toBe(0.5);

            store.undo();

            const comp2 = store.getComponent(entity, 'Sprite');
            expect(comp2!.data.opacity).toBe(1.0);
        });

        it('redo property change applies new value', () => {
            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { opacity: 1.0 });
            store.updateProperty(entity, 'Sprite', 'opacity', 1.0, 0.5);
            store.undo();
            store.redo();

            const comp = store.getComponent(entity, 'Sprite');
            expect(comp!.data.opacity).toBe(0.5);
        });

        it('undo rename restores old name', () => {
            const entity = store.createEntity('OldName');
            store.renameEntity(entity, 'NewName');

            store.undo();

            const data = store.getEntityData(entity as number);
            expect(data!.name).toBe('OldName');
        });

        it('marks dirty after undo', () => {
            store.createEntity('Entity1');
            store.markSaved();
            expect(store.isDirty).toBe(false);

            store.undo();
            expect(store.isDirty).toBe(true);
        });

        it('marks dirty after redo', () => {
            store.createEntity('Entity1');
            store.undo();
            store.markSaved();

            store.redo();
            expect(store.isDirty).toBe(true);
        });
    });

    // =========================================================================
    // Subscriptions
    // =========================================================================

    describe('subscriptions', () => {
        it('subscribe returns unsubscribe function', () => {
            let callCount = 0;
            const unsubscribe = store.subscribe(() => callCount++);

            store.createEntity('Entity1');

            unsubscribe();
        });

        it('property change listener fires on updateProperty', () => {
            const events: Array<{ entity: number; componentType: string; propertyName: string }> = [];
            store.subscribeToPropertyChanges((event) => {
                events.push({ entity: event.entity, componentType: event.componentType, propertyName: event.propertyName });
            });

            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { opacity: 1.0 });
            store.updateProperty(entity, 'Sprite', 'opacity', 1.0, 0.5);

            expect(events.length).toBeGreaterThanOrEqual(1);
            const lastEvent = events[events.length - 1];
            expect(lastEvent.componentType).toBe('Sprite');
            expect(lastEvent.propertyName).toBe('opacity');
        });

        it('hierarchy change listener fires on reparent', () => {
            const events: Array<{ entity: number; newParent: number | null }> = [];
            store.subscribeToHierarchyChanges((event) => {
                events.push({ entity: event.entity, newParent: event.newParent });
            });

            const parent = store.createEntity('Parent');
            const child = store.createEntity('Child');
            store.reparentEntity(child, parent);

            expect(events.length).toBe(1);
            expect(events[0].entity).toBe(child as number);
            expect(events[0].newParent).toBe(parent as number);
        });

        it('entity lifecycle listener fires on create/delete', () => {
            const events: Array<{ entity: number; type: string }> = [];
            store.subscribeToEntityLifecycle((event) => {
                events.push({ entity: event.entity, type: event.type });
            });

            const entity = store.createEntity('Entity1');
            store.deleteEntity(entity);

            expect(events.length).toBe(2);
            expect(events[0].type).toBe('created');
            expect(events[1].type).toBe('deleted');
        });

        it('component change listener fires on add/remove', () => {
            const events: Array<{ entity: number; componentType: string; action: string }> = [];
            store.subscribeToComponentChanges((event) => {
                events.push({ entity: event.entity, componentType: event.componentType, action: event.action });
            });

            const entity = store.createEntity('Entity1');
            store.addComponent(entity, 'Sprite', { opacity: 1.0 });

            expect(events.length).toBe(1);
            expect(events[0].action).toBe('added');
            expect(events[0].componentType).toBe('Sprite');
        });

        it('unsubscribe stops notifications', () => {
            let callCount = 0;
            const unsubscribe = store.subscribeToEntityLifecycle(() => callCount++);

            store.createEntity('Entity1');
            expect(callCount).toBe(1);

            unsubscribe();
            store.createEntity('Entity2');
            expect(callCount).toBe(1);
        });

        it('focus entity listener fires', () => {
            const focusedEntities: number[] = [];
            store.onFocusEntity((id) => focusedEntities.push(id));

            const entity = store.createEntity('Entity1');
            store.focusEntity(entity as number);

            expect(focusedEntities).toContain(entity as number);
        });

        it('visibility listener fires on toggle', () => {
            const events: Array<{ entity: number; visible: boolean }> = [];
            store.subscribeToVisibilityChanges((event) => {
                events.push({ entity: event.entity, visible: event.visible });
            });

            const entity = store.createEntity('Entity1');
            store.toggleVisibility(entity as number);

            expect(events.length).toBeGreaterThanOrEqual(1);
        });
    });

    // =========================================================================
    // Visibility
    // =========================================================================

    describe('visibility', () => {
        it('entity is visible by default', () => {
            const entity = store.createEntity('Entity1');
            expect(store.isEntityVisible(entity as number)).toBe(true);
        });

        it('toggleVisibility hides visible entity', () => {
            const entity = store.createEntity('Entity1');
            store.toggleVisibility(entity as number);

            expect(store.isEntityVisible(entity as number)).toBe(false);
        });

        it('toggleVisibility shows hidden entity', () => {
            const entity = store.createEntity('Entity1');
            store.toggleVisibility(entity as number);
            store.toggleVisibility(entity as number);

            expect(store.isEntityVisible(entity as number)).toBe(true);
        });

        it('returns true for non-existent entity (no data means not explicitly hidden)', () => {
            expect(store.isEntityVisible(99999)).toBe(true);
        });
    });

    // =========================================================================
    // Scene Version
    // =========================================================================

    describe('scene version', () => {
        it('is a non-negative integer', () => {
            expect(store.sceneVersion).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(store.sceneVersion)).toBe(true);
        });
    });

    // =========================================================================
    // Entity Data Access
    // =========================================================================

    describe('entity data access', () => {
        it('getEntityData returns data for existing entity', () => {
            const entity = store.createEntity('TestEntity');
            const data = store.getEntityData(entity as number);

            expect(data).not.toBeNull();
            expect(data!.name).toBe('TestEntity');
            expect(data!.id).toBe(entity as number);
        });

        it('getEntityData returns null for non-existent entity', () => {
            expect(store.getEntityData(99999)).toBeNull();
        });

        it('getSelectedEntitiesData returns data for all selected', () => {
            const e1 = store.createEntity('E1');
            const e2 = store.createEntity('E2');
            const e3 = store.createEntity('E3');

            store.selectEntities([e1 as number, e2 as number, e3 as number]);

            const data = store.getSelectedEntitiesData();
            expect(data.length).toBe(3);
        });

        it('getSelectedEntitiesData filters out invalid entities', () => {
            const e1 = store.createEntity('E1');
            store.selectEntities([e1 as number, 99999]);

            const data = store.getSelectedEntitiesData();
            expect(data.length).toBe(1);
        });
    });

    // =========================================================================
    // Prefab-related queries (without async)
    // =========================================================================

    describe('prefab queries', () => {
        it('isPrefabInstance returns false for normal entities', () => {
            const entity = store.createEntity('Entity1');
            expect(store.isPrefabInstance(entity as number)).toBe(false);
        });

        it('isPrefabRoot returns false for normal entities', () => {
            const entity = store.createEntity('Entity1');
            expect(store.isPrefabRoot(entity as number)).toBe(false);
        });

        it('getPrefabInstanceId returns undefined for normal entities', () => {
            const entity = store.createEntity('Entity1');
            expect(store.getPrefabInstanceId(entity as number)).toBeUndefined();
        });

        it('getPrefabPath returns undefined for normal entities', () => {
            const entity = store.createEntity('Entity1');
            expect(store.getPrefabPath(entity as number)).toBeUndefined();
        });

        it('isEditingPrefab is false initially', () => {
            expect(store.isEditingPrefab).toBe(false);
            expect(store.prefabEditingPath).toBeNull();
        });
    });

    // =========================================================================
    // Integration: Scene Create -> Edit -> Save -> Reload -> Verify
    // =========================================================================

    describe('integration: scene lifecycle', () => {
        it('create entities, modify, save, reload, verify', () => {
            store.newScene('Integration Test');

            const entity1 = store.createEntity('Player');
            const entity2 = store.createEntity('Enemy');
            const entity3 = store.createEntity('Weapon', entity1);

            store.addComponent(entity1, 'Sprite', { opacity: 1.0, color: { r: 255, g: 0, b: 0, a: 255 } });
            store.addComponent(entity2, 'Sprite', { opacity: 0.5 });

            store.updateProperty(entity1, 'Sprite', 'opacity', 1.0, 0.8);
            store.renameEntity(entity2, 'Boss');

            const sceneCopy: SceneData = JSON.parse(JSON.stringify(store.scene));

            store.markSaved('/test/integration.json');
            expect(store.isDirty).toBe(false);

            store.loadScene(sceneCopy, '/test/integration.json');

            expect(store.scene.name).toBe('Integration Test');
            expect(store.filePath).toBe('/test/integration.json');

            const playerData = store.scene.entities.find(e => e.name === 'Player');
            expect(playerData).toBeDefined();
            const playerSprite = playerData!.components.find(c => c.type === 'Sprite');
            expect(playerSprite).toBeDefined();
            expect(playerSprite!.data.opacity).toBe(0.8);

            const bossData = store.scene.entities.find(e => e.name === 'Boss');
            expect(bossData).toBeDefined();

            const weaponData = store.scene.entities.find(e => e.name === 'Weapon');
            expect(weaponData).toBeDefined();
            expect(weaponData!.parent).toBe(playerData!.id);
        });

        it('undo/redo across multiple operation types', () => {
            const entity = store.createEntity('Player');
            store.addComponent(entity, 'Sprite', { opacity: 1.0 });
            store.updateProperty(entity, 'Sprite', 'opacity', 1.0, 0.5);
            store.renameEntity(entity, 'Hero');

            expect(store.getEntityData(entity as number)!.name).toBe('Hero');

            store.undo();
            expect(store.getEntityData(entity as number)!.name).toBe('Player');

            store.undo();
            expect(store.getComponent(entity, 'Sprite')!.data.opacity).toBe(1.0);

            store.redo();
            expect(store.getComponent(entity, 'Sprite')!.data.opacity).toBe(0.5);

            store.redo();
            expect(store.getEntityData(entity as number)!.name).toBe('Hero');
        });

        it('hierarchy operations with undo', () => {
            const parent = store.createEntity('Parent');
            const child = store.createEntity('Child');

            store.reparentEntity(child, parent);

            expect(store.getEntityData(child as number)!.parent).toBe(parent as number);
            expect(store.getEntityData(parent as number)!.children).toContain(child as number);

            store.undo();

            expect(store.getEntityData(child as number)!.parent).toBeNull();
            expect(store.getEntityData(parent as number)!.children).not.toContain(child as number);
        });

        it('delete entity with undo preserves data', () => {
            const entity = store.createEntity('ToDelete');
            store.addComponent(entity, 'Sprite', { opacity: 0.5 });
            const entityId = entity as number;

            store.deleteEntity(entity);
            expect(store.scene.entities.find(e => e.id === entityId)).toBeUndefined();

            store.undo();
            expect(store.scene.entities.find(e => e.id === entityId)).toBeDefined();

            const restored = store.getEntityData(entityId);
            expect(restored!.name).toBe('ToDelete');
            const comp = restored!.components.find(c => c.type === 'Sprite');
            expect(comp).toBeDefined();
            expect(comp!.data.opacity).toBe(0.5);
        });

        it('multiple entity deletion with compound undo', () => {
            const initialCount = store.scene.entities.length;
            const e1 = store.createEntity('E1');
            const e2 = store.createEntity('E2');
            const e3 = store.createEntity('E3');

            store.selectEntity(e1, 'replace');
            store.selectEntity(e2, 'add');
            store.selectEntity(e3, 'add');

            store.deleteSelectedEntities();
            expect(store.scene.entities.length).toBe(initialCount);

            store.undo();
            expect(store.scene.entities.length).toBe(initialCount + 3);
        });
    });
});
