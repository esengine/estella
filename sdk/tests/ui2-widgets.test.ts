import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createButton,
    createToggle,
    createProgress,
    createDialog,
    setButtonState,
    Interactable,
    StateMachine,
    StateVisuals,
    UIRect,
    UIRenderer,
    UIEventQueue,
    UIEventType,
    TransitionFlag,
} from '../src/ui2';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

// Minimal mock world — only the surface widgets + helpers touch.

interface MockWorld {
    _entities: Set<number>;
    _components: Map<number, Map<object, unknown>>;
    _parents: Map<number, number>;
    _names: Map<number, string>;
    _nextId: number;
    _despawnListeners: Array<(e: Entity) => void>;

    spawn(): Entity;
    despawn(e: Entity): void;
    valid(e: Entity): boolean;
    setParent(child: Entity, parent: Entity): void;
    has(e: Entity, c: object): boolean;
    get(e: Entity, c: object): unknown;
    insert(e: Entity, c: object, data: unknown): void;
    onDespawn(cb: (e: Entity) => void): () => void;
}

function createMockWorld(): MockWorld {
    const w: MockWorld = {
        _entities: new Set<number>(),
        _components: new Map(),
        _parents: new Map(),
        _names: new Map(),
        _nextId: 1,
        _despawnListeners: [],

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
            w._parents.delete(e as number);
        },
        valid(e) {
            return w._entities.has(e as number);
        },
        setParent(child, parent) {
            w._parents.set(child as number, parent as number);
        },
        has(e, c) {
            return w._components.get(e as number)?.has(c) ?? false;
        },
        get(e, c) {
            return w._components.get(e as number)?.get(c);
        },
        insert(e, c, data) {
            w._components.get(e as number)?.set(c, data);
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

describe('createButton', () => {
    let world: MockWorld;
    let events: UIEventQueue;

    beforeEach(() => {
        world = createMockWorld();
        events = new UIEventQueue();
    });

    it('attaches the required components', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: {
                normal: { color: { r: 1, g: 1, b: 1, a: 1 } },
                hover: { color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } },
                pressed: { color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } },
                disabled: { color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
            },
        });

        expect(world.has(btn, UIRect)).toBe(true);
        expect(world.has(btn, UIRenderer)).toBe(true);
        expect(world.has(btn, Interactable)).toBe(true);
        expect(world.has(btn, StateMachine)).toBe(true);
        expect(world.has(btn, StateVisuals)).toBe(true);
    });

    it('populates StateVisuals slots from the `states` map', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: {
                normal: { color: { r: 1, g: 0, b: 0, a: 1 } },
                hover: { color: { r: 0, g: 1, b: 0, a: 1 } },
            },
            transitionFlags: TransitionFlag.ColorTint,
        });

        const sv = world.get(btn, StateVisuals) as Record<string, unknown>;
        expect(sv['slot0Name']).toBe('normal');
        expect(sv['slot1Name']).toBe('hover');
        expect(sv['slot0Color']).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(sv['transitionFlags']).toBe(TransitionFlag.ColorTint);
    });

    it('starts in "disabled" state when opts.disabled is true', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            disabled: true,
            states: {
                normal: {}, hover: {}, pressed: {}, disabled: {},
            },
        });

        const sm = world.get(btn, StateMachine) as { current: string };
        const i = world.get(btn, Interactable) as { enabled: boolean };
        expect(sm.current).toBe('disabled');
        expect(i.enabled).toBe(false);
    });

    it('throws when more than 8 states are supplied', () => {
        expect(() =>
            createButton({
                world: world as unknown as World,
                events,
                states: Object.fromEntries(
                    Array.from({ length: 9 }, (_, i) => [`s${i}`, {}]),
                ),
            }),
        ).toThrow(/up to 8/);
    });

    it('fires onClick when the state transitions pressed → hover', () => {
        const onClick = vi.fn();
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: { normal: {}, hover: {}, pressed: {} },
            onClick,
        });

        events.emit(btn, UIEventType.StateChanged, { from: 'pressed', to: 'hover' });
        expect(onClick).toHaveBeenCalledWith(btn);
    });

    it('does not fire onClick on pressed → normal (released outside)', () => {
        const onClick = vi.fn();
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: { normal: {}, hover: {}, pressed: {} },
            onClick,
        });

        events.emit(btn, UIEventType.StateChanged, { from: 'pressed', to: 'normal' });
        expect(onClick).not.toHaveBeenCalled();
    });

    it('setButtonState writes StateMachine.current', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: { normal: {}, loading: {} },
        });

        setButtonState(world as unknown as World, btn, 'loading');
        expect((world.get(btn, StateMachine) as { current: string }).current).toBe('loading');
    });
});

