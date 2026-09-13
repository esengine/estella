// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: layers compose in ORDER. Mixing commutes and a stack does not, so
 * swapping two layers is a different character, and a layer at weight w is w of
 * the way from what is under it — never that field handed over whole.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, animatorLayerCount, layerState,
    migrateAnimatorController, ANIMATOR_FORMAT_VERSION,
    type AnimatorData, type AnimatorControllerDef, type AnimatorLayer,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { defineComponent, Name, Children, Parent } from '../src/ecs/component';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

const E = 1;

const probe = () => defineComponent('LayerProbe', {
    lift: 0, turn: 0, rot: { w: 1, x: 0, y: 0, z: 0 },
});

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        tryGet(e: number, c: unknown) { return mapOf(c).get(e) ?? null; },
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

function seedWorld() {
    const world = makeWorld();
    world.insert(E, probe(), { lift: 0, turn: 0, rot: { w: 1, x: 0, y: 0, z: 0 } });
    return world;
}

const read = (world: any) => world.get(E, probe()) as {
    lift: number; turn: number; rot: { w: number; x: number; y: number; z: number };
};

/** A clip holding the named fields for ten seconds. */
function hold(values: Record<string, number>): TimelineAsset {
    return {
        version: '1.2', type: 'timeline', duration: 10, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'LayerProbe', childPath: '', name: 't',
            channels: Object.entries(values).map(([property, value]) => ({
                property,
                keyframes: [{
                    time: 0, value, inTangent: 0, outTangent: 0,
                    interpolation: InterpType.Linear,
                }],
            })),
        }],
    } as TimelineAsset;
}

/** A clip ramping `property` from `from` to `to` over ten seconds. */
function ramp(property: string, from: number, to: number): TimelineAsset {
    const key = (time: number, value: number) => ({
        time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear,
    });
    return {
        version: '1.2', type: 'timeline', duration: 10, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'LayerProbe', childPath: '', name: 't',
            channels: [{ property, keyframes: [key(0, from), key(10, to)] }],
        }],
    } as TimelineAsset;
}

const clip = (name: string) => ({ kind: TIMELINE_MOTION, clip: name });

/** One state named `Hold` playing `name`. */
const oneState = (name: string) => ({
    states: [{ name: 'Hold', motion: clip(name), transitions: [] }],
    initialState: 'Hold',
});

function build(
    assets: Record<string, TimelineAsset>,
    base: string,
    layers: AnimatorLayer[],
    parameters: AnimatorControllerDef['parameters'] = [],
): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    for (const [name, asset] of Object.entries(assets)) timeline.registerAsset(name, asset);
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    ctrl.registerController('rig', { parameters, ...oneState(base), layers });
    return ctrl;
}

function attach(world: any): void {
    world.insert(E, Animator, {
        controller: 'rig', currentState: '', layerStates: [], enabled: true,
    } as AnimatorData);
}

const over = (name: string, patch: Partial<AnimatorLayer> = {}): AnimatorLayer =>
    ({ name: `over-${name}`, ...oneState(name), ...patch });

