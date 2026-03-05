import { bench, describe } from 'vitest';
import { World } from '../src/world';
import { defineComponent } from '../src/component';
import { CommandsInstance } from '../src/commands';
import { ResourceStorage } from '../src/resource';
import { Entity } from '../src/types';

const Position = defineComponent('CmdBenchPosition', { x: 0, y: 0 });
const Velocity = defineComponent('CmdBenchVelocity', { vx: 0, vy: 0 });

describe('Commands - Deferred spawn', () => {
    bench('spawn 100 entities with 2 components', () => {
        const world = new World();
        const resources = new ResourceStorage();
        const cmds = new CommandsInstance(world, resources);
        for (let i = 0; i < 100; i++) {
            cmds.spawn()
                .insert(Position, { x: i, y: i })
                .insert(Velocity, { vx: 1, vy: 1 });
        }
        cmds.flush();
    });
});

describe('Commands - Deferred despawn', () => {
    bench('despawn 100 entities', () => {
        const world = new World();
        const resources = new ResourceStorage();
        const entities: Entity[] = [];
        for (let i = 0; i < 100; i++) {
            const e = world.spawn();
            world.insert(e, Position, { x: i, y: i });
            entities.push(e);
        }
        const cmds = new CommandsInstance(world, resources);
        for (const e of entities) cmds.despawn(e);
        cmds.flush();
    });
});

describe('Commands - Deferred insert', () => {
    bench('insert to 500 entities', () => {
        const world = new World();
        const resources = new ResourceStorage();
        const entities: Entity[] = [];
        for (let i = 0; i < 500; i++) entities.push(world.spawn());
        const cmds = new CommandsInstance(world, resources);
        for (const e of entities) {
            cmds.entity(e).insert(Position, { x: 1, y: 1 });
        }
        cmds.flush();
    });
});

describe('Commands - Mixed operations', () => {
    bench('50 spawns + 20 despawns + 30 inserts', () => {
        const world = new World();
        const resources = new ResourceStorage();
        const cmds = new CommandsInstance(world, resources);
        const spawned: Entity[] = [];
        for (let i = 0; i < 50; i++) {
            const ec = cmds.spawn().insert(Position, { x: i, y: i });
            spawned.push(ec.id());
        }
        for (let i = 0; i < 20; i++) cmds.despawn(spawned[i]);
        for (let i = 20; i < 50; i++) {
            cmds.entity(spawned[i]).insert(Velocity, { vx: 1, vy: 1 });
        }
        cmds.flush();
    });
});
