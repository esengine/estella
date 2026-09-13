// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    speculation.test.ts
 * @brief   A step nobody has seen yet leaves nothing behind when it is taken back
 *
 *          Three ways a step can leak, and they fail differently: the value it
 *          wrote, the identity it consumed, and the event it delivered. The
 *          shape is the flagship's damage resolution — hurt something, spawn the
 *          effect, announce the death — because that is the smallest gameplay
 *          act that touches all three.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineEvent, EventRegistry } from '../src/ecs/event';
import { ResourceStorage } from '../src/ecs/resource';
import { speculate, replay } from '../src/ecs/speculation';
import { App } from '../src/app/app';
import { Schedule } from '../src/ecs/system';
import { defineSystem } from '../src/ecs/system';
import { Speculation, type SpeculationInstance } from '../src/ecs/speculation';
import { Res } from '../src/ecs/resource';
import { Transform } from '../src/ecs/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const Health = defineComponent('SpecHealth', { hp: 100 });
const Effect = defineComponent('SpecEffect', { kind: '' });
const Died = defineEvent<{ entity: number }>('SpecDied', { entity: 0 });

function scene() {
    const world = new World();
    const resources = new ResourceStorage();
    const events = new EventRegistry();
    const victim = world.spawn();
    world.insert(victim, Health, { hp: 100 });
    return { world, resources, events, victim };
}

/** What a reader would see: events are readable only after the swap. */
function delivered(events: EventRegistry): Array<{ entity: number }> {
    events.swapAll();
    return [...events.getBus(Died).getReadBuffer()] as Array<{ entity: number }>;
}

describe('a speculated step', () => {
    it('abandoned, leaves no value, no identity and no event', () => {
        const { world, resources, events, victim } = scene();
        const before = world.spawn();            // the identity the effect would take
        world.despawn(before);

        const outcome = speculate({ world, resources, events }, (commands) => {
            const hp = world.get(victim, Health);
            world.set(victim, Health, { ...hp, hp: hp.hp - 40 });
            commands.spawn().insert(Effect, { kind: 'death' });
            events.getBus(Died).send({ entity: victim });
            return 'abandon';
        });

        expect(outcome).toBe('abandon');
        expect(world.get(victim, Health).hp).toBe(100);
        expect(world.getEntitiesWithComponents([Effect]).length).toBe(0);
        expect(delivered(events)).toEqual([]);
    });

    it('committed, leaves all three', () => {
        const { world, resources, events, victim } = scene();

        const outcome = speculate({ world, resources, events }, (commands) => {
            const hp = world.get(victim, Health);
            world.set(victim, Health, { ...hp, hp: hp.hp - 40 });
            commands.spawn().insert(Effect, { kind: 'death' });
            events.getBus(Died).send({ entity: victim });
            return 'commit';
        });

        expect(outcome).toBe('commit');
        expect(world.get(victim, Health).hp).toBe(60);
        expect(world.getEntitiesWithComponents([Effect]).length).toBe(1);
        expect(delivered(events)).toEqual([{ entity: victim }]);
    });

    // The identity clause on its own: an abandoned step must not have COST one.
    // What this holds is that the queue allocates nothing until it commits, not
    // merely that the entity is gone afterwards.
    it('abandoned, hands the next spawn the identity it would have had', () => {
        const dry = scene();
        const untouched = dry.world.spawn();

        const { world, resources, events, victim } = scene();
        speculate({ world, resources, events }, (commands) => {
            commands.spawn().insert(Effect, { kind: 'death' });
            world.set(victim, Health, { hp: 1 });
            return 'abandon';
        });
        expect(world.spawn()).toBe(untouched);
    });

    it('refuses a structural change it could not take back', () => {
        const { world, resources, events } = scene();
        expect(() => speculate({ world, resources, events }, () => {
            world.spawn();
            return 'commit';
        })).toThrow(/speculation/i);
    });

    // A value written through the live handle and never announced: the pre-image
    // has to come from the hand-out, or this restores whatever `set` saw.
    it('restores a value that was written through the handle', () => {
        const { world, resources, events, victim } = scene();
        speculate({ world, resources, events }, () => {
            const hp = world.get(victim, Health);
            hp.hp = 3;
            world.markChanged(victim, Health);
            return 'abandon';
        });
        expect(world.get(victim, Health).hp).toBe(100);
    });
});