describe('a stack of layers', () => {
    const assets = {
        'low.estimeline': hold({ lift: 0 }),
        'high.estimeline': hold({ lift: 100 }),
    };

    it('counts the base layer as one of them', () => {
        const def: AnimatorControllerDef = {
            parameters: [], ...oneState('low.estimeline'), layers: [over('high.estimeline')],
        };
        expect(animatorLayerCount(def)).toBe(2);
        expect(animatorLayerCount({ parameters: [], ...oneState('low.estimeline') })).toBe(1);
    });

    it('lets a layer at full weight state the field outright', () => {
        const world = seedWorld();
        const ctrl = build(assets, 'low.estimeline', [over('high.estimeline')]);
        attach(world);

        ctrl.update(world, 0.016);

        expect(read(world).lift).toBeCloseTo(100, 4);
    });

    it('leans the stack partway at a partial weight', () => {
        const world = seedWorld();
        const ctrl = build(assets, 'low.estimeline', [over('high.estimeline', { weight: 0.25 })]);
        attach(world);

        ctrl.update(world, 0.016);

        // Not 100 (handed over) and not 0 (ignored): a quarter of the way.
        expect(read(world).lift).toBeCloseTo(25, 4);
    });

    it('leaves what is under it alone at weight zero', () => {
        const world = seedWorld();
        const ctrl = build(assets, 'low.estimeline', [over('high.estimeline', { weight: 0 })]);
        attach(world);

        ctrl.update(world, 0.016);

        expect(read(world).lift).toBeCloseTo(0, 6);
    });

    it('is a DIFFERENT character when the two layers are swapped', () => {
        // The property that separates a stack from a mix. If this passes with the
        // order reversed, composition has collapsed into an average and every
        // other claim in this file is trivially satisfied.
        const stacked = (base: string, top: string) => {
            const world = seedWorld();
            const ctrl = build(assets, base, [over(top, { weight: 0.25 })]);
            attach(world);
            ctrl.update(world, 0.016);
            return read(world).lift;
        };

        expect(stacked('low.estimeline', 'high.estimeline')).toBeCloseTo(25, 4);
        expect(stacked('high.estimeline', 'low.estimeline')).toBeCloseTo(75, 4);
    });

    it('writes the world once, as the stack rather than as the top layer', () => {
        // The base states `turn` and nothing above it does. A layer overwriting
        // the entity on its own would leave `turn` at the world's value.
        const world = seedWorld();
        const ctrl = build({
            'low.estimeline': hold({ lift: 0, turn: 42 }),
            'high.estimeline': hold({ lift: 100 }),
        }, 'low.estimeline', [over('high.estimeline')]);
        attach(world);

        ctrl.update(world, 0.016);

        expect(read(world).lift).toBeCloseTo(100, 4);
        expect(read(world).turn).toBeCloseTo(42, 4);
    });
});

describe('an additive layer', () => {
    const assets = {
        'walk.estimeline': hold({ lift: 10 }),
        'run.estimeline': hold({ lift: 200 }),
        // Departs from 0 and reaches 50 — what it ADDS is 0 at the start.
        'lean.estimeline': ramp('lift', 0, 50),
    };

    it('adds what its clip departed from its own start, not from the layer below', () => {
        const world = seedWorld();
        const ctrl = build(assets, 'walk.estimeline',
                           [over('lean.estimeline', { blend: 'additive' })]);
        attach(world);
        ctrl.update(world, 0);
        ctrl.update(world, 5);   // half of the ramp: it has departed by 25

        expect(read(world).lift).toBeCloseTo(35, 3);
    });

    it('means the same thing over a different base', () => {
        // The point of additive: the same lean over a run is the same departure.
        // Measured against what is underneath instead, it would land at 25.
        const world = seedWorld();
        const ctrl = build(assets, 'run.estimeline',
                           [over('lean.estimeline', { blend: 'additive' })]);
        attach(world);
        ctrl.update(world, 0);
        ctrl.update(world, 5);

        expect(read(world).lift).toBeCloseTo(225, 3);
    });

    it('scales the departure by the layer weight', () => {
        const world = seedWorld();
        const ctrl = build(assets, 'walk.estimeline',
                           [over('lean.estimeline', { blend: 'additive', weight: 0.5 })]);
        attach(world);
        ctrl.update(world, 0);
        ctrl.update(world, 5);

        expect(read(world).lift).toBeCloseTo(22.5, 3);
    });
});

