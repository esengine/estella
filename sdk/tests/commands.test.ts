import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandsInstance, EntityCommands, Commands } from '../src/commands';
import { defineComponent, defineBuiltin } from '../src/component';
import { defineResource, ResourceStorage } from '../src/resource';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

const Position = defineComponent('CmdTestPosition', { x: 0, y: 0 });
const Velocity = defineComponent('CmdTestVelocity', { dx: 0, dy: 0 });
const Health = defineBuiltin('CmdTestHealth', { value: 100, max: 100 });

function createMockWorld() {
    let nextId = 1;
    const validEntities = new Set<Entity>();
    const components = new Map<Entity, Map<string, any>>();

    const world = {
        spawn: vi.fn(() => {
            const entity = nextId++ as Entity;
            validEntities.add(entity);
            components.set(entity, new Map());
            return entity;
        }),
        despawn: vi.fn((entity: Entity) => {
            validEntities.delete(entity);
            components.delete(entity);
        }),
        insert: vi.fn((entity: Entity, comp: any, data: any) => {
            components.get(entity)?.set(comp._name, data);
        }),
        remove: vi.fn((entity: Entity, comp: any) => {
            components.get(entity)?.delete(comp._name);
        }),
        valid: vi.fn((entity: Entity) => validEntities.has(entity)),
    };

    return { world: world as unknown as World, validEntities, components };
}

describe('Commands descriptor', () => {
    it('should create a commands descriptor', () => {
        const desc = Commands();
        expect(desc._type).toBe('commands');
    });
});

