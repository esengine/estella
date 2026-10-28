// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-controller-gear.test.ts
 * @brief   UIController + UIGear: page resolution (self/ancestor), gear snap &
 *          tween, sparse pages, and the $interaction driver producing the
 *          normal/hover/pressed/disabled states through the unified layer.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Transform, Parent, type TransformData } from '../src/ecs/component';
import { UIVisual, UIVisualType, type UIVisualData } from '../src/ui/core/ui-visual';
import { UINode } from '../src/ui/core/ui-node';
import { px } from '../src/ui/core/dimension';
import { Interactable, UIInteraction } from '../src/ui/input/interactable';
import { EasingType } from '../src/animation/Easing';
import {
    UIController,
    interactionController,
    controllerState,
    getControllerPage,
    setControllerPage,
    findControllerOwner,
    type UIControllerData,
} from '../src/ui/controller/ui-controller';
import { UIGear, gearBinding, type UIGearData } from '../src/ui/controller/ui-gear';
import {
    createGearApplySystem,
    createInteractionControllerDriverSystem,
    readFieldPath,
    writeFieldPath,
    isLerpable,
    lerpGearValue,
} from '../src/ui/controller/gear-apply';
import type { Entity } from '../src/types';
import type { SystemDef } from '../src/ecs/system';
import type { AnyComponentDef } from '../src/ecs/component';

/** Minimal World backed by per-component Maps (no C++ registry needed). */
function makeMockWorld() {
    const storage = new Map<AnyComponentDef, Map<Entity, unknown>>();
    const alive = new Set<Entity>();
    let next = 1;
    const storeFor = (c: AnyComponentDef) => {
        let s = storage.get(c);
        if (!s) { s = new Map(); storage.set(c, s); }
        return s;
    };
    return {
        spawn: () => { const e = next++ as Entity; alive.add(e); return e; },
        valid: (e: Entity) => alive.has(e),
        has: (e: Entity, c: AnyComponentDef) => storeFor(c).has(e),
        get: (e: Entity, c: AnyComponentDef) => storeFor(c).get(e),
        insert: (e: Entity, c: AnyComponentDef, d: unknown) => { storeFor(c).set(e, d); },
        set: (e: Entity, c: AnyComponentDef, d: unknown) => { storeFor(c).set(e, d); },
        update: (e: Entity, c: AnyComponentDef, edit: (d: unknown) => void) => { edit(storeFor(c).get(e)); },
        remove: (e: Entity, c: AnyComponentDef) => storeFor(c).delete(e),
        getEntitiesWithComponents: (required: AnyComponentDef[]) => {
            const out: Entity[] = [];
            outer: for (const e of alive) {
                for (const c of required) if (!storeFor(c).has(e)) continue outer;
                out.push(e);
            }
            return out;
        },
    };
}
type MockWorld = ReturnType<typeof makeMockWorld>;

function runSystem(system: SystemDef, dt: number): void {
    (system._fn as (...a: unknown[]) => void)({ delta: dt, elapsed: 0, frameCount: 0 });
}

function makeVisual(color = { r: 1, g: 1, b: 1, a: 1 }): UIVisualData {
    return {
        visualType: UIVisualType.SolidColor, texture: 0, color,
        uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 },
        sliceBorder: { x: 0, y: 0, z: 0, w: 0 }, tileSize: { x: 32, y: 32 },
        fillMethod: 0, fillOrigin: 0, fillAmount: 1, material: 0, enabled: true,
    } as UIVisualData;
}
function makeTransform(scale = 1): TransformData {
    return {
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: scale, y: scale, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 }, worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        worldScale: { x: scale, y: scale, z: 1 },
    };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

