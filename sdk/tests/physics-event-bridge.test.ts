// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    physics-event-bridge.test.ts
 * @brief   Contacts republished on the entity event channel — the step that
 *          lets an authored EventBinding row wire a trigger area exactly like a
 *          button, with the same queue and the same dispatcher.
 */
import { describe, expect, it, vi } from 'vitest';
import { EntityEventQueue, EntityEvents } from '../src/ecs/entityEvents';
import { PhysicsEventType, registerPhysicsEventBridge, type PhysicsContactEventData } from '../src/physics/PhysicsEventBridge';
import { PhysicsEvents, type PhysicsEventsData } from '../src/physics/PhysicsTypes';
import type { Entity } from '../src/types';

const EMPTY: PhysicsEventsData = {
    collisionEnters: [], collisionExits: [], collisionHits: [], sensorEnters: [], sensorExits: [],
};

/** A fake App exposing only what the bridge touches, plus a manual tick. */
function makeApp(batch: Partial<PhysicsEventsData>) {
    const queue = new EntityEventQueue();
    const resources = new Map<unknown, unknown>([[PhysicsEvents, { ...EMPTY, ...batch }]]);
    let system: (() => void) | null = null;
    const app = {
        world: {
            valid: () => true,
            onDespawn: () => () => {},
        },
        hasResource: (def: unknown) => resources.has(def),
        getResource: (def: unknown) => resources.get(def),
        insertResource: (def: unknown, v: unknown) => { resources.set(def, v); },
        addSystemToSchedule: (_s: unknown, def: { _fn: (...args: unknown[]) => void }) => {
            // The bridge's only system param is Res(PhysicsEvents); feed it directly
            // rather than standing up a scheduler.
            system = () => def._fn(resources.get(PhysicsEvents));
        },
    };
    registerPhysicsEventBridge(app as never);
    return { queue: resources.get(EntityEvents) as EntityEventQueue, tick: () => system?.(), fallback: queue };
}

/** Collect (type, entity, other) for everything the bridge emits. */
function record(queue: EntityEventQueue, types: string[]) {
    const seen: Array<{ type: string; entity: Entity; other: Entity; isSensor?: boolean }> = [];
    for (const type of types) {
        queue.on(type, (e) => {
            const data = e.data as PhysicsContactEventData;
            seen.push({ type: e.type, entity: e.currentTarget, other: data.other, isSensor: data.isSensor });
        });
    }
    return seen;
}

const A = 1 as Entity;
const B = 2 as Entity;

describe('physics → entity events', () => {
    it('emits collision_enter on BOTH bodies, each told about the other', () => {
        const app = makeApp({ collisionEnters: [{ entityA: A, entityB: B, pointX: 0, pointY: 0, normalX: 0, normalY: 1 } as never] });
        const seen = record(app.queue, [PhysicsEventType.CollisionEnter]);

        app.tick();

        expect(seen).toEqual([
            { type: 'collision_enter', entity: A, other: B, isSensor: undefined },
            { type: 'collision_enter', entity: B, other: A, isSensor: undefined },
        ]);
    });

    it('a sensor pair says which side is the trigger', () => {
        const app = makeApp({ sensorEnters: [{ sensorEntity: A, visitorEntity: B }] });
        const seen = record(app.queue, [PhysicsEventType.TriggerEnter]);

        app.tick();

        expect(seen).toEqual([
            { type: 'trigger_enter', entity: A, other: B, isSensor: true },
            { type: 'trigger_enter', entity: B, other: A, isSensor: false },
        ]);
    });

    it('carries the impact speed on collision_hit', () => {
        const app = makeApp({
            collisionHits: [{ entityA: A, entityB: B, pointX: 0, pointY: 0, normalX: 0, normalY: 1, approachSpeed: 7.5 }],
        });
        const speeds: number[] = [];
        app.queue.on(PhysicsEventType.CollisionHit, (e) => {
            speeds.push((e.data as PhysicsContactEventData).approachSpeed!);
        });

        app.tick();

        expect(speeds).toEqual([7.5, 7.5]); // both participants
    });

    it('an empty frame emits nothing', () => {
        const app = makeApp({});
        const spy = vi.fn();
        for (const t of Object.values(PhysicsEventType)) app.queue.on(t, spy);

        app.tick();

        expect(spy).not.toHaveBeenCalled();
    });
});
