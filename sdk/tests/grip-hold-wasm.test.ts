// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Holding an object, on the real engine, against the four things asked of it: a change of what is held does not make a hand jump; the two hands
 * cannot drive each other round a loop; a different body still puts its palm where the object says; and the same inputs give the same bones.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AnimationPlugin } from '../src/animation/AnimationPlugin';
import { GripHolder, GripPlacement, GripProfile, captureFingerPose, gripHolderStatus, registerFingerPose, slerpQuat, type GripHolderData } from '../src/animation/gripHold';
import { palmFrameOf } from '../src/animation/gripPose';
import { Name, Parent, Transform, type TransformData } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { q } from '../src/math/quat';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

interface V { x: number; y: number; z: number }
interface Q { w: number; x: number; y: number; z: number }
const I: Q = { w: 1, x: 0, y: 0, z: 0 };

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { while (apps.length) apps.pop()!.quit?.(); setEditorMode(false); setPlayMode(false); });

function scene() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    setPlayMode(true);
    app.addPlugin(new AnimationPlugin());
    const tick = async (n = 1, dt = 1 / 60): Promise<void> => { for (let i = 0; i < n; i++) { await app.tick(dt); await Promise.resolve(); } };
    return { app, world: app.world, tick };
}
type World = App['world'];

const FINGERS: Record<string, { from: V; lengths: number[] }> = {
    Thumb: { from: { x: -0.03, y: 0.02, z: -0.01 }, lengths: [0.035, 0.03, 0.025] },
    Index: { from: { x: -0.025, y: 0.09, z: 0 }, lengths: [0.04, 0.025, 0.02] },
    Middle: { from: { x: -0.005, y: 0.095, z: 0 }, lengths: [0.045, 0.03, 0.02] },
    Ring: { from: { x: 0.015, y: 0.09, z: 0 }, lengths: [0.04, 0.028, 0.02] },
    Pinky: { from: { x: 0.033, y: 0.08, z: 0 }, lengths: [0.03, 0.02, 0.018] },
};

/**
 * A body with two arms reaching forward (+Z) from shoulders 0.2 apart, each ending in a hand whose fingers point along the arm and whose palm faces
 * down. `upper` and `fore` are the arm's two lengths, to try another body with the same object.
 */
function body(world: World, options: { upper?: number; fore?: number } = {}) {
    const upperLen = options.upper ?? 0.3, foreLen = options.fore ?? 0.27;
    const spawn = (name: string, parent: Entity | null, position: V, rotation: Q = I): Entity => {
        const e = world.spawn(name);
        world.insert(e, Name, { value: name });
        world.insert(e, Transform, { position, rotation });
        if (parent !== null) world.setParent(e, parent);
        return e;
    };
    const root = spawn('Hero', null, { x: 0, y: 0, z: 0 });
    const spine = spawn('mixamorig:Spine', root, { x: 0, y: 1.4, z: 0 });
    // Bones along +Y, turned so +Y runs forward: the hand's fingers point ahead, its palm down.
    const forward = q.normalize({ w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 });
    const arms: Record<string, { upper: Entity; fore: Entity; hand: Entity }> = {};
    for (const [side, mirror] of [['Right', -1], ['Left', 1]] as const) {
        const shoulder = spawn(`mixamorig:${side}Shoulder`, spine, { x: 0.2 * mirror, y: 0, z: 0 }, forward);
        // A slight bend down at the elbow, so the arm has a side to bend to.
        const upper = spawn(`mixamorig:${side}Arm`, shoulder, { x: 0, y: 0.05, z: 0 }, q.normalize({ w: 0.999, x: 0.04, y: 0, z: 0 }));
        const fore = spawn(`mixamorig:${side}ForeArm`, upper, { x: 0, y: upperLen, z: 0 }, q.normalize({ w: 0.995, x: -0.1, y: 0, z: 0 }));
        const hand = spawn(`mixamorig:${side}Hand`, fore, { x: 0, y: foreLen, z: 0 });
        for (const [finger, f] of Object.entries(FINGERS)) {
            let parent = hand, at: V = { x: f.from.x * -mirror, y: f.from.y, z: f.from.z };
            let prev: V = { x: 0, y: 0, z: 0 };
            const dir = finger === 'Thumb' ? { x: -0.7 * -mirror, y: 0.7, z: 0 } : { x: 0, y: 1, z: 0 };
            const unit = Math.hypot(dir.x, dir.y, dir.z);
            for (let i = 0; i <= f.lengths.length; i++) {
                parent = spawn(`mixamorig:${side}Hand${finger}${i + 1}`, parent, { x: at.x - prev.x, y: at.y - prev.y, z: at.z - prev.z });
                prev = at;
                if (i < f.lengths.length) at = { x: at.x + dir.x / unit * f.lengths[i]!, y: at.y + dir.y / unit * f.lengths[i]!, z: at.z + dir.z / unit * f.lengths[i]! };
            }
        }
        arms[side] = { upper, fore, hand };
    }
    return { root, arms };
}