describe('gear field/value helpers', () => {
    it('reads and writes nested dot-paths', () => {
        const data = { color: { r: 1, g: 1, b: 1, a: 1 }, insetLeft: { value: 10, unit: 0 } };
        expect(readFieldPath(data, 'color')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        expect(readFieldPath(data, 'insetLeft.value')).toBe(10);
        expect(readFieldPath(data, 'missing.deep')).toBeUndefined();

        expect(writeFieldPath(data, 'insetLeft.value', 42)).toBe(true);
        expect(data.insetLeft.value).toBe(42);
        expect(writeFieldPath(data, 'nope', 1)).toBe(false);
    });

    it('writes primitive values including strings and booleans', () => {
        const data: Record<string, unknown> = { content: 'A', enabled: true, count: 0 };
        expect(writeFieldPath(data, 'content', 'B-page')).toBe(true);
        expect(data.content).toBe('B-page');           // strings snap through unchanged
        expect(writeFieldPath(data, 'enabled', false)).toBe(true);
        expect(data.enabled).toBe(false);
    });

    it('clones object values on write so authored values never alias', () => {
        const authored = { r: 0, g: 0, b: 1, a: 1 };
        const data = { color: { r: 1, g: 1, b: 1, a: 1 } };
        writeFieldPath(data, 'color', authored);
        expect(data.color).toEqual(authored);
        expect(data.color).not.toBe(authored); // distinct object
    });

    it('classifies lerpable values (number/color/vec) vs snap-only', () => {
        expect(isLerpable(5)).toBe(true);
        expect(isLerpable({ r: 1, g: 0, b: 0, a: 1 })).toBe(true);
        expect(isLerpable({ x: 1, y: 2 })).toBe(true);
        expect(isLerpable(true)).toBe(false);
        expect(isLerpable('page')).toBe(false);
    });

    it('interpolates numbers, colors, and vectors; snaps on shape mismatch', () => {
        expect(lerpGearValue(0, 10, 0.5)).toBe(5);
        expect(lerpGearValue({ r: 0, g: 0, b: 0, a: 1 }, { r: 1, g: 1, b: 1, a: 1 }, 0.5))
            .toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
        expect(lerpGearValue({ x: 0, y: 0 }, { x: 4, y: 8 }, 0.25)).toEqual({ x: 1, y: 2 });
        expect(lerpGearValue(true, false, 0.5)).toBe(false); // non-numeric → snap to target
    });
});

// ─── Controller resolution ──────────────────────────────────────────────────

describe('UIController resolution', () => {
    let world: MockWorld;
    beforeEach(() => { world = makeMockWorld(); });

    it('resolves a controller on the entity itself', () => {
        const e = world.spawn();
        world.insert(e, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'b')] });
        expect(getControllerPage(world as never, e, 'tab')).toBe('b');
        expect(findControllerOwner(world as never, e, 'tab')).toBe(e);
        expect(getControllerPage(world as never, e, 'missing')).toBeNull();
    });

    it('walks ancestors to find a controller on the UI root', () => {
        const root = world.spawn();
        const mid = world.spawn();
        const leaf = world.spawn();
        world.insert(root, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'a')] });
        world.insert(mid, Parent, { entity: root });
        world.insert(leaf, Parent, { entity: mid });
        expect(getControllerPage(world as never, leaf, 'tab')).toBe('a');
        expect(findControllerOwner(world as never, leaf, 'tab')).toBe(root);
    });

    it('setControllerPage switches the page and guards typos / no-ops', () => {
        const e = world.spawn();
        world.insert(e, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'a')] });
        expect(setControllerPage(world as never, e, 'tab', 'b')).toBe(true);
        expect(getControllerPage(world as never, e, 'tab')).toBe('b');
        expect(setControllerPage(world as never, e, 'tab', 'b')).toBe(false);   // same page
        expect(setControllerPage(world as never, e, 'tab', 'zzz')).toBe(false); // unknown page
        expect(setControllerPage(world as never, e, 'nope', 'a')).toBe(false);  // unknown controller
    });
});

// ─── Gear apply ─────────────────────────────────────────────────────────────

