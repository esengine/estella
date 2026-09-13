// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a constraint puts the joint it names WHERE it names, measured as a
 * distance rather than as "the limb looks bent". It reads the pose this frame
 * stated, not the world's record of the last one.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, solveAnimatorIK, Pose,
    type AnimatorData, type AnimatorControllerDef, type AnimatorIK,
} from '../src/animation';
import { Parent, Children, Name, Transform } from '../src/ecs/component';
import { q } from '../src/math/quat';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

interface Vec3 { x: number; y: number; z: number }

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
            const d = mapOf(c).get(e); edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

const RIG = 1;
const identity = () => ({ w: 1, x: 0, y: 0, z: 0 });

/**
 * A straight arm along +X: rig → upper → fore → hand, each one unit out, plus a
 * target the game moves. Straight on purpose — a limb already bent would hide a
 * solver that only ever keeps the bend it found.
 */
function arm(world: any, targetAt: Vec3) {
    const ids = { rig: RIG, upper: 2, fore: 3, hand: 4, target: 5, pole: 6 };
    const node = (id: number, parent: number | null, name: string, at: Vec3) => {
        world.insert(id, Name, { value: name });
        world.insert(id, Transform, { position: at, rotation: identity(), scale: { x: 1, y: 1, z: 1 } });
        if (parent !== null) {
            world.insert(id, Parent, { entity: parent });
            const held = world.tryGet(parent, Children) as { entities: number[] } | null;
            world.insert(parent, Children, { entities: [...(held?.entities ?? []), id] });
        }
    };
    node(ids.rig, null, 'Rig', { x: 0, y: 0, z: 0 });
    node(ids.upper, ids.rig, 'Upper', { x: 1, y: 0, z: 0 });
    node(ids.fore, ids.upper, 'Fore', { x: 1, y: 0, z: 0 });
    node(ids.hand, ids.fore, 'Hand', { x: 1, y: 0, z: 0 });
    node(ids.target, ids.rig, 'Target', targetAt);
    node(ids.pole, ids.rig, 'Pole', { x: 1, y: 0, z: 2 });
    return ids;
}

