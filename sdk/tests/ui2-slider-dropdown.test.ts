import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createSlider,
    createDropdown,
    UIEventQueue,
    UIEventType,
    UIRect,
    Text,
} from '../src/ui2';
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

    beforeEach(() => {
        world = createMockWorld();
    });

    it('initializes at the provided value, clamped to [min, max]', () => {
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 10, value: 5,
        });
        expect(slider.getValue()).toBe(5);

        const clipped = createSlider({
            world: world as unknown as World,
            min: 0, max: 10, value: 99,
        });
        expect(clipped.getValue()).toBe(10);
    });

    it('setValue clamps and triggers onChange', () => {
        const onChange = vi.fn();
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 1, value: 0,
            onChange,
        });
        slider.setValue(0.5);
        expect(slider.getValue()).toBe(0.5);
        expect(onChange).toHaveBeenCalledWith(0.5, slider.entity);

        slider.setValue(2);
        expect(slider.getValue()).toBe(1);
    });

    it('setValue with step snaps to the nearest step', () => {
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 10, step: 2, value: 0,
        });
        slider.setValue(3);   // nearest 2-step → 2 or 4 (round half up in JS → 4)
        expect([2, 4]).toContain(slider.getValue());

        slider.setValue(7.7);
        expect(slider.getValue()).toBe(8);
    });

    it('setValue does not fire onChange when value is unchanged', () => {
        const onChange = vi.fn();
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 1, value: 0.5, onChange,
        });
        slider.setValue(0.5);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('updates fill anchorMax.x on setValue', () => {
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 1, value: 0,
        });
        slider.setValue(0.25);
        const rect = world.get(slider.fillEntity, UIRect) as {
            anchorMax: { x: number; y: number };
        };
        expect(rect.anchorMax.x).toBe(0.25);
    });

    it('updates handle anchorMin/Max.x together to position it at t', () => {
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 1, value: 0,
        });
        slider.setValue(0.5);
        const rect = world.get(slider.handleEntity, UIRect) as {
            anchorMin: { x: number; y: number };
            anchorMax: { x: number; y: number };
        };
        expect(rect.anchorMin.x).toBe(0.5);
        expect(rect.anchorMax.x).toBe(0.5);
    });

    it('valueAtLocalX maps pointer X to value (with clamping)', () => {
        const slider = createSlider({
            world: world as unknown as World,
            min: 0, max: 100,
        });
        expect(slider.valueAtLocalX(0, 200)).toBe(0);
        expect(slider.valueAtLocalX(100, 200)).toBe(50);
        expect(slider.valueAtLocalX(200, 200)).toBe(100);
        expect(slider.valueAtLocalX(-50, 200)).toBe(0);
        expect(slider.valueAtLocalX(1000, 200)).toBe(100);
    });

    it('dispose despawns the track root', () => {
        const slider = createSlider({
            world: world as unknown as World,
        });
        expect(world.valid(slider.entity)).toBe(true);
        slider.dispose();
        expect(world.valid(slider.entity)).toBe(false);
    });
});

describe('createDropdown', () => {
    let world: MockWorld;
    let events: UIEventQueue;

    beforeEach(() => {
        world = createMockWorld();
        events = new UIEventQueue();
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

    it('opens popup on button click (pressed → hover)', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b'],
        });
        expect(dd.isOpen()).toBe(false);

        events.emit(dd.entity, UIEventType.StateChanged, { from: 'pressed', to: 'hover' });
        expect(dd.isOpen()).toBe(true);
    });

    it('closes popup on second button click', () => {
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['a', 'b'],
        });

        events.emit(dd.entity, UIEventType.StateChanged, { from: 'pressed', to: 'hover' });
        expect(dd.isOpen()).toBe(true);

        events.emit(dd.entity, UIEventType.StateChanged, { from: 'pressed', to: 'hover' });
        expect(dd.isOpen()).toBe(false);
    });

    it('setSelectedIndex updates the label text and fires onSelect (unless silent)', () => {
        const onSelect = vi.fn();
        const dd = createDropdown({
            world: world as unknown as World, events,
            options: ['x', 'y', 'z'],
            onSelect,
        });

        dd.setSelectedIndex(2);
        expect(dd.getSelectedIndex()).toBe(2);
        expect((world.get(dd.labelEntity, Text) as { content: string }).content).toBe('z');
        expect(onSelect).toHaveBeenCalledWith(2, 'z', dd.entity);

        dd.setSelectedIndex(0, true);
        expect(dd.getSelectedIndex()).toBe(0);
        expect(onSelect).toHaveBeenCalledTimes(1);   // silent
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
