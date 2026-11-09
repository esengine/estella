// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Parent, Transform, ensureBuiltinComponentsRegistered, getComponent } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Bone2D, BoneConstraint2D, BoneConstraintKind, IK2D, Rig2DPlugin, createRig, spawnRig } from '../src/rig2d/index';
import { Rig2DSolver } from '../src/rig2d/rig2dPlugin';
import { Animator, AnimatorControllerAPI, type AnimatorData } from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { InterpType, TrackType, WrapMode, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

function scene() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    setPlayMode(true);
    app.addPlugin(new Rig2DPlugin());
    const world = app.world;
    const spawn = (x: number, y: number, parent?: Entity, length?: number): Entity => {
        const e = world.spawn(); world.insert(e, Transform, { position: { x, y, z: 0 } });
        if (parent !== undefined) world.setParent(e, parent);
        if (length !== undefined) world.insert(e, Bone2D, { length });
        return e;
    };
    const angleOf = (e: Entity) => { const q = world.get(e, Transform).rotation; return 2 * Math.atan2(q.z, q.w); };
    /** Where the end of `tip` is, by what the engine itself composes. */
    const worldOf = (e: Entity) => { world.ensureTransformsComposed(); return world.get(e, Transform).worldPosition; };
    const tipOf = (tip: Entity, length: number) => {
        world.ensureTransformsComposed();
        const held = world.get(tip, Transform), a = 2 * Math.atan2(held.worldRotation.z, held.worldRotation.w);
        return { x: held.worldPosition.x + Math.cos(a) * length * held.worldScale.x, y: held.worldPosition.y + Math.sin(a) * length * held.worldScale.x };
    };
    const step = (n = 1) => app.stepFrames(n, 1 / 60);
    return { app, world, spawn, angleOf, worldOf, tipOf, step };
}

