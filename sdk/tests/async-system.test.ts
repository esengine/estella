import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../src/app';
import { defineSystem, Schedule, SystemRunner } from '../src/system';
import { defineResource, Res, ResMut, ResourceStorage } from '../src/resource';
import { Commands, CommandsInstance } from '../src/commands';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

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
// SystemRunner async tests
// =============================================================================

describe('SystemRunner async', () => {
    let mockWorld: ReturnType<typeof createMockWorld>;
    let world: World;
    let resources: ResourceStorage;
    let runner: SystemRunner;

    beforeEach(() => {
        mockWorld = createMockWorld();
        world = mockWorld.world;
        resources = new ResourceStorage();
        runner = new SystemRunner(world, resources);
    });

    it('should run async system and return a Promise', async () => {
        const fn = vi.fn(async () => {});
        const sys = defineSystem([], fn);
        const result = runner.run(sys);
        expect(result).toBeInstanceOf(Promise);
        await result;
        expect(fn).toHaveBeenCalledOnce();
    });

    it('should flush Commands after async system resolves', async () => {
        let flushed = false;
        const originalFlush = CommandsInstance.prototype.flush;
        CommandsInstance.prototype.flush = function () {
            flushed = true;
            return originalFlush.call(this);
        };

        const sys = defineSystem([Commands()], async (cmds) => {
            await Promise.resolve();
            cmds.spawn();
        });

        await runner.run(sys);
        expect(flushed).toBe(true);

        CommandsInstance.prototype.flush = originalFlush;
    });

    it('should call resetIterationDepth after async system resolves', async () => {
        const sys = defineSystem([], async () => {
            await Promise.resolve();
        });
        await runner.run(sys);
        expect((world as any).resetIterationDepth).toHaveBeenCalled();
    });

    it('should call resetIterationDepth even if async system rejects', async () => {
        const sys = defineSystem([], async () => {
            await Promise.resolve();
            throw new Error('async boom');
        });
        await expect(runner.run(sys)).rejects.toThrow('async boom');
        expect((world as any).resetIterationDepth).toHaveBeenCalled();
    });

    it('should still work synchronously for non-async systems', () => {
        const fn = vi.fn();
        const sys = defineSystem([], fn);
        const result = runner.run(sys);
        expect(result).toBeUndefined();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('should update system tick after async system completes', async () => {
        mockWorld.worldTick.value = 5;
        const sys = defineSystem([], async () => {
            await Promise.resolve();
        });
        await runner.run(sys);
        expect((world as any).getWorldTick).toHaveBeenCalled();
    });
});

// =============================================================================
// App-level async system tests
// =============================================================================

describe('App async systems', () => {
    it('should await async startup system before frame loop', async () => {
        const app = App.new();
        const order: string[] = [];

        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [], async () => {
                await new Promise(r => setTimeout(r, 10));
                order.push('startup-done');
            }, { name: 'AsyncStartup' }
        ));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { order.push('update'); }, { name: 'SyncUpdate' }
        ));

        await app.tick(1 / 60);

        expect(order).toEqual(['startup-done', 'update']);
    });

    it('should await async Update system', async () => {
        const app = App.new();
        const order: string[] = [];

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], async () => {
                order.push('async-start');
                await Promise.resolve();
                order.push('async-end');
            }, { name: 'AsyncUpdate' }
        ));

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [], () => { order.push('post-update'); }, { name: 'SyncPostUpdate' }
        ));

        await app.tick(1 / 60);

        expect(order).toEqual(['async-start', 'async-end', 'post-update']);
    });

    it('should await async systems in sequence within same schedule', async () => {
        const app = App.new();
        const order: string[] = [];

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], async () => {
                await new Promise(r => setTimeout(r, 10));
                order.push('A');
            }, { name: 'AsyncA' }
        ));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], async () => {
                await new Promise(r => setTimeout(r, 5));
                order.push('B');
            }, { name: 'AsyncB' }
        ));

        await app.tick(1 / 60);

        expect(order).toEqual(['A', 'B']);
    });

    it('should handle mix of sync and async systems', async () => {
        const app = App.new();
        const order: string[] = [];

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { order.push('sync-1'); }, { name: 'Sync1' }
        ));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], async () => {
                await Promise.resolve();
                order.push('async');
            }, { name: 'Async' }
        ));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => { order.push('sync-2'); }, { name: 'Sync2' }
        ));

        await app.tick(1 / 60);

        expect(order).toEqual(['sync-1', 'async', 'sync-2']);
    });

    it('should handle async system with resource access', async () => {
        const app = App.new();
        const MyData = defineResource<{ loaded: boolean }>({ loaded: false }, 'MyData');
        app.insertResource(MyData, { loaded: false });

        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [ResMut(MyData)],
            async (data) => {
                await Promise.resolve();
                data.get().loaded = true;
            },
            { name: 'AsyncLoader' }
        ));

        await app.tick(1 / 60);

        expect(app.getResource(MyData).loaded).toBe(true);
    });

    it('should not run async startup system twice when tick is called concurrently', async () => {
        const app = App.new();
        let runCount = 0;

        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [], async () => {
                runCount++;
                await new Promise(r => setTimeout(r, 50));
            }, { name: 'AsyncStartupOnce' }
        ));

        const tick1 = app.tick(1 / 60);
        const tick2 = app.tick(1 / 60);
        await Promise.all([tick1, tick2]);

        expect(runCount).toBe(1);
    });

    it('should handle error in async system gracefully', async () => {
        const app = App.new();
        const errors: string[] = [];

        app.onSystemError((err) => {
            errors.push(err.message);
            return 'continue';
        });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], async () => {
                await Promise.resolve();
                throw new Error('async failure');
            }, { name: 'FailingAsync' }
        ));

        await app.tick(1 / 60);

        expect(errors).toContain('async failure');
    });
});