describe('GearApplySystem — snap', () => {
    let world: MockWorld;
    let e: Entity;
    beforeEach(() => {
        world = makeMockWorld();
        e = world.spawn();
        world.insert(e, UIVisual, makeVisual());
        world.insert(e, Transform, makeTransform(1));
        world.insert(e, UINode, { position: 1, insetLeft: px(0) });
        world.insert(e, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'a')] });
    });

    it('applies the current page value to color / scale / inset', () => {
        world.insert(e, UIGear, {
            bindings: [
                gearBinding('tab', 'UIVisual', 'color', {
                    a: { r: 1, g: 0, b: 0, a: 1 }, b: { r: 0, g: 0, b: 1, a: 1 },
                }),
                gearBinding('tab', 'Transform', 'scale.x', { a: 1, b: 2 }),
                gearBinding('tab', 'UINode', 'insetLeft.value', { a: 0, b: 100 }),
            ],
        } as UIGearData);

        const sys = createGearApplySystem(world as never);
        runSystem(sys, 1 / 60);
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
        expect((world.get(e, Transform) as TransformData).scale.x).toBe(1);
        expect((world.get(e, UINode) as any).insetLeft.value).toBe(0);

        setControllerPage(world as never, e, 'tab', 'b');
        runSystem(sys, 1 / 60);
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
        expect((world.get(e, Transform) as TransformData).scale.x).toBe(2);
        expect((world.get(e, UINode) as any).insetLeft.value).toBe(100);
    });

    it('leaves a field untouched on a page it has no value for (sparse)', () => {
        world.insert(e, UIGear, {
            bindings: [gearBinding('tab', 'UIVisual', 'color', { a: { r: 1, g: 0, b: 0, a: 1 } })],
        } as UIGearData);
        const sys = createGearApplySystem(world as never);
        runSystem(sys, 1 / 60);
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 1, g: 0, b: 0, a: 1 });

        setControllerPage(world as never, e, 'tab', 'b'); // page 'b' unauthored for this gear
        world.update(e, UIVisual, (v) => { (v as UIVisualData).color = { r: 0.3, g: 0.3, b: 0.3, a: 1 }; });
        runSystem(sys, 1 / 60);
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 0.3, g: 0.3, b: 0.3, a: 1 });
    });

    it('stops writing once settled (no per-frame write amplification)', () => {
        world.insert(e, UIGear, {
            bindings: [gearBinding('tab', 'UIVisual', 'color', { a: { r: 1, g: 0, b: 0, a: 1 } })],
        } as UIGearData);
        const sys = createGearApplySystem(world as never);
        runSystem(sys, 1 / 60);
        const spy = vi.spyOn(world, 'insert');
        runSystem(sys, 1 / 60);
        runSystem(sys, 1 / 60);
        expect(spy.mock.calls.filter(c => c[1] === UIVisual)).toHaveLength(0);
    });
});

describe('GearApplySystem — tween', () => {
    let world: MockWorld;
    let e: Entity;
    beforeEach(() => {
        world = makeMockWorld();
        e = world.spawn();
        world.insert(e, UIVisual, makeVisual({ r: 0, g: 0, b: 0, a: 1 }));
        world.insert(e, UIController, { controllers: [controllerState('c', ['off', 'on'], 'on')] });
        world.insert(e, UIGear, {
            bindings: [gearBinding('c', 'UIVisual', 'color',
                { off: { r: 0, g: 0, b: 0, a: 1 }, on: { r: 1, g: 1, b: 1, a: 1 } },
                { easing: EasingType.Linear, duration: 1.0 })],
        } as UIGearData);
    });

    it('eases color from the current value and clamps at duration', () => {
        const sys = createGearApplySystem(world as never);
        runSystem(sys, 0);   // seed transition toward 'on' from black
        expect((world.get(e, UIVisual) as UIVisualData).color.r).toBeCloseTo(0);
        runSystem(sys, 0.5); // halfway
        expect((world.get(e, UIVisual) as UIVisualData).color.r).toBeCloseTo(0.5, 2);
        runSystem(sys, 1.0); // past the end → clamp
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });

    it('restarts a tween from the live value when the page changes mid-transition', () => {
        const sys = createGearApplySystem(world as never);
        runSystem(sys, 0);
        runSystem(sys, 0.5); // halfway toward 'on': r ≈ 0.5
        setControllerPage(world as never, e, 'c', 'off');
        runSystem(sys, 0);   // reseed toward 'off' — from the mid-fade value, not from 'on'
        runSystem(sys, 0.5); // halfway back: 0.5 → 0 at t=0.5 → r ≈ 0.25
        expect((world.get(e, UIVisual) as UIVisualData).color.r).toBeCloseTo(0.25, 2);
    });
});

// ─── $interaction driver parity ─────────────────────────────────────────────

