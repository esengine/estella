// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-state-visuals-fade.test.ts
 * @brief   StateVisualsApplySystem interpolates color/scale when
 *          fadeDuration > 0, and snaps otherwise.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Transform, type TransformData } from '../src/component';
import { StateMachine, type StateMachineData } from '../src/ui/behavior/state-machine';
import {
    StateVisuals,
    TransitionFlag,
    visualState,
    type StateVisualsData,
} from '../src/ui/behavior/state-visuals';
import { UIVisual, type UIVisualData } from '../src/ui/core/ui-visual';
import { createStateVisualsApplySystem } from '../src/ui/behavior/systems';
import type { Entity } from '../src/types';
import type { SystemDef } from '../src/system';
import type { AnyComponentDef } from '../src/component';

/**
 * Minimal World surface the apply system uses. Backed by per-component
 * Maps so builtin components (Transform, UIVisual, StateVisuals) don't
 * need a real C++ registry. Enough for behavior-level testing of the
 * fade logic.
 */
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

function makeVisuals(overrides: Partial<StateVisualsData>): StateVisualsData {
    return {
        targetGraphic: 0 as Entity,
        transitionFlags: 0,
        fadeDuration: 0,
        states: [],
        ...overrides,
    } as StateVisualsData;
}

function runSystem(system: SystemDef, dt: number): void {
    (system._fn as (...a: unknown[]) => void)({ delta: dt, elapsed: 0, frameCount: 0 });
}

function makeTransform(scale = 1): TransformData {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: scale, y: scale, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 },
        worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        worldScale: { x: scale, y: scale, z: 1 },
    };
}

function makeRenderer(color = { r: 1, g: 1, b: 1, a: 1 }, texture = 0): UIVisualData {
    return {
        texture, color, size: { x: 10, y: 10 },
        pivot: { x: 0.5, y: 0.5 }, layer: 0, enabled: true,
    } as UIVisualData;
}

describe('StateVisualsApplySystem — color fade', () => {
    let world: ReturnType<typeof makeMockWorld>;
    let entity: Entity;

    beforeEach(() => {
        world = makeMockWorld();
        entity = world.spawn();
        world.insert(entity, Transform, makeTransform());
        world.insert(entity, UIVisual, makeRenderer());
    });

    it('snaps immediately when fadeDuration is 0', () => {
        world.insert(entity, StateMachine, { current: 'pressed', previous: '' } as StateMachineData);
        world.insert(entity, StateVisuals, makeVisuals({
            transitionFlags: TransitionFlag.ColorTint,
            fadeDuration: 0,
            states: [visualState('pressed', { r: 0, g: 0, b: 1, a: 1 })],
        }));

        const sys = createStateVisualsApplySystem(world as never);
        runSystem(sys, 1 / 60);

        const r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    });

    it('interpolates color halfway at t = duration/2', () => {
        world.insert(entity, StateMachine, { current: 'pressed', previous: '' } as StateMachineData);
        world.insert(entity, StateVisuals, makeVisuals({
            transitionFlags: TransitionFlag.ColorTint,
            fadeDuration: 1.0,
            states: [visualState('pressed', { r: 0, g: 0, b: 0, a: 1 })],
        }));

        const sys = createStateVisualsApplySystem(world as never);
        runSystem(sys, 0);          // seed transition, t=0
        let r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color.r).toBeCloseTo(1);

        runSystem(sys, 0.5);         // advance to t=0.5
        r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color.r).toBeCloseTo(0.5, 2);
        expect(r.color.g).toBeCloseTo(0.5, 2);
        expect(r.color.b).toBeCloseTo(0.5, 2);
    });

    it('clamps to target at t >= duration', () => {
        world.insert(entity, StateMachine, { current: 'pressed', previous: '' } as StateMachineData);
        world.insert(entity, StateVisuals, makeVisuals({
            transitionFlags: TransitionFlag.ColorTint,
            fadeDuration: 0.5,
            states: [visualState('pressed', { r: 0, g: 0, b: 0, a: 1 })],
        }));

        const sys = createStateVisualsApplySystem(world as never);
        runSystem(sys, 0);
        runSystem(sys, 1.0);

        const r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });

    it('restarts the fade when the target slot changes mid-transition', () => {
        world.insert(entity, StateMachine, { current: 'a', previous: '' } as StateMachineData);
        world.insert(entity, StateVisuals, makeVisuals({
            transitionFlags: TransitionFlag.ColorTint,
            fadeDuration: 1.0,
            states: [
                visualState('a', { r: 0, g: 0, b: 0, a: 1 }),
                visualState('b', { r: 1, g: 0, b: 0, a: 1 }),
            ],
        }));

        const sys = createStateVisualsApplySystem(world as never);
        runSystem(sys, 0);
        runSystem(sys, 0.5);
        let r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color.r).toBeCloseTo(0.5, 1);

        const sm = world.get(entity, StateMachine) as StateMachineData;
        sm.current = 'b';
        world.insert(entity, StateMachine, sm);

        runSystem(sys, 0);
        r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color.r).toBeCloseTo(0.5, 1);

        runSystem(sys, 1.0);
        r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });
});

describe('StateVisualsApplySystem — scale fade', () => {
    it('lerps uniform scale across the fade window', () => {
        const world = makeMockWorld();
        const entity = world.spawn();
        world.insert(entity, Transform, makeTransform(1));
        world.insert(entity, UIVisual, makeRenderer());
        world.insert(entity, StateMachine, { current: 'pressed', previous: '' } as StateMachineData);
        world.insert(entity, StateVisuals, makeVisuals({
            transitionFlags: TransitionFlag.Scale,
            fadeDuration: 1.0,
            states: [visualState('pressed', { r: 1, g: 1, b: 1, a: 1 }, { scale: 2 })],
        }));

        const sys = createStateVisualsApplySystem(world as never);
        runSystem(sys, 0);
        runSystem(sys, 0.25);

        const t = world.get(entity, Transform) as TransformData;
        expect(t.scale.x).toBeCloseTo(1.25, 2);
        expect(t.scale.y).toBeCloseTo(1.25, 2);
    });
});

describe('StateVisualsApplySystem — sprite swap', () => {
    it('always snaps (never lerps) because textures are discrete', () => {
        const world = makeMockWorld();
        const entity = world.spawn();
        world.insert(entity, UIVisual, makeRenderer({ r: 1, g: 1, b: 1, a: 1 }, 7));
        world.insert(entity, StateMachine, { current: 'pressed', previous: '' } as StateMachineData);
        world.insert(entity, StateVisuals, makeVisuals({
            transitionFlags: TransitionFlag.SpriteSwap,
            fadeDuration: 1.0,
            states: [visualState('pressed', { r: 1, g: 1, b: 1, a: 1 }, { sprite: 42 })],
        }));

        const sys = createStateVisualsApplySystem(world as never);
        runSystem(sys, 0);

        const r = world.get(entity, UIVisual) as UIVisualData;
        expect(r.texture).toBe(42);
    });
});

// Silence any unused-import warnings
void vi;