/** Where `childPath` ends up in rig space once `pose` is written to the world. */
function placeOf(world: any, path: string): Vec3 {
    const names = path.split('/');
    let at = { x: 0, y: 0, z: 0 };
    let rot = identity();
    let entity = RIG;
    for (const name of names) {
        const children = (world.tryGet(entity, Children) as { entities: number[] } | null)?.entities ?? [];
        const found = children.find((c) => (world.tryGet(c, Name) as { value: string }).value === name);
        entity = found!;
        const t = world.get(entity, Transform) as { position: Vec3; rotation: any };
        const offset = q.rotate(rot, t.position);
        at = { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z };
        rot = q.normalize(q.mul(rot, t.rotation));
    }
    return at;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Solve `ik` against a fresh straight arm reaching for `targetAt`. */
function reach(targetAt: Vec3, ik: Partial<AnimatorIK> = {}): { world: any; hand: Vec3 } {
    const world = makeWorld();
    arm(world, targetAt);
    const pose = new Pose();
    pose.reset();
    solveAnimatorIK(world, RIG, pose, [{
        kind: 'two-bone', tip: 'Upper/Fore/Hand', target: 'Target', ...ik,
    } as AnimatorIK], {});
    pose.applyTo(world);
    return { world, hand: placeOf(world, 'Upper/Fore/Hand') };
}

describe('two-bone IK', () => {
    it('puts the tip on a target inside its reach', () => {
        // The arm is 2 units long and the target is 1.5 away: a triangle exists,
        // so the hand lands ON it, not near it.
        const target = { x: 1.0, y: 1.118033988, z: 0 };
        const { hand } = reach(target);
        expect(dist(hand, target)).toBeLessThan(1e-3);
    });

    it('reaches as far as it can toward one it cannot get to', () => {
        // Five units from a two-unit arm. The hand cannot arrive, so the limb
        // straightens ALONG the line instead — a solver that quietly gave up
        // would leave it where the clip put it.
        const shoulder = { x: 1, y: 0, z: 0 };
        const target = { x: 0, y: 5, z: 0 };
        const { hand } = reach(target);
        expect(dist(hand, shoulder)).toBeCloseTo(2, 2);

        const unit = (a: Vec3, b: Vec3) => {
            const d = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
            const l = Math.hypot(d.x, d.y, d.z);
            return { x: d.x / l, y: d.y / l, z: d.z / l };
        };
        const went = unit(hand, shoulder);
        const wanted = unit(target, shoulder);
        expect(went.x).toBeCloseTo(wanted.x, 3);
        expect(went.y).toBeCloseTo(wanted.y, 3);
    });

    it('leaves the pose alone at weight zero', () => {
        const { hand } = reach({ x: 1, y: 1, z: 0 }, { weight: 0 });
        expect(hand).toEqual({ x: 3, y: 0, z: 0 });
    });

    it('goes part of the way at a partial weight', () => {
        // Not "somewhere between": closer than untouched and further than solved,
        // which is what makes this different from having no weight at all.
        const target = { x: 1.0, y: 1.118033988, z: 0 };
        const full = dist(reach(target).hand, target);
        const half = dist(reach(target, { weight: 0.5 }).hand, target);
        const none = dist(reach(target, { weight: 0 }).hand, target);
        expect(full).toBeLessThan(half);
        expect(half).toBeLessThan(none);
    });

    it('scales the authored weight by the parameter a game drives', () => {
        const world = makeWorld();
        arm(world, { x: 1.0, y: 1.118033988, z: 0 });
        const pose = new Pose();
        pose.reset();
        solveAnimatorIK(world, RIG, pose, [{
            kind: 'two-bone', tip: 'Upper/Fore/Hand', target: 'Target', parameter: 'plant',
        }], { plant: 0 });
        pose.applyTo(world);
        expect(placeOf(world, 'Upper/Fore/Hand')).toEqual({ x: 3, y: 0, z: 0 });
    });

    it('bends toward the pole it was given', () => {
        // The same target, two poles: the elbow has to end up on opposite sides,
        // or the pole is a field nothing reads.
        const target = { x: 1.0, y: 1.118033988, z: 0 };
        const front = reach(target, { pole: 'Pole' });
        const elbowFront = placeOf(front.world, 'Upper/Fore');

        const world = makeWorld();
        const ids = arm(world, target);
        world.update(ids.pole, Transform, (t: any) => { t.position = { x: 1, y: 0, z: -2 }; });
        const pose = new Pose();
        pose.reset();
        solveAnimatorIK(world, RIG, pose, [{
            kind: 'two-bone', tip: 'Upper/Fore/Hand', target: 'Target', pole: 'Pole',
        }], {});
        pose.applyTo(world);
        const elbowBack = placeOf(world, 'Upper/Fore');

        expect(Math.sign(elbowFront.z)).not.toBe(Math.sign(elbowBack.z));
        expect(Math.abs(elbowFront.z)).toBeGreaterThan(0.1);
    });

    it('states nothing for a joint that is not under the rig', () => {
        const world = makeWorld();
        arm(world, { x: 1, y: 1, z: 0 });
        const pose = new Pose();
        pose.reset();
        solveAnimatorIK(world, RIG, pose, [{
            kind: 'two-bone', tip: 'Upper/Nothing/Here', target: 'Target',
        }], {});
        expect(pose.tracks.filter((t) => t.touched.size > 0)).toHaveLength(0);
    });
});

describe('look-at IK', () => {
    it('turns the joint so its own axis points at the target', () => {
        const world = makeWorld();
        arm(world, { x: 1, y: 0, z: 3 });
        const pose = new Pose();
        pose.reset();
        solveAnimatorIK(world, RIG, pose, [{
            kind: 'look-at', tip: 'Upper/Fore/Hand', target: 'Target', axis: 'x',
        }], {});
        pose.applyTo(world);

        // The hand sits at (3,0,0) and the target at (1,0,3): its +X must end up
        // along (-2, 0, 3) normalized.
        const hand = world.get(4, Transform) as { rotation: { w: number; x: number; y: number; z: number } };
        const rot = hand.rotation;
        const { w, x, y, z } = rot;
        const facing = {
            x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y),
        };
        const want = { x: -2 / Math.hypot(2, 3), y: 0, z: 3 / Math.hypot(2, 3) };
        expect(facing.x).toBeCloseTo(want.x, 3);
        expect(facing.z).toBeCloseTo(want.z, 3);
    });
});