describe('InteractionControllerDriverSystem — button states through gears', () => {
    let world: MockWorld;
    let e: Entity;
    beforeEach(() => {
        world = makeMockWorld();
        e = world.spawn();
        world.insert(e, UIVisual, makeVisual());
        world.insert(e, Interactable, { enabled: true, blockRaycast: true, raycastTarget: true });
        world.insert(e, UIInteraction, { hovered: false, pressed: false, justPressed: false, justReleased: false });
        world.insert(e, UIController, { controllers: [interactionController()] });
        world.insert(e, UIGear, {
            bindings: [gearBinding('$interaction', 'UIVisual', 'color', {
                normal: { r: 1, g: 1, b: 1, a: 1 },
                hover: { r: 0.8, g: 0.9, b: 1, a: 1 },
                pressed: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
                disabled: { r: 0.3, g: 0.3, b: 0.3, a: 1 },
            })],
        } as UIGearData);
    });

    function tick(driver: SystemDef, apply: SystemDef) {
        runSystem(driver, 1 / 60);
        runSystem(apply, 1 / 60);
    }

    it('drives $interaction page from pointer state and gears the color per page', () => {
        const driver = createInteractionControllerDriverSystem(world as never);
        const apply = createGearApplySystem(world as never);

        tick(driver, apply);
        expect(getControllerPage(world as never, e, '$interaction')).toBe('normal');
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 1, g: 1, b: 1, a: 1 });

        world.insert(e, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });
        tick(driver, apply);
        expect(getControllerPage(world as never, e, '$interaction')).toBe('hover');
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 0.8, g: 0.9, b: 1, a: 1 });

        world.insert(e, UIInteraction, { hovered: true, pressed: true, justPressed: false, justReleased: false });
        tick(driver, apply);
        expect(getControllerPage(world as never, e, '$interaction')).toBe('pressed');
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });

        world.insert(e, Interactable, { enabled: false, blockRaycast: true, raycastTarget: true });
        tick(driver, apply);
        expect(getControllerPage(world as never, e, '$interaction')).toBe('disabled');
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual({ r: 0.3, g: 0.3, b: 0.3, a: 1 });
    });

    it('leaves a user-managed custom page alone (e.g. "loading")', () => {
        const driver = createInteractionControllerDriverSystem(world as never);
        const data = world.get(e, UIController) as UIControllerData;
        data.controllers[0]!.pages.push('loading');
        data.controllers[0]!.current = 'loading';
        world.insert(e, UIController, data);

        world.insert(e, UIInteraction, { hovered: true, pressed: false, justPressed: false, justReleased: false });
        runSystem(driver, 1 / 60);
        expect(getControllerPage(world as never, e, '$interaction')).toBe('loading');

        // Back on a driver-owned page, pointer state takes over again.
        setControllerPage(world as never, e, '$interaction', 'normal');
        runSystem(driver, 1 / 60);
        expect(getControllerPage(world as never, e, '$interaction')).toBe('hover');
    });
});

// ─── Skipping the frames in which nothing changed ────────────────────────

/** The mock world with the change tracking the real one has: a tick per frame, a structural version, and when each component last changed. */
function makeTrackedWorld() {
    const base = makeMockWorld();
    let tick = 0, version = 0;
    const changedAt = new Map<AnyComponentDef, number>();
    const reads = { get: 0, has: 0 };
    const note = (c: AnyComponentDef) => changedAt.set(c, tick);
    const world = {
        ...base,
        get: (e: Entity, c: AnyComponentDef) => { reads.get++; return base.get(e, c); },
        has: (e: Entity, c: AnyComponentDef) => { reads.has++; return base.has(e, c); },
        insert: (e: Entity, c: AnyComponentDef, d: unknown) => { if (!base.has(e, c)) version++; base.insert(e, c, d); note(c); },
        update: (e: Entity, c: AnyComponentDef, edit: (d: unknown) => void) => { base.update(e, c, edit); note(c); },
        remove: (e: Entity, c: AnyComponentDef) => { version++; return base.remove(e, c); },
        enableChangeTracking: () => {},
        getWorldTick: () => tick,
        getWorldVersion: () => version,
        anyChangedSince: (c: AnyComponentDef, since: number) => (changedAt.get(c) ?? -1) > since,
        nextFrame: () => { tick++; },
        reads,
    };
    return world;
}

