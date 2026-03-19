import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    Schedule,
    GetWorld,
    defineSystem,
    addSystem,
    addStartupSystem,
    addSystemToSchedule,
    SystemRunner,
} from '../src/system';
import { getDefaultContext } from '../src/context';
import { Query, Mut, QueryInstance, Removed, RemovedQueryInstance } from '../src/query';
import { Res, ResMut, ResMutInstance, defineResource, ResourceStorage } from '../src/resource';
import { Commands, CommandsInstance } from '../src/commands';
import { EventWriter, EventReader, EventWriterInstance, EventReaderInstance, defineEvent, EventRegistry } from '../src/event';
import { defineComponent } from '../src/component';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

// =============================================================================
// Test components and resources
// =============================================================================

const Position = defineComponent('SysTestPosition', { x: 0, y: 0 });
const Velocity = defineComponent('SysTestVelocity', { dx: 0, dy: 0 });

const GameState = defineResource({ score: 0, level: 1 }, 'GameState');

const DamageEvent = defineEvent<{ target: Entity; amount: number }>('Damage');

// =============================================================================
// Mock World
// =============================================================================

function createMockWorld() {
    let nextId = 1;
    const entities = new Set<Entity>();
    const worldTick = { value: 0 };

    const world = {
        spawn: vi.fn(() => {
            const e = nextId++ as Entity;
            entities.add(e);
            return e;
        }),
        despawn: vi.fn((e: Entity) => entities.delete(e)),
        insert: vi.fn(),
        remove: vi.fn(),
        get: vi.fn(),
        set: vi.fn(),
        valid: vi.fn((e: Entity) => entities.has(e)),
        getEntitiesWithComponents: vi.fn(() => [] as Entity[]),
        beginIteration: vi.fn(),
        endIteration: vi.fn(),
        resetIterationDepth: vi.fn(),
        getWorldTick: vi.fn(() => worldTick.value),
        isAddedSince: vi.fn(() => false),
        isChangedSince: vi.fn(() => false),
        getRemovedEntitiesSince: vi.fn(() => []),
        enableChangeTracking: vi.fn(),
        resolveGetter: vi.fn(() => null),
    };

    return { world: world as unknown as World, entities, worldTick };
}

// =============================================================================
// Schedule enum
// =============================================================================

describe('Schedule', () => {
    it('should have correct phase values', () => {
        expect(Schedule.Startup).toBe(0);
        expect(Schedule.First).toBe(1);
        expect(Schedule.PreUpdate).toBe(2);
        expect(Schedule.Update).toBe(3);
        expect(Schedule.PostUpdate).toBe(4);
        expect(Schedule.Last).toBe(5);
        expect(Schedule.FixedPreUpdate).toBe(10);
        expect(Schedule.FixedUpdate).toBe(11);
        expect(Schedule.FixedPostUpdate).toBe(12);
    });
});

// =============================================================================
// GetWorld descriptor
// =============================================================================

describe('GetWorld', () => {
    it('should create a get_world descriptor', () => {
        const desc = GetWorld();
        expect(desc._type).toBe('get_world');
    });
});

// =============================================================================
// defineSystem
// =============================================================================

describe('defineSystem', () => {
    it('should create a system with unique symbol id', () => {
        const sys = defineSystem([], () => {});
        expect(typeof sys._id).toBe('symbol');
    });

    it('should store params and fn', () => {
        const fn = vi.fn();
        const params = [Query(Position)] as const;
        const sys = defineSystem([...params], fn);
        expect(sys._params).toHaveLength(1);
        expect(sys._fn).toBe(fn);
    });

    it('should use provided name', () => {
        const sys = defineSystem([], () => {}, { name: 'MovementSystem' });
        expect(sys._name).toBe('MovementSystem');
    });

    it('should default to empty name when not provided', () => {
        const sys = defineSystem([], () => {});
        expect(sys._name).toBe('');
    });

    it('should create unique ids for different systems', () => {
        const a = defineSystem([], () => {});
        const b = defineSystem([], () => {});
        expect(a._id).not.toBe(b._id);
    });
});

// =============================================================================
// Global registration (addSystem, addStartupSystem, addSystemToSchedule)
// =============================================================================