describe('createToggle', () => {
    let world: MockWorld;
    let events: UIEventQueue;

    beforeEach(() => {
        world = createMockWorld();
        events = new UIEventQueue();
    });

    it('starts with the provided isOn value', () => {
        const on = createToggle({
            world: world as unknown as World,
            events,
            interactionStates: { normal: {}, hover: {}, pressed: {} },
            isOn: true,
        });
        expect(on.isOn()).toBe(true);
    });

    it('flips isOn on click and emits change', () => {
        const onChange = vi.fn();
        const toggle = createToggle({
            world: world as unknown as World,
            events,
            interactionStates: { normal: {}, hover: {}, pressed: {} },
            isOn: false,
            onChange,
        });

        events.emit(toggle.entity, UIEventType.StateChanged, { from: 'pressed', to: 'hover' });

        expect(toggle.isOn()).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true, toggle.entity);
    });

    it('setIsOn emits change unless silent is true', () => {
        const onChange = vi.fn();
        const toggle = createToggle({
            world: world as unknown as World,
            events,
            interactionStates: { normal: {}, hover: {}, pressed: {} },
            onChange,
        });

        toggle.setIsOn(true);
        expect(onChange).toHaveBeenCalledTimes(1);

        toggle.setIsOn(false, true);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(toggle.isOn()).toBe(false);
    });

    it('dispose despawns the root entity', () => {
        const toggle = createToggle({
            world: world as unknown as World,
            events,
            interactionStates: { normal: {}, hover: {}, pressed: {} },
        });
        expect(world.valid(toggle.entity)).toBe(true);

        toggle.dispose();
        expect(world.valid(toggle.entity)).toBe(false);
    });
});

describe('createProgress', () => {
    let world: MockWorld;

    beforeEach(() => {
        world = createMockWorld();
    });

    it('clamps the initial value to [0, 1]', () => {
        const p = createProgress({
            world: world as unknown as World,
            value: 1.5,
        });
        expect(p.value()).toBe(1);

        const q = createProgress({
            world: world as unknown as World,
            value: -0.2,
        });
        expect(q.value()).toBe(0);
    });

    it('setValue clamps and updates fill anchorMax.x (default "right")', () => {
        const p = createProgress({
            world: world as unknown as World,
            value: 0,
        });
        p.setValue(0.4);
        const rect = world.get(p.fillEntity, UIRect) as {
            anchorMin: { x: number; y: number };
            anchorMax: { x: number; y: number };
        };
        expect(rect.anchorMin).toEqual({ x: 0, y: 0 });
        expect(rect.anchorMax).toEqual({ x: 0.4, y: 1 });
    });

    it('uses reversed anchors when direction = "left"', () => {
        const p = createProgress({
            world: world as unknown as World,
            direction: 'left',
            value: 0.25,
        });
        const rect = world.get(p.fillEntity, UIRect) as {
            anchorMin: { x: number; y: number };
            anchorMax: { x: number; y: number };
        };
        expect(rect.anchorMin.x).toBe(0.75);
        expect(rect.anchorMax.x).toBe(1);
    });

    it('dispose despawns the track', () => {
        const p = createProgress({ world: world as unknown as World });
        expect(world.valid(p.entity)).toBe(true);
        p.dispose();
        expect(world.valid(p.entity)).toBe(false);
    });
});

describe('createDialog', () => {
    let world: MockWorld;

    beforeEach(() => {
        world = createMockWorld();
    });

    it('starts hidden by default', () => {
        const dialog = createDialog({ world: world as unknown as World });
        expect(dialog.isOpen()).toBe(false);
        const bg = world.get(dialog.backdropEntity, UIRenderer) as { enabled: boolean };
        expect(bg.enabled).toBe(false);
    });

    it('open() shows backdrop + panel and enables Interactable', () => {
        const dialog = createDialog({ world: world as unknown as World });
        dialog.open();
        expect(dialog.isOpen()).toBe(true);

        const bg = world.get(dialog.backdropEntity, UIRenderer) as { enabled: boolean };
        const panel = world.get(dialog.panelEntity, UIRenderer) as { enabled: boolean };
        const inter = world.get(dialog.backdropEntity, Interactable) as { enabled: boolean };
        expect(bg.enabled).toBe(true);
        expect(panel.enabled).toBe(true);
        expect(inter.enabled).toBe(true);
    });

    it('close() hides and disables the backdrop Interactable', () => {
        const dialog = createDialog({ world: world as unknown as World, startHidden: false });
        expect(dialog.isOpen()).toBe(true);

        dialog.close();
        const inter = world.get(dialog.backdropEntity, Interactable) as { enabled: boolean };
        expect(dialog.isOpen()).toBe(false);
        expect(inter.enabled).toBe(false);
    });

    it('dispose despawns the backdrop', () => {
        const dialog = createDialog({ world: world as unknown as World });
        expect(world.valid(dialog.backdropEntity)).toBe(true);
        dialog.dispose();
        expect(world.valid(dialog.backdropEntity)).toBe(false);
    });
});
