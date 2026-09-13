// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: ONE clip drives two rigs whose bones are named differently, at the
 * same time, without a copy of the clip per rig.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, parseAvatar, emptyAvatar, avatarResolver,
    travelRatio, AnimatorRootMotion,
    type AnimatorData, type AnimatorControllerDef, type AnimatorAvatar,
} from '../src/animation';
import { Parent, Children, Name, Transform } from '../src/ecs/component';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

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

/** A rig whose one joint is called `boneName`, rooted at `root`. */
function rig(world: any, root: number, joint: number, boneName: string) {
    const place = (id: number, name: string) => {
        world.insert(id, Name, { value: name });
        world.insert(id, Transform, {
            position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
        });
    };
    place(root, `Rig${root}`);
    place(joint, boneName);
    world.insert(joint, Parent, { entity: root });
    world.insert(root, Children, { entities: [joint] });
}

/** A clip turning whatever joint `childPath` names a quarter turn about Z. */
function turn(childPath: string): TimelineAsset {
    const key = (value: number) => ([
        { time: 0, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
    ]);
    return {
        version: '1.2', type: 'timeline', duration: 10, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'Transform', childPath, name: 't',
            channels: [
                { property: 'rotation.x', keyframes: key(0) },
                { property: 'rotation.y', keyframes: key(0) },
                { property: 'rotation.z', keyframes: key(Math.SQRT1_2) },
                { property: 'rotation.w', keyframes: key(Math.SQRT1_2) },
            ],
        }],
    } as TimelineAsset;
}

const turnedZ = (world: any, entity: number) =>
    Number((world.get(entity, Transform) as { rotation: { z: number } }).rotation.z);

/** One controller playing one clip, with avatars resolved from a table. */
function controllerWith(avatars: Record<string, AnimatorAvatar>): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    timeline.registerAsset('wave.estimeline', turn('Arm'));
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    ctrl.useAssetAvatars((ref) => avatars[ref]);
    ctrl.registerController('rig', {
        version: 2, parameters: [], initialState: 'Wave',
        states: [{
            name: 'Wave', transitions: [],
            motion: { kind: TIMELINE_MOTION, clip: 'wave.estimeline', loop: true },
        }],
    } as AnimatorControllerDef);
    return ctrl;
}

const attach = (world: any, entity: number, avatar: string) =>
    world.insert(entity, Animator, {
        controller: 'rig', avatar, currentState: '', layerStates: [], enabled: true,
    } as AnimatorData);

describe('reading an avatar', () => {
    it('keeps only the joints that differ', () => {
        // A name mapped to itself is what having no entry already means; keeping
        // both spellings of that would be two records of one fact.
        const avatar = parseAvatar({ joints: { Arm: 'mixamorig:LeftArm', Head: 'Head' } });
        expect(avatar.joints).toEqual({ Arm: 'mixamorig:LeftArm' });
    });

    it('refuses a file from a later build, and a shape that is not one', () => {
        expect(() => parseAvatar({ joints: {}, version: 99 })).toThrow(/version/);
        expect(() => parseAvatar({ joints: [] })).toThrow(/joints/);
        expect(() => parseAvatar({ joints: { Arm: 7 } })).toThrow(/childPath/);
        expect(() => parseAvatar(null)).toThrow(/object/);
    });

    it('starts blank, translating nothing', () => {
        expect(emptyAvatar().joints).toEqual({});
    });

    it('resolves a path with no entry as itself', () => {
        const world = makeWorld();
        rig(world, 1, 2, 'Arm');
        const resolve = avatarResolver(world, parseAvatar({ joints: { Leg: 'Thigh' } }));
        expect(resolve(1, 'Arm')).toBe(2);
        expect(resolve(1, 'Missing')).toBeNull();
    });
});