/** An object with a leading and a supporting anchor, the second `apart` ahead of the first. */
function gun(world: World, at: V, apart = 0.18, name = 'Gun', across = 0) {
    const e = world.spawn(name);
    world.insert(e, Name, { value: name });
    world.insert(e, Transform, { position: at });
    const anchor = (label: string, p: V, r: Q = I): Entity => {
        const a = world.spawn(label);
        world.insert(a, Name, { value: label });
        world.insert(a, Transform, { position: p, rotation: r });
        world.setParent(a, e);
        return a;
    };
    // Fingers ahead (+Z) and the palm facing down (-Y is the way +Y of the anchor must face here, so turned about Z by half a turn).
    const down = { w: 0, x: 0, y: 0, z: 1 };
    // Off the object's origin, so an anchor read as the object itself is caught.
    const main = anchor('Main', { x: 0.01, y: -0.03, z: -0.02 }, down);
    const support = anchor('Support', { x: across, y: 0.02, z: apart }, down);
    world.insert(e, GripProfile, { mainAnchor: main, supportAnchor: support, mainPose: '', supportPose: '' });
    return { e, main, support };
}

/** A bone's world pose from the locals, so a test does not lean on the engine's own composing. */
function worldPose(world: World, e: Entity): { p: V; r: Q } {
    const chain: Entity[] = [];
    for (let at: Entity | null = e; at !== null;) {
        chain.unshift(at);
        const p = world.tryGet(at, Parent) as { entity?: Entity } | null;
        at = p && typeof p.entity === 'number' ? p.entity : null;
    }
    let p: V = { x: 0, y: 0, z: 0 }, r: Q = I;
    for (const link of chain) {
        const t = world.get(link, Transform) as TransformData;
        const v = q.rotate(r, t.position);
        p = { x: p.x + v.x, y: p.y + v.y, z: p.z + v.z };
        r = q.normalize(q.mul(r, t.rotation));
    }
    return { p, r };
}

function palmOf(world: World, hand: Entity, side: 'right' | 'left') {
    const frame = palmFrameOf(world, hand, side)!;
    const h = worldPose(world, hand);
    const v = q.rotate(h.r, frame.center);
    return { p: { x: h.p.x + v.x, y: h.p.y + v.y, z: h.p.z + v.z }, r: q.normalize(q.mul(h.r, frame.turn)) };
}

const dist = (a: V, b: V): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** The angle between two turns, by the sine of the half angle: acos of a dot product near 1 turns float32 rounding into a thousandth of a radian. */
const angle = (a: Q, b: Q): number => { const d = q.mul(q.conjugate(a), b); return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w)); };
const rotationsOf = (world: World, joints: Entity[]): Q[] => joints.map((j) => ({ ...(world.get(j, Transform) as TransformData).rotation }));
const holder = (world: World, root: Entity, data: Partial<GripHolderData>): void => { world.insert(root, GripHolder, { blendSeconds: 0, ...data }); };

/** Puts the supporting anchor where the left arm can reach, read off the object as it now stands: in front of the chest, the palm down. */
function reachable(world: World, g: { e: Entity; support: Entity }, at: V = { x: 0.02, y: 1.38, z: 0.5 }): void {
    const o = worldPose(world, g.e);
    const back = q.conjugate(o.r);
    const local = q.rotate(back, { x: at.x - o.p.x, y: at.y - o.p.y, z: at.z - o.p.z });
    const down = { w: 0, x: 0, y: 0, z: 1 };
    world.update(g.support, Transform, (t: TransformData) => { t.position = local; t.rotation = q.normalize(q.mul(back, q.mul(o.r, q.mul(q.conjugate(o.r), down)))); });
}
const armJoints = (b: ReturnType<typeof body>): Entity[] => Object.values(b.arms).flatMap((a) => [a.upper, a.fore, a.hand]);