describe('GearApplySystem — idle frames are skipped', () => {
    let world: ReturnType<typeof makeTrackedWorld>;
    let e: Entity;
    const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 };
    const frame = (sys: SystemDef, dt = 1 / 60) => { world.nextFrame(); runSystem(sys, dt); };
    beforeEach(() => {
        world = makeTrackedWorld();
        e = world.spawn();
        world.insert(e, UIVisual, makeVisual());
        world.insert(e, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'a')] });
        world.insert(e, UIGear, { bindings: [gearBinding('tab', 'UIVisual', 'color', { a: red, b: blue })] } as UIGearData);
    });

    it('reads nothing from the world in a frame where nothing changed, once the gears have settled', () => {
        const sys = createGearApplySystem(world as never);
        frame(sys); frame(sys); frame(sys);               // the first pass applies, the next ones settle
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual(red);
        world.reads.get = 0; world.reads.has = 0;
        for (let i = 0; i < 20; i++) frame(sys);
        expect(world.reads.get + world.reads.has).toBe(0);
    });

    it('wakes for a controller page change and applies it', () => {
        const sys = createGearApplySystem(world as never);
        frame(sys); frame(sys); frame(sys);
        setControllerPage(world as never, e, 'tab', 'b');
        world.update(e, UIController, () => {});            // what setControllerPage's own write records
        frame(sys);
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual(blue);
    });

    it('keeps running while a tween is in flight, with nothing else changing, until it settles', () => {
        world.insert(e, UIGear, { bindings: [gearBinding('tab', 'UIVisual', 'color', { a: red, b: blue }, { duration: 0.5, easing: 0 })] } as UIGearData);
        const sys = createGearApplySystem(world as never);
        frame(sys); frame(sys);
        world.update(e, UIController, (d) => { (d as UIControllerData).controllers[0].current = 'b'; });
        frame(sys, 0.1);
        const early = (world.get(e, UIVisual) as UIVisualData).color.b;
        expect(early).toBeGreaterThan(0); expect(early).toBeLessThan(1);
        for (let i = 0; i < 10; i++) frame(sys, 0.1);       // no write to anything a gear reads: only the tween moves it
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual(blue);
        world.reads.get = 0; world.reads.has = 0;
        for (let i = 0; i < 5; i++) frame(sys, 0.1);
        expect(world.reads.get + world.reads.has).toBe(0);  // and once it has settled it sleeps again
    });

    it('wakes when the component a gear writes to arrives after the gear', () => {
        const other = world.spawn();
        world.insert(other, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'b')] });
        world.insert(other, UIGear, { bindings: [gearBinding('tab', 'UIVisual', 'color', { a: red, b: blue })] } as UIGearData);
        const sys = createGearApplySystem(world as never);
        frame(sys); frame(sys); frame(sys);                 // `other` has no UIVisual yet: nothing to write to
        expect(world.has(other, UIVisual)).toBe(false);
        world.insert(other, UIVisual, makeVisual());
        frame(sys);
        expect((world.get(other, UIVisual) as UIVisualData).color).toEqual(blue);
    });

    it('wakes when a node is hung under a different parent, so its controller is found again', () => {
        const bare = world.spawn(), root = world.spawn(), leaf = world.spawn();
        world.insert(root, UIController, { controllers: [controllerState('tab', ['a', 'b'], 'b')] });
        world.insert(leaf, UIVisual, makeVisual());
        world.insert(leaf, Parent, { entity: bare });       // it already hangs somewhere, so moving it adds no component
        world.insert(leaf, UIGear, { bindings: [gearBinding('tab', 'UIVisual', 'color', { a: red, b: blue })] } as UIGearData);
        const sys = createGearApplySystem(world as never);
        frame(sys); frame(sys); frame(sys);                 // no controller above it yet: left alone
        expect((world.get(leaf, UIVisual) as UIVisualData).color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        world.update(leaf, Parent, (d) => { (d as { entity: Entity }).entity = root; });
        frame(sys);
        expect((world.get(leaf, UIVisual) as UIVisualData).color).toEqual(blue);
    });

    it('wakes when the bindings themselves are rewritten', () => {
        const sys = createGearApplySystem(world as never);
        frame(sys); frame(sys); frame(sys);
        world.update(e, UIGear, (d) => { (d as UIGearData).bindings = [gearBinding('tab', 'UIVisual', 'color', { a: blue, b: red })]; });
        frame(sys);
        expect((world.get(e, UIVisual) as UIVisualData).color).toEqual(blue);
    });
});