describe.skipIf(!HAS_WASM)('2D rig on a running world', () => {
    beforeAll(async () => { ensureBuiltinComponentsRegistered(); core = await loadWasmModule(); });

    it.each([
        ['at the origin', { x: 0, y: 0 }, { x: 1, y: 1 }, 0],
        ['carried somewhere', { x: 300, y: -40 }, { x: 1, y: 1 }, 0],
        ['under a turned parent', { x: 30, y: 10 }, { x: 1, y: 1 }, 0.8],
        ['under a scaled parent', { x: 0, y: 0 }, { x: 2, y: 2 }, 0],
        ['mirrored by a parent', { x: 50, y: 0 }, { x: -1, y: 1 }, 0],
    ])('puts the end of the chain on the target, by the engine\'s own transforms, %s', async (_name, at, scale, turn) => {
        const { world, spawn, tipOf, worldOf, step } = scene();
        const root = spawn(at.x, at.y);
        world.update(root, Transform, (t) => { t.scale = { x: scale.x, y: scale.y, z: 1 }; t.rotation = { w: Math.cos(turn / 2), x: 0, y: 0, z: Math.sin(turn / 2) }; });
        const upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 40);
        const target = spawn(at.x + 30 * scale.x, at.y + 50 * scale.y);
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        const tip = tipOf(lower, 40), want = worldOf(target);
        expect(tip.x).toBeCloseTo(want.x, 1); expect(tip.y).toBeCloseTo(want.y, 1);
    });

    it('reaches under a body that is turned inside a mirrored parent', async () => {
        const { world, spawn, worldOf, step } = scene();
        const root = spawn(50, 0);
        world.update(root, Transform, (t) => { t.scale = { x: -1, y: 1, z: 1 }; });
        const torso = spawn(0, 20, root);
        world.update(torso, Transform, (t) => { t.rotation = { w: Math.cos(0.3), x: 0, y: 0, z: Math.sin(0.3) }; });
        const upper = spawn(10, 0, torso, 50), lower = spawn(50, 0, upper, 40), target = spawn(-10, 70);
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        const want = worldOf(target);
        world.ensureTransformsComposed();
        const held = world.get(lower, Transform), a = 2 * Math.atan2(held.worldRotation.z, held.worldRotation.w);
        const tip = { x: held.worldPosition.x + Math.cos(a) * 40 * held.worldScale.x, y: held.worldPosition.y + Math.sin(a) * 40 * held.worldScale.x };
        expect(tip.x).toBeCloseTo(want.x, 1); expect(tip.y).toBeCloseTo(want.y, 1);
    });

    it('sees what a chain just moved, even where it looked before the chain moved it', async () => {
        const { world, spawn, worldOf, step } = scene();
        const root = spawn(0, 0);
        // The first chain reads `carried`, on a bone the second chain then turns; the constraint reads it after.
        const arm = spawn(0, 0, root, 30);
        const other = spawn(100, 0), wrist = spawn(0, 0, other, 40), hand = spawn(40, 0, wrist, 40), carried = spawn(30, 0, hand);
        const follower = spawn(-200, -200);
        world.insert(arm, IK2D, { target: carried, chainLength: 1, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        const handTarget = spawn(100, 80);
        world.insert(hand, IK2D, { target: handTarget, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        world.insert(follower, BoneConstraint2D, { kind: BoneConstraintKind.CopyPosition, source: carried, min: 0, max: 0, offset: 0, weight: 1, enabled: true });
        await step();
        const want = worldOf(carried), got = worldOf(follower);
        expect(got.x).toBeCloseTo(want.x, 1); expect(got.y).toBeCloseTo(want.y, 1);
    });

    it('keeps a chain of three within a limit, and still reaches', async () => {
        const { world, spawn, angleOf, tipOf, step } = scene();
        const root = spawn(0, 0), a = spawn(0, 0, root, 30), b = spawn(30, 0, a, 30), c = spawn(30, 0, b, 30), target = spawn(40, 50);
        world.insert(a, BoneConstraint2D, { kind: BoneConstraintKind.LimitRotation, source: 0 as Entity, min: -10, max: 10, offset: 0, weight: 1, enabled: true });
        world.insert(c, IK2D, { target, chainLength: 3, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        expect(Math.abs(angleOf(a))).toBeLessThanOrEqual(10 * Math.PI / 180 + 1e-5);
        const tip = tipOf(c, 30);
        expect(Math.hypot(tip.x - 40, tip.y - 50)).toBeLessThan(0.5);
    });

    it('follows a target that moves', async () => {
        const { world, spawn, tipOf, step } = scene();
        const root = spawn(0, 0), upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 50), target = spawn(60, 20);
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        world.update(target, Transform, (t) => { t.position.x = -30; t.position.y = 70; });
        await step();
        const tip = tipOf(lower, 50);
        expect(tip.x).toBeCloseTo(-30, 1); expect(tip.y).toBeCloseTo(70, 1);
    });

    it('blends with what the animation said, and does not creep on a bone no clip moves', async () => {
        const { world, spawn, angleOf, step } = scene();
        const root = spawn(0, 0), upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 50), target = spawn(0, 80);
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 0.5, matchTargetRotation: false, enabled: true });
        await step();
        const once = angleOf(upper);
        expect(Math.abs(once)).toBeGreaterThan(0.1);
        await step(30);
        expect(angleOf(upper)).toBeCloseTo(once, 4);
    });

    it('takes a new animated pose as its base', async () => {
        const { world, spawn, angleOf, step } = scene();
        const root = spawn(0, 0), upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 50), target = spawn(0, 80);
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 0, matchTargetRotation: false, enabled: true });
        await step();
        world.update(upper, Transform, (t) => { t.rotation = { w: Math.cos(0.25), x: 0, y: 0, z: Math.sin(0.25) }; });
        await step();
        expect(angleOf(upper)).toBeCloseTo(0.5, 4);
        world.update(lower, IK2D, (ik) => { ik.weight = 1e-6; });
        await step();
        expect(angleOf(upper)).toBeCloseTo(0.5, 3);
    });

    it('does nothing without a target, disabled, or stopped', async () => {
        const { world, spawn, angleOf, step } = scene();
        const root = spawn(0, 0), upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 50);
        world.insert(lower, IK2D, { target: 0 as Entity, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        expect(angleOf(upper)).toBe(0);
        const target = spawn(0, 80);
        world.update(lower, IK2D, (ik) => { ik.target = target; ik.enabled = false; });
        await step();
        expect(angleOf(upper)).toBe(0);
        setEditorMode(true); setPlayMode(false);
        world.update(lower, IK2D, (ik) => { ik.enabled = true; });
        await step();
        expect(angleOf(upper)).toBe(0);
        setEditorMode(false); setPlayMode(true);
    });

    it('matches the target\'s rotation when asked', async () => {
        const { world, spawn, step } = scene();
        const root = spawn(0, 0), upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 50), target = spawn(60, 20);
        world.update(target, Transform, (t) => { t.rotation = { w: Math.cos(0.4), x: 0, y: 0, z: Math.sin(0.4) }; });
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: true, enabled: true });
        await step();
        world.ensureTransformsComposed();
        const q = world.get(lower, Transform).worldRotation;
        expect(2 * Math.atan2(q.z, q.w)).toBeCloseTo(0.8, 3);
    });

    it('limits a joint, by itself and inside a chain', async () => {
        const { world, spawn, angleOf, step } = scene();
        const root = spawn(0, 0), upper = spawn(0, 0, root, 50), lower = spawn(50, 0, upper, 50), target = spawn(-30, 60);
        world.insert(upper, BoneConstraint2D, { kind: BoneConstraintKind.LimitRotation, source: 0 as Entity, min: -10, max: 10, offset: 0, weight: 1, enabled: true });
        world.insert(lower, IK2D, { target, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        expect(Math.abs(angleOf(upper))).toBeLessThanOrEqual(10 * Math.PI / 180 + 1e-5);
        const alone = spawn(0, 0, root, 10);
        world.update(alone, Transform, (t) => { t.rotation = { w: Math.cos(1), x: 0, y: 0, z: Math.sin(1) }; });
        world.insert(alone, BoneConstraint2D, { kind: BoneConstraintKind.LimitRotation, source: 0 as Entity, min: -30, max: 30, offset: 0, weight: 1, enabled: true });
        await step();
        expect(angleOf(alone)).toBeCloseTo(30 * Math.PI / 180, 4);
    });

    it('copies rotation and position, and looks at, whatever turns the parent', async () => {
        const { world, spawn, worldOf, step } = scene();
        const parent = spawn(10, 0);
        world.update(parent, Transform, (t) => { t.rotation = { w: Math.cos(0.3), x: 0, y: 0, z: Math.sin(0.3) }; });
        const source = spawn(100, 50);
        world.update(source, Transform, (t) => { t.rotation = { w: Math.cos(0.5), x: 0, y: 0, z: Math.sin(0.5) }; });
        const copier = spawn(5, 0, parent), mover = spawn(5, 0, parent), looker = spawn(0, 0, parent);
        const row = { min: 0, max: 0, weight: 1, enabled: true };
        world.insert(copier, BoneConstraint2D, { ...row, kind: BoneConstraintKind.CopyRotation, source, offset: 90 });
        world.insert(mover, BoneConstraint2D, { ...row, kind: BoneConstraintKind.CopyPosition, source, offset: 0 });
        world.insert(looker, BoneConstraint2D, { ...row, kind: BoneConstraintKind.LookAt, source, offset: 0 });
        await step();
        world.ensureTransformsComposed();
        const worldAngle = (e: Entity) => { const q = world.get(e, Transform).worldRotation; return 2 * Math.atan2(q.z, q.w); };
        expect(worldAngle(copier)).toBeCloseTo(1 + Math.PI / 2, 3);
        expect(worldOf(mover).x).toBeCloseTo(100, 2); expect(worldOf(mover).y).toBeCloseTo(50, 2);
        expect(worldAngle(looker)).toBeCloseTo(Math.atan2(50, 90), 3);
    });

    it('bends a limb from where its body was just put by another chain', async () => {
        const { world, spawn, tipOf, step } = scene();
        const root = spawn(0, 0), spine = spawn(0, 0, root, 100), arm = spawn(100, 0, spine, 30), hand = spawn(30, 0, arm, 30);
        const bodyTarget = spawn(0, 100), handTarget = spawn(30, 110);
        world.insert(spine, IK2D, { target: bodyTarget, chainLength: 1, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        world.insert(hand, IK2D, { target: handTarget, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
        await step();
        const tip = tipOf(hand, 30);
        expect(tip.x).toBeCloseTo(30, 1); expect(tip.y).toBeCloseTo(110, 1);
    });

    describe('under the animator', () => {
        const turn = (bone: string, angle: number): TimelineAsset => {
            const key = (value: number) => [{ time: 0, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear }];
            return {
                version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop,
                tracks: [{
                    type: TrackType.Property, component: 'Transform', childPath: bone, name: bone,
                    channels: [
                        { property: 'rotation.w', keyframes: key(Math.cos(angle / 2)) }, { property: 'rotation.x', keyframes: key(0) },
                        { property: 'rotation.y', keyframes: key(0) }, { property: 'rotation.z', keyframes: key(Math.sin(angle / 2)) },
                    ],
                }],
            } as TimelineAsset;
        };
        function character() {
            const { world, angleOf, tipOf, spawn } = scene();
            const rig = createRig('x.png', 10, 10);
            rig.bones.push(
                { name: 'upper', parent: -1, x: 0, y: 0, rotation: 0, length: 50 },
                { name: 'lower', parent: 0, x: 50, y: 0, rotation: 0, length: 50 },
                { name: 'tail', parent: -1, x: 0, y: 0, rotation: 0, length: 10 },
            );
            const made = spawnRig(world, rig, { mesh: 0, texture: 0 });
            const timeline = new TimelineAPI();
            timeline.registerAsset('still', turn('upper/lower', 0));
            timeline.registerAsset('bent', turn('upper/lower', 1));
            timeline.registerAsset('wag', turn('tail', 0.6));
            const animator = new AnimatorControllerAPI();
            animator.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
            animator.registerController('hero', {
                parameters: [{ name: 'speed', type: 'float', default: 0 }], initialState: 'Move',
                states: [{ name: 'Move', transitions: [], motion: {
                    kind: 'blend1d', parameter: 'speed',
                    thresholds: [{ value: 0, motion: { kind: TIMELINE_MOTION, clip: 'still' } }, { value: 1, motion: { kind: TIMELINE_MOTION, clip: 'bent' } }],
                } }],
            });
            world.insert(made.root, Animator, { controller: 'hero', currentState: '', enabled: true } as AnimatorData);
            return { world, made, animator, angleOf, tipOf, spawn };
        }

        it('blends two clips on a bone, by a parameter', () => {
            const { world, made, animator, angleOf } = character();
            for (const [speed, want] of [[0, 0], [0.5, 0.5], [1, 1]] as const) {
                animator.setFloat(made.root, 'speed', speed);
                animator.update(world, 0.016);
                expect(angleOf(made.bones[1]!)).toBeCloseTo(want, 2);
            }
        });

        it('lets a chain reach from the blended pose, and a bone no chain holds keep playing', () => {
            const { world, made, animator, angleOf, tipOf, spawn } = character();
            const solver = new Rig2DSolver(world), target = spawn(40, 40);
            world.insert(made.bones[1]!, IK2D, { target, chainLength: 2, bend: 1, weight: 1, matchTargetRotation: false, enabled: true });
            for (let frame = 0; frame < 3; frame++) {
                animator.setFloat(made.root, 'speed', 0.5);
                animator.update(world, 0.016);
                solver.step();
                const tip = tipOf(made.bones[1]!, 50);
                expect(tip.x).toBeCloseTo(40, 1); expect(tip.y).toBeCloseTo(40, 1);
            }
            expect(angleOf(made.bones[2]!)).toBe(0);
            // With the chain let go, the bone is back on what the clip said.
            world.update(made.bones[1]!, IK2D, (ik) => { ik.weight = 0; });
            animator.update(world, 0.016);
            solver.step();
            expect(angleOf(made.bones[1]!)).toBeCloseTo(0.5, 2);
        });
    });

    it('spawns a rig the way a clip finds it', () => {
        const { world } = scene();
        const rig = createRig('x.png', 10, 10);
        rig.bones.push({ name: 'a', parent: -1, x: 1, y: 2, rotation: 0.5, length: 3 }, { name: 'b', parent: 0, x: 3, y: 0, rotation: 0, length: 3 });
        rig.deforms.push({ name: 'd', offsets: {} });
        const made = spawnRig(world, rig, { mesh: 0, texture: 0 });
        expect(made.bones).toHaveLength(2);
        expect(world.get(made.bones[1]!, Parent).entity).toBe(made.bones[0]);
        expect(world.get(made.bones[0]!, Bone2D).length).toBe(3);
        expect(world.get(made.root, getComponent('MeshSkin')!).joints).toEqual(made.bones);
        expect(world.get(made.root, getComponent('MeshMorph')!).weights).toEqual([0]);
    });
});