describe('each layer runs its own machine', () => {
    const assets = {
        'idle.estimeline': hold({ lift: 0 }),
        'walk.estimeline': hold({ lift: 100 }),
        'calm.estimeline': hold({ turn: 0 }),
        'wave.estimeline': hold({ turn: 90 }),
    };

    /** Base: idle → walk on `moving`. Upper: calm → wave on the `greet` trigger. */
    function twoMachines(): AnimatorControllerAPI {
        const timeline = new TimelineAPI();
        for (const [name, asset] of Object.entries(assets)) timeline.registerAsset(name, asset);
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.registerController('rig', {
            parameters: [
                { name: 'moving', type: 'bool', default: false },
                { name: 'greet', type: 'trigger' },
            ],
            initialState: 'Idle',
            states: [
                {
                    name: 'Idle', motion: clip('idle.estimeline'),
                    transitions: [{ to: 'Walk', conditions: [{ param: 'moving', op: 'true' }] }],
                },
                { name: 'Walk', motion: clip('walk.estimeline'), transitions: [] },
            ],
            layers: [{
                name: 'arms',
                initialState: 'Calm',
                states: [
                    {
                        name: 'Calm', motion: clip('calm.estimeline'),
                        transitions: [{ to: 'Wave', conditions: [{ param: 'greet', op: 'trigger' }] }],
                    },
                    { name: 'Wave', motion: clip('wave.estimeline'), transitions: [] },
                ],
            }],
        });
        return ctrl;
    }

    it('moves one layer without moving the other', () => {
        const world = seedWorld();
        const ctrl = twoMachines();
        attach(world);
        ctrl.update(world, 0.016);

        ctrl.setBool(E, 'moving', true);
        ctrl.update(world, 0.016);

        const a = world.get(E, Animator) as AnimatorData;
        expect(layerState(a, 0)).toBe('Walk');
        expect(layerState(a, 1)).toBe('Calm');
        expect(read(world).lift).toBeCloseTo(100, 4);
        expect(read(world).turn).toBeCloseTo(0, 4);
    });

    it('keeps each layer’s state in one place', () => {
        const world = seedWorld();
        const ctrl = twoMachines();
        attach(world);
        ctrl.update(world, 0.016);
        ctrl.setTrigger(E, 'greet');
        ctrl.update(world, 0.016);

        const a = world.get(E, Animator) as AnimatorData;
        expect(a.currentState).toBe('Idle');
        expect(a.layerStates[0]).toBe('Wave');
        expect(read(world).turn).toBeCloseTo(90, 4);
    });

    it('tells every layer about a trigger, not whichever was stepped first', () => {
        // Both machines answer `greet`. Consumed as each layer fires, the base
        // would eat it and the arms would never wave.
        const world = seedWorld();
        const timeline = new TimelineAPI();
        for (const [name, asset] of Object.entries(assets)) timeline.registerAsset(name, asset);
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        const answersGreet = (from: string, to: string, a: string, b: string) => ({
            initialState: from,
            states: [
                {
                    name: from, motion: clip(a),
                    transitions: [{ to, conditions: [{ param: 'greet', op: 'trigger' as const }] }],
                },
                { name: to, motion: clip(b), transitions: [] },
            ],
        });
        ctrl.registerController('rig', {
            parameters: [{ name: 'greet', type: 'trigger' }],
            ...answersGreet('Idle', 'Walk', 'idle.estimeline', 'walk.estimeline'),
            layers: [{ name: 'arms', ...answersGreet('Calm', 'Wave', 'calm.estimeline', 'wave.estimeline') }],
        });
        attach(world);
        ctrl.update(world, 0.016);

        ctrl.setTrigger(E, 'greet');
        ctrl.update(world, 0.016);

        const a = world.get(E, Animator) as AnimatorData;
        expect(a.currentState).toBe('Walk');
        expect(a.layerStates[0]).toBe('Wave');
    });
});

// ---------------------------------------------------------------------------
// What a file is allowed to claim
// ---------------------------------------------------------------------------

