// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createButton,
    createToggle,
    createProgress,
    createDialog,
    setButtonState,
    interactionGears,
    Interactable,
    UIController,
    UIGear,
    INTERACTION_CONTROLLER,
    UINode,
    UIVisual,
    UIVisualType,
    FillMethod,
    FillOrigin,
    UIEventQueue,
    UIEventType,
    themeColors,
    type UIControllerData,
    type UIGearData,
} from '../src/ui';
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

    const interactionOf = (btn: Entity) =>
        (world.get(btn, UIController) as UIControllerData).controllers
            .find((c) => c.name === INTERACTION_CONTROLLER)!;

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

        expect(world.has(btn, UINode)).toBe(true);
        expect(world.has(btn, UIVisual)).toBe(true);
        expect(world.has(btn, Interactable)).toBe(true);
        expect(world.has(btn, UIController)).toBe(true);
        expect(world.has(btn, UIGear)).toBe(true);
    });

    it('folds the `states` map into a $interaction color gear', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: {
                normal: { color: { r: 1, g: 0, b: 0, a: 1 } },
                hover: { color: { r: 0, g: 1, b: 0, a: 1 } },
            },
            fadeDuration: 0.2,
        });

        const gear = world.get(btn, UIGear) as UIGearData;
        expect(gear.bindings).toHaveLength(1);
        const b = gear.bindings[0]!;
        expect(b).toMatchObject({ controller: INTERACTION_CONTROLLER, component: 'UIVisual', property: 'color' });
        expect(b.pages.normal).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect(b.pages.hover).toEqual({ r: 0, g: 1, b: 0, a: 1 });
        expect(b.pages.pressed).toBeUndefined(); // sparse: unauthored pages leave the field alone
        expect(b.tween?.duration).toBeCloseTo(0.2);
    });

    it('defaults its states to the active theme control roles (de-nude)', () => {
        const btn = createButton({ world: world as unknown as World, events, text: 'OK' });
        const gear = world.get(btn, UIGear) as UIGearData;
        const colorGear = gear.bindings.find((b) => b.property === 'color')!;
        const c = themeColors();
        expect(colorGear.pages.normal).toMatchObject(c.control);
        expect(colorGear.pages.hover).toMatchObject(c.controlHover);
        expect(colorGear.pages.pressed).toMatchObject(c.controlActive);
        expect(colorGear.pages.disabled).toBeDefined();
    });

    it('starts on the "disabled" page when opts.disabled is true', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            disabled: true,
            states: {
                normal: {}, hover: {}, pressed: {}, disabled: {},
            },
        });

        const i = world.get(btn, Interactable) as { enabled: boolean };
        expect(interactionOf(btn).current).toBe('disabled');
        expect(i.enabled).toBe(false);
    });

    it('lists canonical pages first, then custom states', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: { normal: {}, loading: {}, celebrating: {} },
        });
        expect(interactionOf(btn).pages).toEqual(
            ['normal', 'hover', 'pressed', 'disabled', 'loading', 'celebrating'],
        );
    });

    it('fires onClick on the interaction layer click event', () => {
        const onClick = vi.fn();
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: { normal: {}, hover: {}, pressed: {} },
            onClick,
        });

        events.emit(btn, UIEventType.Click);
        expect(onClick).toHaveBeenCalledWith(btn);
    });

    it('swallows clicks while disabled', () => {
        const onClick = vi.fn();
        const btn = createButton({
            world: world as unknown as World,
            events,
            disabled: true,
            states: { normal: {}, hover: {}, pressed: {} },
            onClick,
        });

        events.emit(btn, UIEventType.Click);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('setButtonState writes the $interaction page, growing the enum for custom states', () => {
        const btn = createButton({
            world: world as unknown as World,
            events,
            states: { normal: {} },
        });

        setButtonState(world as unknown as World, btn, 'loading');
        const ctrl = interactionOf(btn);
        expect(ctrl.current).toBe('loading');
        expect(ctrl.pages).toContain('loading');
    });
});

