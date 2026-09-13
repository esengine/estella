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
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineEvent, EventRegistry } from '../src/ecs/event';
import { ResourceStorage } from '../src/ecs/resource';
import { speculate } from '../src/ecs/speculation';

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