describe('the controller format guard', () => {
    const v1 = () => ({
        parameters: [], initialState: 'Idle',
        states: [{ name: 'Idle', transitions: [] }],
    });

    it('reads a file written before layers existed as a stack of one', () => {
        const { def, migrated, fromVersion } = migrateAnimatorController(v1());
        expect(fromVersion).toBe(1);
        expect(migrated).toBe(true);
        expect(def.version).toBe(ANIMATOR_FORMAT_VERSION);
        expect(animatorLayerCount(def)).toBe(1);
    });

    it('leaves a current file alone, however many times it is asked', () => {
        const current = { ...v1(), version: ANIMATOR_FORMAT_VERSION };
        const once = migrateAnimatorController(current);
        const twice = migrateAnimatorController(once.def);
        expect(once.migrated).toBe(false);
        expect(twice.def).toEqual(once.def);
    });

    it('refuses a file from a later build instead of reading half of it', () => {
        // The whole point of the stamp: a controller whose layers this build
        // cannot see animates a visibly wrong character and reports nothing.
        expect(() => migrateAnimatorController({ ...v1(), version: ANIMATOR_FORMAT_VERSION + 1 }))
            .toThrow(/version/);
    });

    it('folds the four older spellings of a motion into the one', () => {
        // A v1 file could say what a state plays as `clip`, `blend` or `spine`.
        // Left alone, every later reader has to ask four questions — which is how
        // the editor's node label came to answer only three of them.
        const { def } = migrateAnimatorController({
            parameters: [{ name: 'speed', type: 'float' }],
            initialState: 'Idle',
            states: [
                { name: 'Idle', clip: 'idle', speed: 2, loop: true, transitions: [] },
                { name: 'Talk', spine: { animation: 'talk', loop: false }, transitions: [] },
                {
                    name: 'Move', transitions: [],
                    blend: { parameter: 'speed', thresholds: [{ value: 0, clip: 'walk' }] },
                },
                {
                    name: 'Combat', transitions: [],
                    stateMachine: { initialState: 'Swing', states: [{ name: 'Swing', clip: 'swing', transitions: [] }] },
                },
            ],
        });

        const byName = new Map(def.states.map((s) => [s.name, s]));
        expect(byName.get('Idle')!.motion).toEqual({ kind: 'sprite', clip: 'idle', speed: 2, loop: true });
        expect(byName.get('Talk')!.motion).toEqual({ kind: 'spine', clip: 'talk', loop: false });
        expect(byName.get('Move')!.motion).toMatchObject({ kind: 'blend1d', parameter: 'speed' });
        // Down a nested machine too, or a sub-state keeps the old shape alone.
        expect(byName.get('Combat')!.stateMachine!.states[0]!.motion)
            .toEqual({ kind: 'sprite', clip: 'swing', speed: undefined, loop: undefined });

        // And the older spellings are GONE, not merely shadowed.
        for (const state of def.states) {
            expect(state.clip).toBeUndefined();
            expect(state.blend).toBeUndefined();
            expect(state.spine).toBeUndefined();
        }
    });

    it('folds them inside a layer as well', () => {
        const { def } = migrateAnimatorController({
            parameters: [], initialState: 'Idle',
            states: [{ name: 'Idle', transitions: [] }],
            layers: [{
                name: 'Upper', initialState: 'Wave',
                states: [{ name: 'Wave', clip: 'wave', transitions: [] }],
            }],
        });
        expect(def.layers![0]!.states[0]!.motion).toMatchObject({ kind: 'sprite', clip: 'wave' });
        expect(def.layers![0]!.states[0]!.clip).toBeUndefined();
    });

    it('refuses a layer that is not a machine', () => {
        expect(() => migrateAnimatorController({ ...v1(), layers: [{ name: 'arms' }] }))
            .toThrow(/layer/);
        expect(() => migrateAnimatorController({ ...v1(), layers: {} })).toThrow(/layers/);
    });
});

// ---------------------------------------------------------------------------
// What a layer is allowed to touch
// ---------------------------------------------------------------------------

/**
 * A rig: root → `hips` → `legs`, root → `chest` → `arms`. Names are what a
 * childPath resolves through, so the mask and the clips address it the same way.
 */
