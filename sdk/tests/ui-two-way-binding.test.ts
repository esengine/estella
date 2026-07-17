// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bindWidgetValue — the two-way edge between a Signal and a widget's
 *        value component, with the behavior system in the loop.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    signal,
    bindWidgetValue,
    createSlider,
    createSliderSystem,
    createToggle,
    createToggleSystem,
    UISlider,
    UIToggle,
    UIEventQueue,
    UIEventType,
} from '../src/ui';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

interface MockWorld {
    _entities: Set<number>;
    _components: Map<number, Map<object, unknown>>;
    _despawnListeners: Array<(e: Entity) => void>;
    spawn(): Entity;
    despawn(e: Entity): void;
    valid(e: Entity): boolean;
    setParent(c: Entity, p: Entity): void;
    has(e: Entity, c: object): boolean;
    get(e: Entity, c: object): unknown;
    insert(e: Entity, c: object, data: unknown): void;
    getEntitiesWithComponents(cs: object[]): Entity[];
    onDespawn(cb: (e: Entity) => void): () => void;
}

function createMockWorld(): MockWorld {
    let nextId = 1;
    const w: MockWorld = {
        _entities: new Set(),
        _components: new Map(),
        _despawnListeners: [],
        spawn() {
            const id = nextId++;
            w._entities.add(id);
            w._components.set(id, new Map());
            return id as Entity;
        },
        despawn(e) {
            for (const cb of w._despawnListeners) cb(e);
            w._entities.delete(e as number);
            w._components.delete(e as number);
        },
        valid(e) { return w._entities.has(e as number); },
        setParent() { /* not needed */ },
        has(e, c) { return w._components.get(e as number)?.has(c) ?? false; },
        get(e, c) { return w._components.get(e as number)?.get(c); },
        insert(e, c, d) { w._components.get(e as number)?.set(c, d); },
        getEntitiesWithComponents(cs) {
            return [...w._entities].filter((e) =>
                cs.every((c) => w._components.get(e)?.has(c))) as Entity[];
        },
        onDespawn(cb) {
            w._despawnListeners.push(cb);
            return () => {
                const i = w._despawnListeners.indexOf(cb);
                if (i !== -1) w._despawnListeners.splice(i, 1);
            };
        },
    };
    return w;
}

const idleInput = { isMouseButtonDown: () => false, isKeyPressed: () => false };
const noCamera = { valid: false };

describe('bindWidgetValue', () => {
    let world: MockWorld;
    let events: UIEventQueue;

    beforeEach(() => {
        world = createMockWorld();
        events = new UIEventQueue();
    });

    it('signal → UISlider.value → visuals; input change → signal (round trip settles)', () => {
        const sys = createSliderSystem(world as unknown as World, events);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tick = () => (sys as any)._fn(idleInput, noCamera);

        const slider = createSlider({
            world: world as unknown as World, events,
            min: 0, max: 100, value: 25,
        });
        tick();

        const volume = signal(50);
        const off = bindWidgetValue(
            world as unknown as World, events, slider.entity, UISlider, 'value', volume);

        // Down: the bind seeds the component immediately.
        expect(slider.getValue()).toBe(50);
        tick();

        // Down again on set.
        volume.set(80);
        expect(slider.getValue()).toBe(80);
        tick();

        // Up: a widget-side write flows into the signal through change.
        slider.setValue(30);
        tick();
        expect(volume.get()).toBe(30);

        off();
        volume.set(99);
        expect(slider.getValue()).toBe(30); // unbound
    });

    it('signal ↔ UIToggle.isOn with the isOn payload key', () => {
        const sys = createToggleSystem(world as unknown as World, events);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tick = () => (sys as any)._fn();

        const toggle = createToggle({
            world: world as unknown as World, events,
            interactionStates: { normal: {}, hover: {}, pressed: {} },
            isOn: false,
        });
        tick();

        const muted = signal(true);
        bindWidgetValue(
            world as unknown as World, events, toggle.entity, UIToggle, 'isOn', muted);
        expect(toggle.isOn()).toBe(true);
        tick();

        // Up: a click flips the component; change writes the signal.
        events.emit(toggle.entity, UIEventType.Click);
        tick();
        expect(muted.get()).toBe(false);
    });
});
