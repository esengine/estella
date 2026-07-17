// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createSlider,
    createSliderSystem,
    UISlider,
    Focusable,
    createDropdown,
    createDropdownSystem,
    UIEventQueue,
    UIEventType,
    UIRect,
    UINode,
    UIVisual,
    DimensionUnit,
    Text,
} from '../src/ui';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

interface MockWorld {
    _entities: Set<number>;
    _components: Map<number, Map<object, unknown>>;
    _nextId: number;
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
    const w: MockWorld = {
        _entities: new Set(), _components: new Map(),
        _nextId: 1, _despawnListeners: [],
        spawn() {
            const id = w._nextId++;
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
        setParent() { /* no-op for these tests */ },
        has(e, c) { return w._components.get(e as number)?.has(c) ?? false; },
        get(e, c) { return w._components.get(e as number)?.get(c); },
        insert(e, c, d) { w._components.get(e as number)?.set(c, d); },
        getEntitiesWithComponents(cs: object[]) {
            return [...w._entities].filter((e) =>
                cs.every((c) => w._components.get(e)?.has(c))) as Entity[];
        },
        onDespawn(cb) {
            w._despawnListeners.push(cb);
            return () => {
                const idx = w._despawnListeners.indexOf(cb);
                if (idx !== -1) w._despawnListeners.splice(idx, 1);
            };
        },
    };
    return w;
}

describe('createSlider', () => {
    let world: MockWorld;
    let events: UIEventQueue;
    let keys: Set<string>;
    let tick: () => void;

    beforeEach(() => {
        world = createMockWorld();
        events = new UIEventQueue();
        keys = new Set();
        const sys = createSliderSystem(world as unknown as World, events);
        const input = {
            isMouseButtonDown: () => false,
            isKeyPressed: (k: string) => keys.has(k),
        };
        const camera = { valid: false };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tick = () => (sys as any)._fn(input, camera);
    });

    const make = (opts: Record<string, unknown> = {}) =>
        createSlider({ world: world as unknown as World, events, ...opts });

    it('initializes at the provided value, clamped to [min, max]', () => {
        const slider = make({ min: 0, max: 10, value: 5 });
        expect(slider.getValue()).toBe(5);

        const clipped = make({ min: 0, max: 10, value: 99 });
        expect(clipped.getValue()).toBe(10);
    });

    it('setValue clamps, syncs visuals through the system, and fires onChange', () => {
        const onChange = vi.fn();
        const slider = make({ min: 0, max: 1, value: 0, onChange });
        tick(); // initial paint — must not fire a change

        slider.setValue(0.5);
        tick();
        expect(slider.getValue()).toBe(0.5);
        expect(onChange).toHaveBeenCalledWith(0.5, slider.entity);

        slider.setValue(2);
        expect(slider.getValue()).toBe(1);
    });

    it('setValue with step snaps to the nearest step', () => {
        const slider = make({ min: 0, max: 10, step: 2, value: 0 });
        slider.setValue(3);   // nearest 2-step → 2 or 4 (round half up in JS → 4)
        expect([2, 4]).toContain(slider.getValue());

        slider.setValue(7.7);
        expect(slider.getValue()).toBe(8);
    });

    it('setValue does not fire onChange when value is unchanged', () => {
        const onChange = vi.fn();
        const slider = make({ min: 0, max: 1, value: 0.5, onChange });
        tick();
        slider.setValue(0.5);
        tick();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('updates fill amount (Filled crop) through the system', () => {
        const slider = make({ min: 0, max: 1, value: 0 });
        slider.setValue(0.25);
        tick();
        const vis = world.get(slider.fillEntity, UIVisual) as { fillAmount: number };
        expect(vis.fillAmount).toBe(0.25);
    });

    it('updates handle left inset (percent) through the system', () => {
        const slider = make({ min: 0, max: 1, value: 0 });
        slider.setValue(0.5);
        tick();
        const node = world.get(slider.handleEntity, UINode) as {
            insetLeft: { value: number; unit: number };
        };
        expect(node.insetLeft).toEqual({ value: 50, unit: DimensionUnit.Percent });
    });

    it('arrow keys nudge the focused slider (1% of range when continuous)', () => {
        const onChange = vi.fn();
        const slider = make({ min: 0, max: 100, value: 50, onChange });
        tick();

        const f = world.get(slider.entity, Focusable) as { isFocused: boolean };
        f.isFocused = true;
        world.insert(slider.entity, Focusable, f);

        keys.add('ArrowRight');
        tick();
        expect(slider.getValue()).toBe(51);
        expect(onChange).toHaveBeenCalledWith(51, slider.entity);

        keys.clear();
        keys.add('Home');
        tick();
        expect(slider.getValue()).toBe(0);
    });

    it('ignores input while disabled', () => {
        const slider = make({ min: 0, max: 100, value: 50, disabled: true });
        tick();
        const f = world.get(slider.entity, Focusable) as { isFocused: boolean };
        f.isFocused = true;
        world.insert(slider.entity, Focusable, f);
        keys.add('ArrowRight');
        tick();
        expect(slider.getValue()).toBe(50);
    });

    it('carries the UISlider component with fill/handle refs', () => {
        const slider = make({ min: 0, max: 10, value: 5 });
        const d = world.get(slider.entity, UISlider) as { fill: number; handle: number };
        expect(d.fill).toBe(slider.fillEntity);
        expect(d.handle).toBe(slider.handleEntity);
    });

    it('dispose despawns the track root', () => {
        const slider = make({});
        expect(world.valid(slider.entity)).toBe(true);
        slider.dispose();
        expect(world.valid(slider.entity)).toBe(false);
    });
});

describe('createDropdown', () => {
    let world: MockWorld;
    let events: UIEventQueue;
    let keys: Set<string>;
    let tick: () => void;

    beforeEach(() => {
        world = createMockWorld();
        events = new UIEventQueue();
        keys = new Set();
        const sys = createDropdownSystem(world as unknown as World, events);
        const input = { isKeyPressed: (k: string) => keys.has(k) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tick = () => (sys as any)._fn(input);
    });

    it('shows the current selection label', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['Apple', 'Banana', 'Cherry'],
            selectedIndex: 1,
        });
        const label = world.get(dd.labelEntity, Text) as { content: string };
        expect(label.content).toBe('Banana');
    });

    it('opens popup on button click', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b'],
        });
        expect(dd.isOpen()).toBe(false);

        events.emit(dd.entity, UIEventType.Click);
        expect(dd.isOpen()).toBe(true);
    });

    it('closes popup on second button click', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b'],
        });

        events.emit(dd.entity, UIEventType.Click);
        expect(dd.isOpen()).toBe(true);

        events.emit(dd.entity, UIEventType.Click);
        expect(dd.isOpen()).toBe(false);
    });

    it('setSelectedIndex writes the component; the system syncs the label and fires onSelect', () => {
        const onSelect = vi.fn();
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['x', 'y', 'z'],
            onSelect,
        });
        tick(); // initial paint — no change event

        dd.setSelectedIndex(2);
        tick();
        expect(dd.getSelectedIndex()).toBe(2);
        expect((world.get(dd.labelEntity, Text) as { content: string }).content).toBe('z');
        expect(onSelect).toHaveBeenCalledWith(2, 'z', dd.entity);
    });

    it('a click outside the dropdown closes the popup', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b'],
        });
        dd.open();
        expect(dd.isOpen()).toBe(true);

        const elsewhere = world.spawn();
        events.emit(elsewhere, UIEventType.Click);
        expect(dd.isOpen()).toBe(false);
    });

    it('open state: Enter closes the popup; the selected row holds the selected page', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b', 'c'], selectedIndex: 1,
        });
        tick();
        dd.open();
        expect(dd.isOpen()).toBe(true);

        // Exactly one popup row sits on the non-driver-owned 'selected' page.
        const selectedRows = (world as unknown as { _components: Map<number, Map<object, unknown>> })
            ._components;
        let count = 0;
        for (const comps of selectedRows.values()) {
            for (const data of comps.values()) {
                const d = data as { controllers?: Array<{ name: string; current: string }> };
                if (d?.controllers?.some((c) => c.current === 'selected')) count++;
            }
        }
        expect(count).toBe(1);

        const f = world.get(dd.entity, Focusable) as { isFocused: boolean };
        f.isFocused = true;
        world.insert(dd.entity, Focusable, f);
        keys.add('Enter');
        tick();
        expect(dd.isOpen()).toBe(false);
    });

    it('arrow keys step the selection while focused and closed', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b', 'c'],
        });
        tick();

        const f = world.get(dd.entity, Focusable) as { isFocused: boolean };
        f.isFocused = true;
        world.insert(dd.entity, Focusable, f);

        keys.add('ArrowDown');
        tick();
        expect(dd.getSelectedIndex()).toBe(1);

        keys.clear();
        keys.add('ArrowUp');
        tick();
        expect(dd.getSelectedIndex()).toBe(0);
        tick();
        expect(dd.getSelectedIndex()).toBe(0); // clamped at the first option
    });

    it('open() / close() imperatively toggle the popup', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b', 'c'],
        });

        dd.open();
        expect(dd.isOpen()).toBe(true);
        dd.open();   // idempotent
        expect(dd.isOpen()).toBe(true);

        dd.close();
        expect(dd.isOpen()).toBe(false);
    });

    it('optionToLabel controls the displayed text', () => {
        const dd = createDropdown<{ id: number; label: string }>({
            world: world as unknown as World, events,
            options: [
                { id: 1, label: 'Alpha' },
                { id: 2, label: 'Beta' },
            ],
            optionToLabel: (o) => o.label,
        });
        const lbl = world.get(dd.labelEntity, Text) as { content: string };
        expect(lbl.content).toBe('Alpha');
    });

    it('getSelected returns the typed option object', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b', 'c'],
            selectedIndex: 2,
        });
        expect(dd.getSelected()).toBe('c');
    });

    it('dispose despawns the button root', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a'],
        });
        expect(world.valid(dd.entity)).toBe(true);
        dd.dispose();
        expect(world.valid(dd.entity)).toBe(false);
    });
});