describe('interactionGears', () => {
    it('splits color / sprite / scale overrides into per-field bindings', () => {
        const bindings = interactionGears({
            normal: { color: { r: 1, g: 1, b: 1, a: 1 }, sprite: 7, scale: 1 },
            pressed: { color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, sprite: 8, scale: 0.95 },
        }, 0.1);

        const byProp = Object.fromEntries(bindings.map((b) => [b.property, b]));
        expect(Object.keys(byProp).sort()).toEqual(['color', 'scale', 'texture']);
        expect(byProp.color!.component).toBe('UIVisual');
        expect(byProp.texture!.component).toBe('UIVisual');
        expect(byProp.scale!.component).toBe('Transform');
        expect(byProp.texture!.pages.pressed).toBe(8);
        expect(byProp.scale!.pages.pressed).toEqual({ x: 0.95, y: 0.95, z: 1 });
        // Sprite swaps are discrete: no tween even when fadeDuration is set.
        expect(byProp.texture!.tween).toBeUndefined();
        expect(byProp.color!.tween?.duration).toBeCloseTo(0.1);
        expect(byProp.scale!.tween?.duration).toBeCloseTo(0.1);
    });

    it('emits no binding for a field no state overrides', () => {
        const bindings = interactionGears({ normal: { color: { r: 1, g: 1, b: 1, a: 1 } }, hover: {} });
        expect(bindings).toHaveLength(1);
        expect(bindings[0]!.property).toBe('color');
        expect(bindings[0]!.tween).toBeUndefined();
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

        events.emit(toggle.entity, UIEventType.Click);

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

    it('setValue writes fillAmount (default "right" = Filled from the left)', () => {
        const p = createProgress({
            world: world as unknown as World,
            value: 0,
        });
        p.setValue(0.4);
        const vis = world.get(p.fillEntity, UIVisual) as {
            visualType: number;
            fillAmount: number;
            fillMethod: number;
            fillOrigin: number;
        };
        expect(vis.visualType).toBe(UIVisualType.Filled);
        expect(vis.fillAmount).toBeCloseTo(0.4);
        expect(vis.fillMethod).toBe(FillMethod.Horizontal);
        expect(vis.fillOrigin).toBe(FillOrigin.Left);
    });

    it('anchors the fill to the right when direction = "left"', () => {
        const p = createProgress({
            world: world as unknown as World,
            direction: 'left',
            value: 0.25,
        });
        const vis = world.get(p.fillEntity, UIVisual) as {
            fillAmount: number;
            fillMethod: number;
            fillOrigin: number;
        };
        expect(vis.fillAmount).toBeCloseTo(0.25);
        expect(vis.fillMethod).toBe(FillMethod.Horizontal);
        expect(vis.fillOrigin).toBe(FillOrigin.Right);
    });

    it('uses the vertical fill axis for "up" / "down"', () => {
        const up = createProgress({ world: world as unknown as World, direction: 'up', value: 0.5 });
        const down = createProgress({ world: world as unknown as World, direction: 'down', value: 0.5 });
        const upVis = world.get(up.fillEntity, UIVisual) as { fillMethod: number; fillOrigin: number };
        const downVis = world.get(down.fillEntity, UIVisual) as { fillMethod: number; fillOrigin: number };
        expect(upVis.fillMethod).toBe(FillMethod.Vertical);
        expect(upVis.fillOrigin).toBe(FillOrigin.Bottom);
        expect(downVis.fillMethod).toBe(FillMethod.Vertical);
        expect(downVis.fillOrigin).toBe(FillOrigin.Top);
    });

    it('radial gauges use Radial360 from the top', () => {
        const p = createProgress({ world: world as unknown as World, radial: true, value: 0.25 });
        const vis = world.get(p.fillEntity, UIVisual) as {
            visualType: number;
            fillMethod: number;
            fillOrigin: number;
            fillAmount: number;
        };
        expect(vis.visualType).toBe(UIVisualType.Filled);
        expect(vis.fillMethod).toBe(FillMethod.Radial360);
        expect(vis.fillOrigin).toBe(FillOrigin.Top);
        expect(vis.fillAmount).toBeCloseTo(0.25);
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
        const bg = world.get(dialog.backdropEntity, UIVisual) as { enabled: boolean };
        expect(bg.enabled).toBe(false);
    });

    it('open() shows backdrop + panel and enables Interactable', () => {
        const dialog = createDialog({ world: world as unknown as World });
        dialog.open();
        expect(dialog.isOpen()).toBe(true);

        const bg = world.get(dialog.backdropEntity, UIVisual) as { enabled: boolean };
        const panel = world.get(dialog.panelEntity, UIVisual) as { enabled: boolean };
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