function rig(world: any): Record<string, number> {
    const ids = { root: E, hips: 2, legs: 3, chest: 4, arms: 5 };
    const link = (parent: number, child: number, name: string) => {
        world.insert(child, Name, { value: name });
        world.insert(child, Parent, { entity: parent });
        const held = world.tryGet(parent, Children) as { entities: number[] } | null;
        world.insert(parent, Children, { entities: [...(held?.entities ?? []), child] });
        world.insert(child, probe(), { lift: 0, turn: 0, rot: { w: 1, x: 0, y: 0, z: 0 } });
    };
    world.insert(ids.root, Name, { value: 'root' });
    link(ids.root, ids.hips, 'hips');
    link(ids.hips, ids.legs, 'legs');
    link(ids.root, ids.chest, 'chest');
    link(ids.chest, ids.arms, 'arms');
    return ids;
}

/** A clip writing `lift` on every joint of the rig. */
function wholeBody(lift: number): TimelineAsset {
    const channel = (childPath: string) => ({
        type: TrackType.Property, component: 'LayerProbe', childPath, name: childPath || 'root',
        channels: [{
            property: 'lift',
            keyframes: [{
                time: 0, value: lift, inTangent: 0, outTangent: 0,
                interpolation: InterpType.Linear,
            }],
        }],
    });
    return {
        version: '1.2', type: 'timeline', duration: 10, wrapMode: WrapMode.Loop,
        tracks: ['', 'hips', 'hips/legs', 'chest', 'chest/arms'].map(channel),
    } as TimelineAsset;
}

describe('a masked layer', () => {
    const assets = {
        'base.estimeline': wholeBody(10),
        'upper.estimeline': wholeBody(90),
    };
    const liftAt = (world: any, e: number) => (world.get(e, probe()) as { lift: number }).lift;

    function run(mask: { paths: string[] } | undefined, weight = 1) {
        const world = seedWorld();
        const ids = rig(world);
        const ctrl = build(assets, 'base.estimeline',
                           [over('upper.estimeline', { mask, weight })]);
        attach(world);
        ctrl.update(world, 0.016);
        return { world, ids };
    }

    it('writes the subtree it names, root included', () => {
        const { world, ids } = run({ paths: ['chest'] });
        expect(liftAt(world, ids.chest)).toBeCloseTo(90, 4);
        expect(liftAt(world, ids.arms)).toBeCloseTo(90, 4);
    });

    it('leaves everything outside it exactly as the layer below left it', () => {
        // Not "close to" the base value — the same number. A mask that merely
        // reduced the weight outside itself would still read as nearly right.
        const { world, ids } = run({ paths: ['chest'] });
        expect(liftAt(world, ids.hips)).toBe(10);
        expect(liftAt(world, ids.legs)).toBe(10);
        expect(liftAt(world, ids.root)).toBe(10);
    });

    it('carries the layer weight inside the mask and nothing outside it', () => {
        const { world, ids } = run({ paths: ['chest'] }, 0.5);
        expect(liftAt(world, ids.arms)).toBeCloseTo(50, 4);
        expect(liftAt(world, ids.legs)).toBe(10);
    });

    it('writes the whole rig when there is no mask', () => {
        const { world, ids } = run(undefined);
        expect(liftAt(world, ids.legs)).toBeCloseTo(90, 4);
        expect(liftAt(world, ids.arms)).toBeCloseTo(90, 4);
    });

    it('writes nothing for a mask that names nothing', () => {
        // An empty path list is a layer switched off, which is different from
        // having no mask — and the two must not read the same.
        const { world, ids } = run({ paths: [] });
        expect(liftAt(world, ids.legs)).toBe(10);
        expect(liftAt(world, ids.arms)).toBe(10);
    });

    it('ignores a path that names no joint on this rig', () => {
        const { world, ids } = run({ paths: ['chest', 'tail'] });
        expect(liftAt(world, ids.arms)).toBeCloseTo(90, 4);
        expect(liftAt(world, ids.legs)).toBe(10);
    });
});