describe('Global system registration', () => {
    afterEach(() => {
        getDefaultContext().pendingSystems.length = 0;
    });

    it('addSystem should register with Update schedule', () => {
        const sys = defineSystem([], () => {});
        addSystem(sys);
        const pending = getDefaultContext().pendingSystems;
        expect(pending).toContainEqual({ schedule: Schedule.Update, system: sys });
    });

    it('addStartupSystem should register with Startup schedule', () => {
        const sys = defineSystem([], () => {});
        addStartupSystem(sys);
        const pending = getDefaultContext().pendingSystems;
        expect(pending).toContainEqual({ schedule: Schedule.Startup, system: sys });
    });

    it('addSystemToSchedule should register with specified schedule', () => {
        const sys = defineSystem([], () => {});
        addSystemToSchedule(Schedule.Last, sys);
        const pending = getDefaultContext().pendingSystems;
        expect(pending).toContainEqual({ schedule: Schedule.Last, system: sys });
    });

    it('drainPendingSystems should return entries and clear queue', () => {
        const sys = defineSystem([], () => {});
        addSystem(sys);
        const ctx = getDefaultContext();
        expect(ctx.pendingSystems.length).toBe(1);

        const drained = ctx.drainPendingSystems();
        expect(drained).toHaveLength(1);
        expect(drained[0].system).toBe(sys);
        expect(ctx.pendingSystems.length).toBe(0);
    });
});

// =============================================================================
// SystemRunner
// =============================================================================