describe('a constraint through the animator', () => {
    /**
     * A rig with a joint ABOVE the chain: Rig → Spine → Upper → Fore → Hand. What
     * the spine does moves the shoulder, so where the arm can reach depends on the
     * pose this frame — which is the only geometry where reading the world instead
     * gives a different answer at all.
     */
    function spined(world: any, targetAt: Vec3) {
        const node = (id: number, parent: number | null, name: string, at: Vec3) => {
            world.insert(id, Name, { value: name });
            world.insert(id, Transform, { position: at, rotation: identity(), scale: { x: 1, y: 1, z: 1 } });
            if (parent !== null) {
                world.insert(id, Parent, { entity: parent });
                const held = world.tryGet(parent, Children) as { entities: number[] } | null;
                world.insert(parent, Children, { entities: [...(held?.entities ?? []), id] });
            }
        };
        node(RIG, null, 'Rig', { x: 0, y: 0, z: 0 });
        node(2, RIG, 'Spine', { x: 0, y: 1, z: 0 });
        node(3, 2, 'Upper', { x: 1, y: 0, z: 0 });
        node(4, 3, 'Fore', { x: 1, y: 0, z: 0 });
        node(5, 4, 'Hand', { x: 1, y: 0, z: 0 });
        node(6, RIG, 'Target', targetAt);
    }

    /** A clip turning the spine a quarter turn about Z, every frame. */
    function turnsSpine(): TimelineAsset {
        const key = (value: number) => ([
            { time: 0, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
        ]);
        return {
            version: '1.2', type: 'timeline', duration: 10, wrapMode: WrapMode.Loop,
            tracks: [{
                type: TrackType.Property, component: 'Transform', childPath: 'Spine', name: 's',
                channels: [
                    { property: 'rotation.x', keyframes: key(0) },
                    { property: 'rotation.y', keyframes: key(0) },
                    { property: 'rotation.z', keyframes: key(-Math.SQRT1_2) },
                    { property: 'rotation.w', keyframes: key(Math.SQRT1_2) },
                ],
            }],
        } as TimelineAsset;
    }

    it('bends the pose the layers just stated, not the world before them', () => {
        // Spine turned: the shoulder is at the origin, the target 1.5 away and
        // reachable. Read from the world, where it has not turned yet, the
        // shoulder is at (1,1,0) and the target 2.7 away — out of reach.
        const world = makeWorld();
        const target = { x: 0, y: -1.5, z: 0 };
        spined(world, target);

        const timeline = new TimelineAPI();
        timeline.registerAsset('turn.estimeline', turnsSpine());
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.registerController('rig', {
            version: 2, parameters: [], initialState: 'Turn',
            states: [{
                name: 'Turn', transitions: [],
                motion: { kind: TIMELINE_MOTION, clip: 'turn.estimeline', loop: true },
            }],
            ik: [{ kind: 'two-bone', tip: 'Spine/Upper/Fore/Hand', target: 'Target' }],
        } as AnimatorControllerDef);
        world.insert(RIG, Animator, {
            controller: 'rig', avatar: '', currentState: '', layerStates: [], enabled: true,
        } as AnimatorData);

        ctrl.update(world, 0.016);
        expect(dist(placeOf(world, 'Spine/Upper/Fore/Hand'), target)).toBeLessThan(1e-3);
    });
});