// The other storage, against the real registry rather than a stand-in: builtins
// are projected out of C++ rather than lent, and a kernel that had only ever met
// script components would not know whether its pre-image survives that.
describe.skipIf(!HAS_WASM)('a speculated step, over engine components', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('restores a builtin the C++ side holds', () => {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        try {
            const world = app.world;
            const resources = new ResourceStorage();
            const mover = world.spawn();
            world.insert(mover, Transform, { position: { x: 1, y: 2, z: 0 } } as never);

            speculate({ world, resources }, () => {
                const t = world.get(mover, Transform) as { position: { x: number; y: number; z: number } };
                world.set(mover, Transform, { ...t, position: { x: 99, y: 99, z: 0 } } as never);
                return 'abandon';
            });

            const after = world.get(mover, Transform) as { position: { x: number; y: number; z: number } };
            expect([after.position.x, after.position.y]).toEqual([1, 2]);
        } finally {
            for (const e of app.world.getAllEntities()) { try { app.world.despawn(e); } catch { /* gone */ } }
            app.world.disconnectCpp();
            (registry as unknown as { delete(): void }).delete();
        }
    });
});

// The capability as a system actually receives it. Everything above drives the
// pieces by hand, which is not where a game meets them: the scheduler is what
// hands out a scope, and a step taken inside one is what has to leave nothing.
describe('a speculation a system asked for', () => {
    it('runs inside the schedule and takes its step back', async () => {
        const app = App.new();
        const world = app.world;
        const victim = world.spawn();
        world.insert(victim, Health, { hp: 100 });

        let outcome: string | null = null;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Speculation)],
            (speculation: SpeculationInstance) => {
                outcome = speculation.run((commands) => {
                    const hp = world.get(victim, Health);
                    world.set(victim, Health, { ...hp, hp: 0 });
                    commands.spawn().insert(Effect, { kind: 'death' });
                    return 'abandon';
                });
            },
        ));

        await app.tick(1 / 60);

        expect(outcome).toBe('abandon');
        expect(world.get(victim, Health).hp).toBe(100);
        expect(world.getEntitiesWithComponents([Effect]).length).toBe(0);
    });
});

// The contract the replication client already depends on — a predicted step
// "depends only on world state + actions + dt" — with something holding it.
describe('replaying a step', () => {
    it('says so when the same step lands in the same place', () => {
        const { world, resources, events, victim } = scene();
        const report = replay({ world, resources, events }, (commands) => {
            const hp = world.get(victim, Health);
            world.set(victim, Health, { ...hp, hp: hp.hp - 10 });
            commands.spawn().insert(Effect, { kind: 'hit' });
            events.getBus(Died).send({ entity: victim });
            return 'commit';
        });
        expect(report).toEqual({ stable: true, why: '' });
    });

    it('names the surface when the step is not a function of the world', () => {
        const { world, resources, events, victim } = scene();
        const report = replay({ world, resources, events }, () => {
            const hp = world.get(victim, Health);
            world.set(victim, Health, { ...hp, hp: Math.random() });
            return 'commit';
        });
        expect(report.stable).toBe(false);
        expect(report.why).toMatch(/^values differed between runs/);
    });

    it('catches a step whose STRUCTURE wanders, not just its values', () => {
        const { world, resources, events } = scene();
        let n = 0;
        const report = replay({ world, resources, events }, (commands) => {
            for (let i = 0; i <= n; i++) commands.spawn().insert(Effect, { kind: 'hit' });
            n++;
            return 'commit';
        });
        expect(report.stable).toBe(false);
        expect(report.why).toMatch(/^commands differed between runs/);
    });

    it('and an announcement that wanders', () => {
        const { world, resources, events, victim } = scene();
        let n = 0;
        const report = replay({ world, resources, events }, () => {
            events.getBus(Died).send({ entity: victim + n++ });
            return 'commit';
        });
        expect(report.stable).toBe(false);
        expect(report.why).toMatch(/^events differed between runs/);
    });

    it('leaves the world where it found it, whatever it asked', () => {
        const { world, resources, events, victim } = scene();
        replay({ world, resources, events }, (commands) => {
            world.set(victim, Health, { hp: 7 });
            commands.spawn().insert(Effect, { kind: 'hit' });
            events.getBus(Died).send({ entity: victim });
            return 'commit';
        });
        expect(world.get(victim, Health).hp).toBe(100);
        expect(world.getEntitiesWithComponents([Effect]).length).toBe(0);
        expect(delivered(events)).toEqual([]);
    });
});
