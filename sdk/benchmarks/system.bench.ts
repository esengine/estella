import { describe, bench } from 'vitest';
import { World } from '../src/world';
import { defineComponent } from '../src/component';
import { defineSystem, SystemRunner, Schedule } from '../src/system';
import { ResourceStorage } from '../src/resource';
import { EventRegistry } from '../src/event';
import { Query, Mut } from '../src/query';
import { Commands } from '../src/commands';
import { Res, defineResource, ResMut } from '../src/resource';
import { EventWriter, EventReader, defineEvent } from '../src/event';

const Position = defineComponent('BenchSysPos', { x: 0, y: 0 });
const Velocity = defineComponent('BenchSysVel', { dx: 0, dy: 0 });
const TimeRes = defineResource({ delta: 0.016, elapsed: 0, frameCount: 0 }, 'BenchTime');
const HitEvent = defineEvent<{ entity: number; x: number; y: number }>('BenchHitEvent');

describe('System - Dispatch overhead (empty system)', () => {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const runner = new SystemRunner(world, resources, events);

    const emptySystem = defineSystem([], () => {});
    const querySystem = defineSystem([Query(Position)], () => {});
    const multiParamSystem = defineSystem(
        [Query(Position, Velocity), Res(TimeRes), Commands()],
        () => {}
    );

    bench('0 params', () => {
        runner.run(emptySystem);
    });

    bench('1 param (Query)', () => {
        runner.run(querySystem);
    });

    bench('3 params (Query + Res + Commands)', () => {
        runner.run(multiParamSystem);
    });
});

describe('System - Dispatch with iteration (1000 entities)', () => {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const runner = new SystemRunner(world, resources, events);

    for (let i = 0; i < 1000; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        world.insert(e, Velocity, { dx: 1, dy: 1 });
    }

    const iterSystem = defineSystem(
        [Query(Position, Velocity)],
        (query) => { for (const _ of query) {} }
    );

    const mutSystem = defineSystem(
        [Query(Mut(Position), Velocity)],
        (query) => {
            for (const [, pos, vel] of query) {
                pos.x += vel.dx;
                pos.y += vel.dy;
            }
        }
    );

    const forEachSystem = defineSystem(
        [Query(Position, Velocity)],
        (query) => { query.forEach(() => {}); }
    );

    bench('for-of iteration', () => {
        runner.run(iterSystem);
    });

    bench('Mut query iteration', () => {
        runner.run(mutSystem);
    });

    bench('forEach iteration', () => {
        runner.run(forEachSystem);
    });
});

describe('System - Resource resolution', () => {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const runner = new SystemRunner(world, resources, events);
    resources.insert(TimeRes, { delta: 0.016, elapsed: 0, frameCount: 0 });

    const resSystem = defineSystem([Res(TimeRes)], () => {});
    const resMutSystem = defineSystem([ResMut(TimeRes)], () => {});

    bench('Res (readonly)', () => {
        runner.run(resSystem);
    });

    bench('ResMut', () => {
        runner.run(resMutSystem);
    });
});

describe('System - Event params', () => {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const runner = new SystemRunner(world, resources, events);

    const writerSystem = defineSystem([EventWriter(HitEvent)], () => {});
    const readerSystem = defineSystem([EventReader(HitEvent)], () => {});
    const bothSystem = defineSystem(
        [EventWriter(HitEvent), EventReader(HitEvent)],
        () => {}
    );

    bench('EventWriter', () => {
        runner.run(writerSystem);
    });

    bench('EventReader', () => {
        runner.run(readerSystem);
    });

    bench('Writer + Reader', () => {
        runner.run(bothSystem);
    });
});

describe('System - Commands spawn+flush', () => {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const runner = new SystemRunner(world, resources, events);

    const spawnFlushSystem = defineSystem([Commands()], (cmds) => {
        for (let i = 0; i < 10; i++) {
            cmds.spawn().insert(Position, { x: i, y: i });
        }
    });

    bench('spawn 10 + flush', () => {
        runner.run(spawnFlushSystem);
    });
});

describe('System - Commands despawn+flush (100 entities)', () => {
    const world2 = new World();
    const resources2 = new ResourceStorage();
    const events2 = new EventRegistry();
    const runner2 = new SystemRunner(world2, resources2, events2);

    const despawnFlushSystem = defineSystem([Query(Position), Commands()], (query, cmds) => {
        let count = 0;
        for (const [entity] of query) {
            cmds.despawn(entity);
            if (++count >= 10) break;
        }
    });

    const refillSystem = defineSystem([Commands()], (cmds) => {
        for (let i = 0; i < 10; i++) {
            cmds.spawn().insert(Position, { x: i, y: i });
        }
    });

    for (let i = 0; i < 100; i++) {
        const e = world2.spawn();
        world2.insert(e, Position, { x: i, y: i });
    }

    bench('despawn 10 + flush (from 100)', () => {
        runner2.run(despawnFlushSystem);
        runner2.run(refillSystem);
    });
});

describe('System - Full frame simulation (10 systems)', () => {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const runner = new SystemRunner(world, resources, events);
    resources.insert(TimeRes, { delta: 0.016, elapsed: 0, frameCount: 0 });

    for (let i = 0; i < 500; i++) {
        const e = world.spawn();
        world.insert(e, Position, { x: i, y: i });
        world.insert(e, Velocity, { dx: 1, dy: 1 });
    }

    const systems: ReturnType<typeof defineSystem>[] = [];
    for (let i = 0; i < 10; i++) {
        systems.push(defineSystem(
            [Query(Position, Velocity)],
            (query) => { for (const _ of query) {} }
        ));
    }

    bench('run 10 systems', () => {
        events.swapAll();
        world.advanceTick();
        world.resetQueryPool();
        for (const sys of systems) {
            runner.run(sys);
        }
        world.cleanRemovedBuffer(2);
    });
});
