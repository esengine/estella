// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UIToggleGroup — the toggles beneath one ancestor are exclusive.
 *
 * The group sits on a common ancestor rather than on the toggles, so these
 * drive a world that really carries `Parent`: the rule is "nearest ancestor
 * that groups me", and a mock without a hierarchy cannot tell it apart from
 * "every toggle in the world".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Parent } from '../src/ecs/component';
import { UIToggle, UIToggleGroup, createToggleSystem } from '../src/ui/behavior/toggle';
import { UIEventQueue, UIEventType } from '../src/ui/core/events';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

function createWorld() {
    const comps = new Map<number, Map<object, unknown>>();
    let next = 1;
    const w = {
        spawn(): Entity { const e = next++; comps.set(e, new Map()); return e as Entity; },
        valid(e: Entity) { return comps.has(e as number); },
        has(e: Entity, c: object) { return comps.get(e as number)?.has(c) ?? false; },
        get(e: Entity, c: object) { return comps.get(e as number)?.get(c); },
        insert(e: Entity, c: object, d: unknown) { comps.get(e as number)?.set(c, d); },
        getEntitiesWithComponents(cs: object[]): Entity[] {
            return [...comps.entries()]
                .filter(([, m]) => cs.every(c => m.has(c)))
                .map(([e]) => e as Entity);
        },
        onDespawn() { return () => {}; },
    };
    return w as unknown as World & typeof w;
}

/** A toggle under `parent`, with a check entity so the system has one to show. */
function addToggle(w: ReturnType<typeof createWorld>, parent: Entity, isOn: boolean): Entity {
    const e = w.spawn();
    w.insert(e, Parent, { entity: parent });
    w.insert(e, UIToggle, { isOn, check: w.spawn() });
    return e;
}

describe('UIToggleGroup', () => {
    let world: ReturnType<typeof createWorld>;
    let events: UIEventQueue;
    let tick: () => void;

    beforeEach(() => {
        world = createWorld();
        events = new UIEventQueue();
        const sys = createToggleSystem(world as unknown as World, events);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tick = () => (sys as any)._fn();
    });

    const isOn = (e: Entity) => (world.get(e, UIToggle) as { isOn: boolean }).isOn;

    it('turns the others off when one is clicked', () => {
        const group = world.spawn();
        world.insert(group, UIToggleGroup, { allowSwitchOff: false });
        const a = addToggle(world, group, true);
        const b = addToggle(world, group, false);
        const c = addToggle(world, group, false);
        tick();

        events.emit(b, UIEventType.Click);
        expect([isOn(a), isOn(b), isOn(c)]).toEqual([false, true, false]);
    });

    // Without this a tab bar can be clicked into showing no tab at all.
    it('keeps the selected one on when the group requires a selection', () => {
        const group = world.spawn();
        world.insert(group, UIToggleGroup, { allowSwitchOff: false });
        const a = addToggle(world, group, true);
        tick();

        events.emit(a, UIEventType.Click);
        expect(isOn(a)).toBe(true);
    });

    it('lets the selected one switch off when the group allows it', () => {
        const group = world.spawn();
        world.insert(group, UIToggleGroup, { allowSwitchOff: true });
        const a = addToggle(world, group, true);
        tick();

        events.emit(a, UIEventType.Click);
        expect(isOn(a)).toBe(false);
    });

    // The rule is the NEAREST grouping ancestor, not "every toggle there is".
    it('does not reach across into another group', () => {
        const left = world.spawn();
        const right = world.spawn();
        world.insert(left, UIToggleGroup, { allowSwitchOff: false });
        world.insert(right, UIToggleGroup, { allowSwitchOff: false });
        const a = addToggle(world, left, true);
        const b = addToggle(world, right, true);
        tick();

        events.emit(b, UIEventType.Click);
        expect(isOn(a)).toBe(true); // b was already on; a is another group's business
    });

    it('leaves an ungrouped toggle free to flip on its own', () => {
        const plain = world.spawn();
        const a = addToggle(world, plain, true);
        const b = addToggle(world, plain, true);
        tick();

        events.emit(a, UIEventType.Click);
        expect([isOn(a), isOn(b)]).toEqual([false, true]);
    });
});