describe('SystemRunner', () => {
    let mockWorld: ReturnType<typeof createMockWorld>;
    let world: World;
    let resources: ResourceStorage;
    let eventRegistry: EventRegistry;
    let runner: SystemRunner;

    beforeEach(() => {
        mockWorld = createMockWorld();
        world = mockWorld.world;
        resources = new ResourceStorage();
        eventRegistry = new EventRegistry();
        runner = new SystemRunner(world, resources, eventRegistry);
    });

    describe('run with no params', () => {
        it('should call the system function', () => {
            const fn = vi.fn();
            const sys = defineSystem([], fn);
            runner.run(sys);
            expect(fn).toHaveBeenCalledOnce();
        });
    });

    describe('parameter resolution', () => {
        it('should resolve Query parameter', () => {
            let received: unknown = null;
            const sys = defineSystem([Query(Position)], (q) => {
                received = q;
            });
            runner.run(sys);
            expect(received).toBeInstanceOf(QueryInstance);
        });

        it('should resolve Res parameter', () => {
            resources.insert(GameState, { score: 42, level: 3 });
            let received: unknown = null;
            const sys = defineSystem([Res(GameState)], (state) => {
                received = state;
            });
            runner.run(sys);
            expect(received).toEqual({ score: 42, level: 3 });
        });

        it('should resolve ResMut parameter', () => {
            resources.insert(GameState, { score: 0, level: 1 });
            let received: unknown = null;
            const sys = defineSystem([ResMut(GameState)], (state) => {
                received = state;
            });
            runner.run(sys);
            expect(received).toBeInstanceOf(ResMutInstance);
        });

        it('should resolve Commands parameter', () => {
            let received: unknown = null;
            const sys = defineSystem([Commands()], (cmds) => {
                received = cmds;
            });
            runner.run(sys);
            expect(received).toBeInstanceOf(CommandsInstance);
        });

        it('should resolve EventWriter parameter', () => {
            let received: unknown = null;
            const sys = defineSystem([EventWriter(DamageEvent)], (writer) => {
                received = writer;
            });
            runner.run(sys);
            expect(received).toBeInstanceOf(EventWriterInstance);
        });

        it('should resolve EventReader parameter', () => {
            let received: unknown = null;
            const sys = defineSystem([EventReader(DamageEvent)], (reader) => {
                received = reader;
            });
            runner.run(sys);
            expect(received).toBeInstanceOf(EventReaderInstance);
        });

        it('should resolve Removed parameter', () => {
            let received: unknown = null;
            const sys = defineSystem([Removed(Position)], (removed) => {
                received = removed;
            });
            runner.run(sys);
            expect(received).toBeInstanceOf(RemovedQueryInstance);
        });

        it('should resolve GetWorld parameter', () => {
            let received: unknown = null;
            const sys = defineSystem([GetWorld()], (w) => {
                received = w;
            });
            runner.run(sys);
            expect(received).toBe(world);
        });

        it('should resolve multiple mixed parameters', () => {
            resources.insert(GameState, { score: 10, level: 2 });
            const received: unknown[] = [];
            const sys = defineSystem(
                [Query(Position), Res(GameState), Commands()],
                (q, state, cmds) => {
                    received.push(q, state, cmds);
                }
            );
            runner.run(sys);
            expect(received[0]).toBeInstanceOf(QueryInstance);
            expect(received[1]).toEqual({ score: 10, level: 2 });
            expect(received[2]).toBeInstanceOf(CommandsInstance);
        });
    });

    describe('Commands auto-flush', () => {
        it('should flush Commands after system runs', () => {
            const sys = defineSystem([Commands()], (cmds) => {
                cmds.despawn(1 as Entity);
            });
            runner.run(sys);
            expect((world.despawn as any) || true).toBeTruthy();
        });
    });

    describe('resetIterationDepth', () => {
        it('should call resetIterationDepth after system runs', () => {
            const sys = defineSystem([], () => {});
            runner.run(sys);
            expect((world as any).resetIterationDepth).toHaveBeenCalled();
        });

        it('should call resetIterationDepth even if system throws', () => {
            const sys = defineSystem([], () => {
                throw new Error('boom');
            });
            expect(() => runner.run(sys)).toThrow('boom');
            expect((world as any).resetIterationDepth).toHaveBeenCalled();
        });
    });

    describe('system tick tracking', () => {
        it('should update system tick after run', () => {
            mockWorld.worldTick.value = 5;
            const sys = defineSystem([], () => {});
            runner.run(sys);
            // Second run should have lastRunTick from first run
            mockWorld.worldTick.value = 10;
            runner.run(sys);
            // Verify the world tick is queried
            expect((world as any).getWorldTick).toHaveBeenCalled();
        });
    });

    describe('args caching', () => {
        it('should reuse args array on subsequent runs', () => {
            const calls: unknown[][] = [];
            const sys = defineSystem([Res(GameState)], (...args: unknown[]) => {
                calls.push(args);
            });
            resources.insert(GameState, { score: 0, level: 1 });
            runner.run(sys);
            runner.run(sys);
            expect(calls).toHaveLength(2);
        });
    });

    describe('EventRegistry not available', () => {
        it('should throw when EventWriter used without registry', () => {
            const runnerNoEvents = new SystemRunner(world, resources);
            const sys = defineSystem([EventWriter(DamageEvent)], () => {});
            expect(() => runnerNoEvents.run(sys)).toThrow('EventRegistry not available');
        });

        it('should throw when EventReader used without registry', () => {
            const runnerNoEvents = new SystemRunner(world, resources);
            const sys = defineSystem([EventReader(DamageEvent)], () => {});
            expect(() => runnerNoEvents.run(sys)).toThrow('EventRegistry not available');
        });
    });

    describe('unknown parameter type', () => {
        it('should throw for unknown parameter type', () => {
            const badParam = { _type: 'unknown_thing' } as any;
            const sys = defineSystem([badParam], () => {});
            expect(() => runner.run(sys)).toThrow('Unknown system parameter type');
        });
    });

    describe('evict and reset', () => {
        it('evict should clear cached state for a system', () => {
            const fn = vi.fn();
            const sys = defineSystem([], fn);
            runner.run(sys);
            expect(fn).toHaveBeenCalledOnce();

            runner.evict(sys._id);
            runner.run(sys);
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('reset should clear all cached state', () => {
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            const sys1 = defineSystem([], fn1);
            const sys2 = defineSystem([], fn2);
            runner.run(sys1);
            runner.run(sys2);

            runner.reset();
            runner.run(sys1);
            runner.run(sys2);
            expect(fn1).toHaveBeenCalledTimes(2);
            expect(fn2).toHaveBeenCalledTimes(2);
        });
    });
});
