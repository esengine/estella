import { describe, it, expect } from 'vitest';
import type { SceneData, EntityData } from '../../types/SceneTypes';
import { createEntityData } from '../../types/SceneTypes';
import { CommandRegistry } from '../../commands/Command';
import { PropertyCommand } from '../../commands/PropertyCommand';
import {
    CreateEntityCommand,
    DeleteEntityCommand,
    ReparentCommand,
    MoveEntityCommand,
    AddComponentCommand,
    RemoveComponentCommand,
    ReorderComponentCommand,
} from '../../commands/EntityCommands';
import { RenameEntityCommand } from '../../commands/RenameEntityCommand';
import { ToggleVisibilityCommand } from '../../commands/ToggleVisibilityCommand';
import { CompoundCommand } from '../../commands/CompoundCommand';

function makeScene(): { scene: SceneData; entityMap: Map<number, EntityData> } {
    const e1 = createEntityData(1, 'Player', null);
    e1.components.push({ type: 'Transform', data: { x: 0, y: 0 } });
    e1.children = [2];

    const e2 = createEntityData(2, 'Child', 1);
    e2.components.push({ type: 'Sprite', data: { color: 'red' } });
    e2.components.push({ type: 'Transform', data: { x: 10, y: 20 } });

    const scene: SceneData = { version: '1', name: 'Test', entities: [e1, e2] };
    const entityMap = new Map<number, EntityData>();
    entityMap.set(1, e1);
    entityMap.set(2, e2);
    return { scene, entityMap };
}

function roundTrip(
    cmd: import('../../commands/Command').Command,
    scene: SceneData,
    entityMap: Map<number, EntityData>,
) {
    const serialized = cmd.serialize();
    expect(serialized).not.toBeNull();
    const deserialized = CommandRegistry.deserialize(serialized!, scene, entityMap);
    expect(deserialized).not.toBeNull();
    return deserialized!;
}

describe('Command Serialization', () => {
    it('PropertyCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new PropertyCommand(scene, entityMap, 1, 'Transform', 'x', 0, 5);
        const restored = roundTrip(cmd, scene, entityMap);

        expect(restored.type).toBe('property');
        restored.execute();
        const comp = entityMap.get(1)!.components.find(c => c.type === 'Transform')!;
        expect(comp.data.x).toBe(5);

        restored.undo();
        expect(comp.data.x).toBe(0);
    });

    it('CreateEntityCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new CreateEntityCommand(scene, entityMap, 10, 'NewEntity', 1);
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(scene.entities.find(e => e.id === 10)).toBeTruthy();
        expect(entityMap.get(1)!.children).toContain(10);

        restored.undo();
        expect(scene.entities.find(e => e.id === 10)).toBeUndefined();
    });

    it('DeleteEntityCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new DeleteEntityCommand(scene, entityMap, 2);
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(scene.entities.find(e => e.id === 2)).toBeUndefined();

        restored.undo();
        expect(scene.entities.find(e => e.id === 2)).toBeTruthy();
    });

    it('ReparentCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new ReparentCommand(scene, entityMap, 2, null);
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(entityMap.get(2)!.parent).toBeNull();
        expect(entityMap.get(1)!.children).not.toContain(2);

        restored.undo();
        expect(entityMap.get(2)!.parent).toBe(1);
    });

    it('MoveEntityCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new MoveEntityCommand(scene, entityMap, 2, null, 0);
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(entityMap.get(2)!.parent).toBeNull();

        restored.undo();
        expect(entityMap.get(2)!.parent).toBe(1);
    });

    it('AddComponentCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new AddComponentCommand(scene, entityMap, 1, 'Health', { hp: 100 });
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        const comp = entityMap.get(1)!.components.find(c => c.type === 'Health');
        expect(comp).toBeTruthy();
        expect(comp!.data.hp).toBe(100);

        restored.undo();
        expect(entityMap.get(1)!.components.find(c => c.type === 'Health')).toBeUndefined();
    });

    it('RemoveComponentCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new RemoveComponentCommand(scene, entityMap, 1, 'Transform');
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(entityMap.get(1)!.components.find(c => c.type === 'Transform')).toBeUndefined();

        restored.undo();
        expect(entityMap.get(1)!.components.find(c => c.type === 'Transform')).toBeTruthy();
    });

    it('ReorderComponentCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new ReorderComponentCommand(scene, entityMap, 2, 0, 1);
        const restored = roundTrip(cmd, scene, entityMap);

        const components = entityMap.get(2)!.components;
        expect(components[0].type).toBe('Sprite');

        restored.execute();
        expect(components[0].type).toBe('Transform');
        expect(components[1].type).toBe('Sprite');

        restored.undo();
        expect(components[0].type).toBe('Sprite');
    });

    it('RenameEntityCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new RenameEntityCommand(scene, entityMap, 1, 'Player', 'Hero');
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(entityMap.get(1)!.name).toBe('Hero');

        restored.undo();
        expect(entityMap.get(1)!.name).toBe('Player');
    });

    it('ToggleVisibilityCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmd = new ToggleVisibilityCommand(scene, entityMap, 1);
        const restored = roundTrip(cmd, scene, entityMap);

        restored.execute();
        expect(entityMap.get(1)!.visible).toBe(false);

        restored.undo();
        expect(entityMap.get(1)!.visible).toBe(true);
    });

    it('CompoundCommand round-trip', () => {
        const { scene, entityMap } = makeScene();
        const cmds = [
            new PropertyCommand(scene, entityMap, 1, 'Transform', 'x', 0, 99),
            new RenameEntityCommand(scene, entityMap, 1, 'Player', 'Boss'),
        ];
        const compound = new CompoundCommand(cmds, 'Batch edit');
        const restored = roundTrip(compound, scene, entityMap);

        restored.execute();
        expect(entityMap.get(1)!.components.find(c => c.type === 'Transform')!.data.x).toBe(99);
        expect(entityMap.get(1)!.name).toBe('Boss');

        restored.undo();
        expect(entityMap.get(1)!.components.find(c => c.type === 'Transform')!.data.x).toBe(0);
        expect(entityMap.get(1)!.name).toBe('Player');
    });

    it('CompoundCommand returns null if child is non-serializable', () => {
        const { scene, entityMap } = makeScene();
        const mockNonSerializable = {
            id: 'x', type: 'fake', timestamp: 0, description: '', structural: false,
            execute() {}, undo() {},
            canMerge() { return false; }, merge() { return this; },
            updateEntityMap() {}, emitChangeEvents() {},
            serialize() { return null; },
        };
        const compound = new CompoundCommand(
            [mockNonSerializable, new PropertyCommand(scene, entityMap, 1, 'Transform', 'x', 0, 1)],
            'Mixed',
        );
        expect(compound.serialize()).toBeNull();
    });

    it('CommandRegistry.deserialize returns null for unknown type', () => {
        const { scene, entityMap } = makeScene();
        const result = CommandRegistry.deserialize(
            { type: 'unknown_type', data: {} },
            scene, entityMap,
        );
        expect(result).toBeNull();
    });
});