describe.skipIf(!HAS_WASM)('holding an object', () => {
    beforeAll(async () => { if (HAS_WASM) core = await loadWasmModule(); });

    it('puts the leading palm on the object\'s anchor when the game places the object', async () => {
        const s = scene();
        const b = body(s.world);
        const g = gun(s.world, { x: -0.15, y: 1.25, z: 0.45 });
        holder(s.world, b.root, { held: g.e, placement: GripPlacement.Object, supportWeight: 0 });
        await s.tick(2);
        const palm = palmOf(s.world, b.arms.Right!.hand, 'right');
        const anchor = worldPose(s.world, g.main);
        expect(dist(palm.p, anchor.p)).toBeLessThan(1e-3);
        expect(angle(palm.r, anchor.r)).toBeLessThan(0.01);
    });

    it('carries the object on the leading hand where the clip has put it, and leaves that hand alone', async () => {
        const s = scene();
        const b = body(s.world);
        const g = gun(s.world, { x: 3, y: 0, z: 0 });
        const before = rotationsOf(s.world, [b.arms.Right!.upper, b.arms.Right!.fore, b.arms.Right!.hand]);
        holder(s.world, b.root, { held: g.e, placement: GripPlacement.Hand, supportWeight: 0 });
        await s.tick(2);
        const palm = palmOf(s.world, b.arms.Right!.hand, 'right');
        const anchor = worldPose(s.world, g.main);
        expect(dist(palm.p, anchor.p)).toBeLessThan(1e-3);
        expect(angle(palm.r, anchor.r)).toBeLessThan(0.01);
        const after = rotationsOf(s.world, [b.arms.Right!.upper, b.arms.Right!.fore, b.arms.Right!.hand]);
        after.forEach((r, i) => expect(angle(r, before[i]!)).toBeLessThan(1e-6));
    });

    it('brings the supporting palm to its anchor on the object as it now stands', async () => {
        const s = scene();
        const b = body(s.world);
        const g = gun(s.world, { x: 3, y: 0, z: 0 });
        holder(s.world, b.root, { held: g.e, placement: GripPlacement.Hand });
        await s.tick(1);
        reachable(s.world, g);
        await s.tick(2);
        const palm = palmOf(s.world, b.arms.Left!.hand, 'left');
        const anchor = worldPose(s.world, g.support);
        expect(dist(palm.p, anchor.p)).toBeLessThan(1e-3);
    });

    describe('does not make a hand jump when what is held changes', () => {
        it('eases every joint over, each frame a small part of the way', async () => {
            const run = async (blend: number) => {
                const s = scene();
                const b = body(s.world);
                const a = gun(s.world, { x: -0.15, y: 1.25, z: 0.45 }, 0.18, 'A');
                const c = gun(s.world, { x: -0.05, y: 1.1, z: 0.35 }, 0.1, 'B');
                holder(s.world, b.root, { held: a.e, placement: GripPlacement.Object, blendSeconds: blend });
                await s.tick(60);
                const joints = armJoints(b);
                let last = rotationsOf(s.world, joints), biggest = 0, total = 0;
                const start = last;
                s.world.update(b.root, GripHolder, (d: GripHolderData) => { d.held = c.e; });
                for (let i = 0; i < 60; i++) {
                    await s.tick(1);
                    const now = rotationsOf(s.world, joints);
                    biggest = Math.max(biggest, ...now.map((r, k) => angle(r, last[k]!)));
                    last = now;
                }
                total = Math.max(...last.map((r, k) => angle(r, start[k]!)));
                return { biggest, total };
            };
            const eased = await run(0.25), cut = await run(0);
            expect(cut.biggest).toBeCloseTo(cut.total, 3);
            expect(eased.total).toBeCloseTo(cut.total, 3);
            expect(eased.biggest).toBeLessThan(eased.total * 0.15);
        });

        it('takes hold and lets go the same way, back to the clip\'s pose', async () => {
            const s = scene();
            const b = body(s.world);
            const g = gun(s.world, { x: -0.15, y: 1.25, z: 0.45 });
            const joints = armJoints(b);
            const rest = rotationsOf(s.world, joints);
            holder(s.world, b.root, { held: g.e, placement: GripPlacement.Object, blendSeconds: 0.25 });
            let last = rest, biggest = 0;
            for (let i = 0; i < 60; i++) { await s.tick(1); const now = rotationsOf(s.world, joints); biggest = Math.max(biggest, ...now.map((r, k) => angle(r, last[k]!))); last = now; }
            const held = Math.max(...last.map((r, k) => angle(r, rest[k]!)));
            expect(held).toBeGreaterThan(0.2);
            expect(biggest).toBeLessThan(held * 0.15);
            s.world.update(b.root, GripHolder, (d: GripHolderData) => { d.held = 0 as Entity; });
            await s.tick(60);
            rotationsOf(s.world, joints).forEach((r, k) => expect(angle(r, rest[k]!)).toBeLessThan(1e-3));
        });
    });

    describe('cannot drive itself round a loop', () => {
        it('moves neither the object nor the leading arm when the supporting anchor moves', async () => {
            const s = scene();
            const b = body(s.world);
            const g = gun(s.world, { x: 3, y: 0, z: 0 });
            holder(s.world, b.root, { held: g.e, placement: GripPlacement.Hand });
            await s.tick(1);
            reachable(s.world, g);
            await s.tick(3);
            const object = worldPose(s.world, g.e), main = rotationsOf(s.world, [b.arms.Right!.upper, b.arms.Right!.fore, b.arms.Right!.hand]);
            reachable(s.world, g, { x: 0.08, y: 1.33, z: 0.45 });
            await s.tick(3);
            const after = worldPose(s.world, g.e);
            expect(dist(after.p, object.p)).toBe(0);
            rotationsOf(s.world, [b.arms.Right!.upper, b.arms.Right!.fore, b.arms.Right!.hand]).forEach((r, k) => expect(r).toEqual(main[k]));
            expect(dist(palmOf(s.world, b.arms.Left!.hand, 'left').p, worldPose(s.world, g.support).p)).toBeLessThan(1e-3);
        });

        it('stays exactly where it settled, frame after frame, with nothing changing', async () => {
            for (const placement of [GripPlacement.Hand, GripPlacement.Object]) {
                const s = scene();
                const b = body(s.world);
                const g = gun(s.world, placement === GripPlacement.Hand ? { x: 3, y: 0, z: 0 } : { x: -0.15, y: 1.25, z: 0.45 });
                holder(s.world, b.root, { held: g.e, placement, blendSeconds: 0.2 });
                await s.tick(90);
                const joints = armJoints(b);
                const settled = rotationsOf(s.world, joints), object = worldPose(s.world, g.e);
                await s.tick(300);
                expect(rotationsOf(s.world, joints)).toEqual(settled);
                expect(worldPose(s.world, g.e)).toEqual(object);
            }
        });
    });

    describe('puts the palm where the object says on another body', () => {
        it('for arms shorter and longer than the one it was made with', async () => {
            for (const [upper, fore] of [[0.24, 0.22], [0.3, 0.27], [0.36, 0.32]]) {
                const s = scene();
                const b = body(s.world, { upper, fore });
                const g = gun(s.world, { x: -0.12, y: 1.32, z: 0.3 }, 0.12, 'Gun', 0.22);
                holder(s.world, b.root, { held: g.e, placement: GripPlacement.Object });
                await s.tick(2);
                for (const [side, hand, anchor] of [['right', b.arms.Right!.hand, g.main], ['left', b.arms.Left!.hand, g.support]] as const) {
                    const palm = palmOf(s.world, hand, side);
                    const at = worldPose(s.world, anchor);
                    expect(dist(palm.p, at.p), `${side} at ${upper}+${fore}`).toBeLessThan(1e-3);
                    expect(angle(palm.r, at.r), `${side} at ${upper}+${fore}`).toBeLessThan(0.01);
                }
            }
        });

        it('out of reach, points the arm straight at the anchor and turns the palm to it, every time the same', async () => {
            const s = scene();
            const b = body(s.world, { upper: 0.2, fore: 0.18 });
            const g = gun(s.world, { x: -0.15, y: 1.25, z: 0.9 });
            holder(s.world, b.root, { held: g.e, placement: GripPlacement.Object, supportWeight: 0 });
            await s.tick(2);
            const shoulder = worldPose(s.world, b.arms.Right!.upper).p, elbow = worldPose(s.world, b.arms.Right!.fore).p, hand = worldPose(s.world, b.arms.Right!.hand).p;
            const anchor = worldPose(s.world, g.main);
            const toward = (from: V, to: V): V => { const d = dist(from, to); return { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d }; };
            const a = toward(shoulder, elbow), c = toward(elbow, hand), goal = toward(shoulder, anchor.p);
            expect(a.x * c.x + a.y * c.y + a.z * c.z).toBeGreaterThan(0.999);
            expect(a.x * goal.x + a.y * goal.y + a.z * goal.z).toBeGreaterThan(0.99);
            expect(angle(palmOf(s.world, b.arms.Right!.hand, 'right').r, anchor.r)).toBeLessThan(0.01);
        });
    });

    it('gives the same bones for the same inputs, to the last bit', async () => {
        const steps = [1 / 60, 1 / 30, 1 / 144, 1 / 60, 1 / 45, 1 / 60, 1 / 90];
        const run = async () => {
            const s = scene();
            const b = body(s.world);
            const a = gun(s.world, { x: -0.15, y: 1.25, z: 0.45 }, 0.18, 'A');
            const c = gun(s.world, { x: -0.05, y: 1.1, z: 0.35 }, 0.1, 'B');
            holder(s.world, b.root, { held: a.e, placement: GripPlacement.Object, blendSeconds: 0.2 });
            for (let i = 0; i < 40; i++) await s.tick(1, steps[i % steps.length]);
            s.world.update(b.root, GripHolder, (d: GripHolderData) => { d.held = c.e; });
            for (let i = 0; i < 20; i++) await s.tick(1, steps[i % steps.length]);
            return [...rotationsOf(s.world, armJoints(b)), ...Object.values(b.arms).flatMap((arm) => rotationsOf(s.world, [arm.hand]))];
        };
        expect(await run()).toEqual(await run());
    });

    it('blends a captured finger pose over the clip by the weight, as slerp(clip, grip, w)', async () => {
        const s = scene();
        const b = body(s.world);
        const finger = s.world.getEntitiesWithComponents([Name]).find((e) => (s.world.get(e, Name) as { value: string }).value === 'mixamorig:RightHandIndex1')!;
        const grip = q.normalize({ w: 0.8, x: 0.5, y: 0.2, z: 0.1 });
        const clip = (s.world.get(finger, Transform) as TransformData).rotation;
        registerFingerPose('test-curl', { joints: { 'mixamorig:RightHandIndex1': grip } });
        const g = gun(s.world, { x: 3, y: 0, z: 0 });
        s.world.update(g.e, GripProfile, (p: { mainPose: string }) => { p.mainPose = 'test-curl'; });
        holder(s.world, b.root, { held: g.e, placement: GripPlacement.Hand, weight: 0.5, supportWeight: 0 });
        await s.tick(2);
        const want = slerpQuat(clip, grip, 0.5);
        const got = (s.world.get(finger, Transform) as TransformData).rotation;
        expect(angle(got, want)).toBeLessThan(1e-5);
        expect(gripHolderStatus(s.app, b.root)!.amount).toBe(0.5);
    });

    it('captures a hand\'s fingers as plain JSON that puts them back', async () => {
        const s = scene();
        const b = body(s.world);
        const hand = b.arms.Right!.hand;
        const named = (n: string) => s.world.getEntitiesWithComponents([Name]).find((e) => (s.world.get(e, Name) as { value: string }).value === n)!;
        s.world.update(named('mixamorig:RightHandMiddle2'), Transform, (t: TransformData) => { t.rotation = q.normalize({ w: 0.7, x: 0.7, y: 0, z: 0 }); });
        const pose = JSON.parse(JSON.stringify(captureFingerPose(s.world, hand)));
        expect(Object.keys(pose.joints)).toContain('mixamorig:RightHandMiddle2');
        expect(Object.keys(pose.joints).length).toBe(20);
        registerFingerPose('kept', pose);
        s.world.update(named('mixamorig:RightHandMiddle2'), Transform, (t: TransformData) => { t.rotation = I; });
        const g = gun(s.world, { x: 3, y: 0, z: 0 });
        s.world.update(g.e, GripProfile, (p: { mainPose: string }) => { p.mainPose = 'kept'; });
        holder(s.world, b.root, { held: g.e, placement: GripPlacement.Hand, supportWeight: 0 });
        await s.tick(2);
        expect(angle((s.world.get(named('mixamorig:RightHandMiddle2'), Transform) as TransformData).rotation, q.normalize({ w: 0.7, x: 0.7, y: 0, z: 0 }))).toBeLessThan(1e-5);
    });

    it('hands a grip pose by name to the hand\'s GripPose, by the hold\'s weight', async () => {
        const s = scene();
        const b = body(s.world);
        const g = gun(s.world, { x: 3, y: 0, z: 0 });
        s.world.update(g.e, GripProfile, (p: { mainPose: string; supportPose: string }) => { p.mainPose = 'pistol'; p.supportPose = 'support'; });
        holder(s.world, b.root, { held: g.e, placement: GripPlacement.Hand });
        await s.tick(3);
        const grip = s.world.get(b.root, (await import('../src/animation/gripPose')).GripPose) as { rightPose: string; leftPose: string; rightWeight: number };
        expect(grip.rightPose).toBe('pistol');
        expect(grip.leftPose).toBe('support');
        expect(grip.rightWeight).toBe(1);
    });
});