describe('one clip over two rigs', () => {
    it('drives both, each by its own bone names, in the same frame', () => {
        // The point of the whole thing. The clip names `Arm`; one rig calls that
        // joint `Arm` and the other `mixamorig:LeftArm`, and neither needs a copy
        // of the clip nor a controller of its own.
        const world = makeWorld();
        rig(world, 1, 2, 'Arm');
        rig(world, 10, 11, 'mixamorig:LeftArm');

        const imported = parseAvatar({ joints: { Arm: 'mixamorig:LeftArm' } });
        const ctrl = controllerWith({ 'assets/imported.esavatar': imported });
        attach(world, 1, '');
        attach(world, 10, 'assets/imported.esavatar');

        ctrl.update(world, 0.016);

        expect(turnedZ(world, 2)).toBeCloseTo(Math.SQRT1_2, 4);
        expect(turnedZ(world, 11)).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('leaves the rig alone when the avatar names a joint it has not got', () => {
        const world = makeWorld();
        rig(world, 1, 2, 'Arm');
        const wrong = parseAvatar({ joints: { Arm: 'NoSuchBone' } });
        const ctrl = controllerWith({ 'assets/wrong.esavatar': wrong });
        attach(world, 1, 'assets/wrong.esavatar');

        ctrl.update(world, 0.016);
        expect(turnedZ(world, 2)).toBe(0);
    });

    it('translates the joints a MASK names as well', () => {
        // A mask is the controller talking about a rig it has never seen, same as
        // a clip and a constraint. Resolved without the avatar it admits nothing,
        // and a layer that writes nothing looks exactly like one that is off.
        const world = makeWorld();
        rig(world, 1, 2, 'mixamorig:LeftArm');
        const avatar = parseAvatar({ joints: { Arm: 'mixamorig:LeftArm' } });

        const timeline = new TimelineAPI();
        timeline.registerAsset('wave.estimeline', turn('Arm'));
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.useAssetAvatars(() => avatar);
        ctrl.registerController('rig', {
            version: 2, parameters: [], initialState: 'Rest',
            states: [{ name: 'Rest', transitions: [] }],
            layers: [{
                name: 'Upper', mask: { paths: ['Arm'] }, initialState: 'Wave',
                states: [{
                    name: 'Wave', transitions: [],
                    motion: { kind: TIMELINE_MOTION, clip: 'wave.estimeline', loop: true },
                }],
            }],
        } as AnimatorControllerDef);
        attach(world, 1, 'assets/a.esavatar');

        ctrl.update(world, 0.016);
        expect(turnedZ(world, 2)).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('translates the joints a CONSTRAINT names as well', () => {
        // A constraint addresses joints the same way a clip does, so a rig whose
        // avatar renames one has to have it renamed here too — or IK reaches for
        // a joint the clip is no longer driving.
        const world = makeWorld();
        rig(world, 1, 2, 'mixamorig:LeftArm');
        // A second joint on the same rig, to aim at.
        world.insert(3, Name, { value: 'Goal' });
        world.insert(3, Transform, {
            position: { x: 0, y: 100, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
        });
        world.insert(3, Parent, { entity: 1 });
        world.insert(1, Children, { entities: [2, 3] });
        world.update(2, Transform, (t: any) => { t.position = { x: 50, y: 0, z: 0 }; });

        const avatar = parseAvatar({ joints: { Arm: 'mixamorig:LeftArm' } });
        const timeline = new TimelineAPI();
        timeline.registerAsset('wave.estimeline', turn('Arm'));
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.useAssetAvatars(() => avatar);
        ctrl.registerController('rig', {
            version: 2, parameters: [], initialState: 'Wave',
            states: [{
                name: 'Wave', transitions: [],
                motion: { kind: TIMELINE_MOTION, clip: 'wave.estimeline', loop: true },
            }],
            // Names the joint the CLIP's way; the avatar has to reach it.
            ik: [{ kind: 'look-at', tip: 'Arm', target: 'Goal', axis: 'x' }],
        } as AnimatorControllerDef);
        attach(world, 1, 'assets/a.esavatar');

        ctrl.update(world, 0.016);

        // The constraint aims the arm's +X along (-50,100) normalized. Measured
        // on X as well as Y: the clip's own quarter turn puts +X at (0,1), which
        // passes a test that only looks up.
        const r = (world.get(2, Transform) as { rotation: { w: number; x: number; y: number; z: number } }).rotation;
        const facingX = 1 - 2 * (r.y * r.y + r.z * r.z);
        const facingY = 2 * (r.x * r.y + r.w * r.z);
        expect(facingX).toBeCloseTo(-50 / Math.hypot(50, 100), 3);
        expect(facingY).toBeCloseTo(100 / Math.hypot(50, 100), 3);
    });
});

// ---------------------------------------------------------------------------
// Rigs bound in different poses
// ---------------------------------------------------------------------------

/** A quarter turn about Z, as a quaternion. */
const quarterZ = { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 };
const identityQ = { w: 1, x: 0, y: 0, z: 0 };

describe('one clip over rigs bound differently', () => {
    /**
     * The source rig rests with its arm down (identity); the target rests with it
     * already out (a quarter turn). The clip says "arm at a quarter turn", which
     * on the source rig means "raised by a quarter turn" — and that is what the
     * target has to end up doing, from ITS rest, not the absolute value.
     */
    function rebased(withRest: boolean) {
        const world = makeWorld();
        rig(world, 1, 2, 'Arm');
        world.update(2, Transform, (t: any) => { t.rotation = { ...quarterZ }; });

        const clips = parseAvatar({ joints: {}, rest: { Arm: identityQ } });
        const target = parseAvatar({ joints: {}, rest: { Arm: quarterZ } });
        const avatars: Record<string, AnimatorAvatar> = {
            'assets/clips.esavatar': withRest ? clips : parseAvatar({ joints: {} }),
            'assets/rig.esavatar': withRest ? target : parseAvatar({ joints: {} }),
        };

        const timeline = new TimelineAPI();
        timeline.registerAsset('wave.estimeline', turn('Arm'));
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.useAssetAvatars((ref) => avatars[ref]);
        ctrl.registerController('rig', {
            version: 2, parameters: [], initialState: 'Wave',
            avatar: 'assets/clips.esavatar',
            states: [{
                name: 'Wave', transitions: [],
                motion: { kind: TIMELINE_MOTION, clip: 'wave.estimeline', loop: true },
            }],
        } as AnimatorControllerDef);
        attach(world, 1, 'assets/rig.esavatar');
        ctrl.update(world, 0.016);
        return (world.get(2, Transform) as { rotation: { z: number; w: number } }).rotation;
    }

    it('restates the clip from the target rig’s own rest pose', () => {
        // The clip's quarter turn is a quarter turn OFF the source rest, so off a
        // target resting at a quarter turn it lands at a half — z = 1.
        const r = rebased(true);
        expect(r.z).toBeCloseTo(1, 4);
        expect(r.w).toBeCloseTo(0, 4);
    });

    it('takes the clip literally when neither rig states a rest pose', () => {
        // The older behaviour, and the right one for rigs that share a bind pose:
        // no rest is not an identity rest, it is nothing to rebase against.
        const r = rebased(false);
        expect(r.z).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('leaves a joint alone when only one side states its rest', () => {
        // The source rest is deliberately NOT the identity: a missing target rest
        // defaulted to one would rebase by its inverse, and with both at identity
        // that mistake reads exactly like doing nothing.
        const world = makeWorld();
        rig(world, 1, 2, 'Arm');
        const avatars: Record<string, AnimatorAvatar> = {
            'assets/clips.esavatar': parseAvatar({ joints: {}, rest: { Arm: quarterZ } }),
            'assets/rig.esavatar': parseAvatar({ joints: {}, rest: { Leg: quarterZ } }),
        };
        const timeline = new TimelineAPI();
        timeline.registerAsset('wave.estimeline', turn('Arm'));
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.useAssetAvatars((ref) => avatars[ref]);
        ctrl.registerController('rig', {
            version: 2, parameters: [], initialState: 'Wave',
            avatar: 'assets/clips.esavatar',
            states: [{
                name: 'Wave', transitions: [],
                motion: { kind: TIMELINE_MOTION, clip: 'wave.estimeline', loop: true },
            }],
        } as AnimatorControllerDef);
        attach(world, 1, 'assets/rig.esavatar');
        ctrl.update(world, 0.016);
        expect(turnedZ(world, 2)).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('refuses a rest pose that is not a rotation', () => {
        expect(() => parseAvatar({ joints: {}, rest: { Arm: { w: 1, x: 0, y: 0 } } }))
            .toThrow(/quaternion/);
        expect(() => parseAvatar({ joints: {}, rest: [] })).toThrow(/rest/);
    });
});

// ---------------------------------------------------------------------------
// Rigs of different sizes
// ---------------------------------------------------------------------------

describe('how far a retargeted clip travels', () => {
    it('is the ratio of the two rigs, or one when either is silent', () => {
        const small = parseAvatar({ joints: {}, scale: 100 });
        const tall = parseAvatar({ joints: {}, scale: 250 });
        const unsized = parseAvatar({ joints: {} });

        expect(travelRatio(small, tall)).toBeCloseTo(2.5, 6);
        expect(travelRatio(tall, small)).toBeCloseTo(0.4, 6);
        // Not a guess: a ratio against an assumed size moves a character by an
        // amount nobody chose.
        expect(travelRatio(small, unsized)).toBe(1);
        expect(travelRatio(null, tall)).toBe(1);
    });

    it('refuses a size that is not a positive number', () => {
        expect(() => parseAvatar({ joints: {}, scale: 0 })).toThrow(/scale/);
        expect(() => parseAvatar({ joints: {}, scale: -3 })).toThrow(/scale/);
        expect(() => parseAvatar({ joints: {}, scale: 'tall' })).toThrow(/scale/);
    });

    it('walks the taller rig further, and turns it the same', () => {
        // A clip stating one unit of travel and a quarter turn, on a rig twice
        // the size of the one it was authored for: two units, same quarter turn.
        const world = makeWorld();
        rig(world, 1, 2, 'Arm');
        world.insert(1, AnimatorRootMotion, {
            enabled: true, active: false,
            deltaPosition: { x: 0, y: 0, z: 0 },
            deltaRotation: { w: 1, x: 0, y: 0, z: 0 }, deltaTime: 0,
        });
        world.insert(1, Transform, {
            position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const avatars: Record<string, AnimatorAvatar> = {
            'assets/clips.esavatar': parseAvatar({ joints: {}, scale: 100 }),
            'assets/rig.esavatar': parseAvatar({ joints: {}, scale: 200 }),
        };
        const timeline = new TimelineAPI();
        timeline.registerAsset('walk.estimeline', travels());
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
        ctrl.useAssetAvatars((ref) => avatars[ref]);
        ctrl.registerController('rig', {
            version: 2, parameters: [], initialState: 'Walk',
            avatar: 'assets/clips.esavatar',
            states: [{
                name: 'Walk', transitions: [], rootMotion: true,
                motion: { kind: TIMELINE_MOTION, clip: 'walk.estimeline', loop: true },
            }],
        } as AnimatorControllerDef);
        attach(world, 1, 'assets/rig.esavatar');

        ctrl.update(world, 0);
        ctrl.update(world, 1);
        const asked = world.get(1, AnimatorRootMotion) as {
            deltaPosition: { z: number }; deltaRotation: { z: number };
        };
        expect(asked.deltaPosition.z).toBeCloseTo(200, 2);
        expect(asked.deltaRotation.z).toBeCloseTo(Math.SQRT1_2, 3);
    });
});

/** A clip walking 100 units along +Z and turning a quarter, over one second. */
function travels(): TimelineAsset {
    const key = (time: number, value: number) => ({
        time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear,
    });
    return {
        version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'Transform', childPath: '', name: 'root',
            channels: [
                { property: 'position.z', keyframes: [key(0, 0), key(1, 100)] },
                { property: 'rotation.z', keyframes: [key(0, 0), key(1, Math.SQRT1_2)] },
                { property: 'rotation.w', keyframes: [key(0, 1), key(1, Math.SQRT1_2)] },
            ],
        }],
    } as TimelineAsset;
}