describe('CommandsInstance', () => {
    let world: World;
    let mockWorld: ReturnType<typeof createMockWorld>;
    let resources: ResourceStorage;
    let commands: CommandsInstance;

    beforeEach(() => {
        mockWorld = createMockWorld();
        world = mockWorld.world;
        resources = new ResourceStorage();
        commands = new CommandsInstance(world, resources);
    });

    describe('spawn', () => {
        it('should return an EntityCommands builder', () => {
            const ec = commands.spawn();
            expect(ec).toBeInstanceOf(EntityCommands);
        });

        it('should spawn entity on flush', () => {
            commands.spawn();
            commands.flush();

            expect(world.spawn).toHaveBeenCalledOnce();
        });

        it('should spawn entity with components on flush', () => {
            commands.spawn()
                .insert(Position, { x: 10, y: 20 });
            commands.flush();

            expect(world.spawn).toHaveBeenCalledOnce();
            expect(world.insert).toHaveBeenCalledWith(
                1,
                Position,
                expect.objectContaining({ x: 10, y: 20 }),
            );
        });

        it('should spawn multiple entities', () => {
            commands.spawn().insert(Position, { x: 1, y: 1 });
            commands.spawn().insert(Position, { x: 2, y: 2 });
            commands.flush();

            expect(world.spawn).toHaveBeenCalledTimes(2);
            expect(world.insert).toHaveBeenCalledTimes(2);
        });

        it('should support chaining multiple insert calls', () => {
            commands.spawn()
                .insert(Position, { x: 1, y: 2 })
                .insert(Velocity, { dx: 3, dy: 4 });
            commands.flush();

            expect(world.insert).toHaveBeenCalledTimes(2);
        });
    });

    describe('spawn with builtin component', () => {
        it('should merge data with builtin defaults', () => {
            commands.spawn().insert(Health, { value: 50 });
            commands.flush();

            expect(world.insert).toHaveBeenCalledWith(
                1,
                Health,
                expect.objectContaining({ value: 50, max: 100 }),
            );
        });

        it('should use full defaults when no data provided', () => {
            commands.spawn().insert(Health);
            commands.flush();

            expect(world.insert).toHaveBeenCalledWith(
                1,
                Health,
                expect.objectContaining({ value: 100, max: 100 }),
            );
        });
    });

    describe('spawn with user-defined component', () => {
        it('should call create() with partial data', () => {
            commands.spawn().insert(Position, { x: 42 });
            commands.flush();

            expect(world.insert).toHaveBeenCalledWith(
                1,
                Position,
                expect.objectContaining({ x: 42, y: 0 }),
            );
        });

        it('should call create() with full defaults when no data', () => {
            commands.spawn().insert(Position);
            commands.flush();

            expect(world.insert).toHaveBeenCalledWith(
                1,
                Position,
                expect.objectContaining({ x: 0, y: 0 }),
            );
        });
    });

    describe('entity (existing)', () => {
        it('should insert component on existing entity immediately queued', () => {
            const entity = (world.spawn as any)() as Entity;
            commands.entity(entity).insert(Position, { x: 5, y: 10 });
            commands.flush();

            expect(world.insert).toHaveBeenCalledWith(
                entity,
                Position,
                expect.objectContaining({ x: 5, y: 10 }),
            );
        });

        it('should remove component from existing entity', () => {
            const entity = (world.spawn as any)() as Entity;
            commands.entity(entity).remove(Position);
            commands.flush();

            expect(world.remove).toHaveBeenCalledWith(entity, Position);
        });

        it('should support chaining insert and remove', () => {
            const entity = (world.spawn as any)() as Entity;
            commands.entity(entity)
                .insert(Position, { x: 1, y: 2 })
                .remove(Velocity);
            commands.flush();

            expect(world.insert).toHaveBeenCalledWith(
                entity, Position, expect.objectContaining({ x: 1, y: 2 }),
            );
            expect(world.remove).toHaveBeenCalledWith(entity, Velocity);
        });
    });

    describe('despawn', () => {
        it('should despawn entity on flush', () => {
            const entity = (world.spawn as any)() as Entity;
            commands.despawn(entity);
            commands.flush();

            expect(world.despawn).toHaveBeenCalledWith(entity);
        });

        it('should skip despawn for invalid entity', () => {
            const entity = 999 as Entity;
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            commands.despawn(entity);
            commands.flush();

            expect(world.despawn).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('despawn skipped'),
            );
            warnSpy.mockRestore();
        });

        it('should support chaining', () => {
            const e1 = (world.spawn as any)() as Entity;
            const e2 = (world.spawn as any)() as Entity;
            commands.despawn(e1).despawn(e2);
            commands.flush();

            expect(world.despawn).toHaveBeenCalledTimes(2);
        });
    });

    describe('insert on invalid entity', () => {
        it('should skip insert for invalid entity', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            commands.queueInsert(999 as Entity, Position, { x: 0, y: 0 });
            commands.flush();

            expect(world.insert).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('insert skipped'),
            );
            warnSpy.mockRestore();
        });
    });

    describe('remove on invalid entity', () => {
        it('should skip remove for invalid entity', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            commands.queueRemove(999 as Entity, Position);
            commands.flush();

            expect(world.remove).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('remove skipped'),
            );
            warnSpy.mockRestore();
        });
    });

    describe('insertResource', () => {
        it('should insert resource on flush', () => {
            const TestRes = defineResource({ count: 0 }, 'TestRes');
            commands.insertResource(TestRes, { count: 42 });
            commands.flush();

            expect(resources.get(TestRes).count).toBe(42);
        });

        it('should support chaining', () => {
            const Res1 = defineResource({ a: 0 }, 'Res1');
            const Res2 = defineResource({ b: '' }, 'Res2');
            commands
                .insertResource(Res1, { a: 1 })
                .insertResource(Res2, { b: 'hello' });
            commands.flush();

            expect(resources.get(Res1).a).toBe(1);
            expect(resources.get(Res2).b).toBe('hello');
        });
    });

    describe('flush', () => {
        it('should finalize spawned entities before executing pending commands', () => {
            const spawnedEntity = (world.spawn as any)() as Entity;
            commands.spawn().insert(Position, { x: 1, y: 1 });
            commands.despawn(spawnedEntity);
            commands.flush();

            const spawnCalls = (world.spawn as any).mock.invocationCallOrder;
            const despawnCalls = (world.despawn as any).mock.invocationCallOrder;
            const lastSpawn = spawnCalls[spawnCalls.length - 1];
            const firstDespawn = despawnCalls[0];
            expect(lastSpawn).toBeLessThan(firstDespawn);
        });

        it('should clear pending queue after flush', () => {
            const entity = (world.spawn as any)() as Entity;
            commands.despawn(entity);
            commands.flush();

            vi.clearAllMocks();
            commands.flush();

            expect(world.despawn).not.toHaveBeenCalled();
        });

        it('should clear spawned queue after flush', () => {
            commands.spawn().insert(Position, { x: 1, y: 1 });
            commands.flush();

            vi.clearAllMocks();
            commands.flush();

            expect(world.spawn).not.toHaveBeenCalled();
        });
    });

    describe('EntityCommands.id()', () => {
        it('should return entity id after spawn is finalized', () => {
            const ec = commands.spawn().insert(Position, { x: 1, y: 1 });
            const id = ec.id();
            expect(id).toBeGreaterThan(0);
        });

        it('should trigger immediate finalization if not yet finalized', () => {
            const ec = commands.spawn();
            const id = ec.id();
            expect(world.spawn).toHaveBeenCalledOnce();
            expect(id).toBeGreaterThan(0);
        });

        it('should not double-spawn when id() then flush()', () => {
            const ec = commands.spawn().insert(Position, { x: 1, y: 1 });
            ec.id();
            commands.flush();

            expect(world.spawn).toHaveBeenCalledOnce();
        });
    });

    describe('EntityCommands - remove on new entity', () => {
        it('should be a no-op (remove before spawn has no effect)', () => {
            commands.spawn().remove(Position);
            commands.flush();

            expect(world.remove).not.toHaveBeenCalled();
        });
    });
});
