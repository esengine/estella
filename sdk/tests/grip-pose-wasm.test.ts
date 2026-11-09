// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A hand held in a named pose, on the real engine. What makes a pose worth having is that it fits any rig, so the claims are about where the
 * fingertips end up in the world: the same for two rigs whose bones face different ways, and mirrored for the other hand.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Animator } from '../src/animation';
import { AnimationPlugin } from '../src/animation/AnimationPlugin';
import { GripPose, gripPoseNames, gripPoseStatus, registerGripPose, type GripPoseData } from '../src/animation/gripPose';
import { Name, Transform, type TransformData } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { q } from '../src/math/quat';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

interface V { x: number; y: number; z: number }
interface Q { w: number; x: number; y: number; z: number }
const IDENTITY: Q = { w: 1, x: 0, y: 0, z: 0 };

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { while (apps.length) apps.pop()!.quit?.(); setEditorMode(false); setPlayMode(false); vi.restoreAllMocks(); });

function scene() {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    setPlayMode(true);
    app.addPlugin(new AnimationPlugin());
    const tick = async (n = 1): Promise<void> => { for (let i = 0; i < n; i++) { await app.tick(1 / 60); await Promise.resolve(); } };
    return { app, world: app.world, tick };
}
type World = App['world'];

/** Where a finger's joints stand, seen from the hand with the fingers ahead along +Y, the palm toward -Z and, on a right hand, the thumb toward -X. */
const LAYOUT: Record<string, { from: V; along: V; lengths: number[] }> = {
    thumb: { from: { x: -0.03, y: 0.02, z: -0.01 }, along: { x: -0.7, y: 0.7, z: 0 }, lengths: [0.035, 0.03, 0.025] },
    index: { from: { x: -0.025, y: 0.09, z: 0 }, along: { x: 0, y: 1, z: 0 }, lengths: [0.04, 0.025, 0.02] },
    middle: { from: { x: -0.005, y: 0.095, z: 0 }, along: { x: 0, y: 1, z: 0 }, lengths: [0.045, 0.03, 0.02] },
    ring: { from: { x: 0.015, y: 0.09, z: 0 }, along: { x: 0, y: 1, z: 0 }, lengths: [0.04, 0.028, 0.02] },
    pinky: { from: { x: 0.033, y: 0.08, z: 0 }, along: { x: 0, y: 1, z: 0 }, lengths: [0.03, 0.02, 0.018] },
};

interface RigOptions {
    side?: 'right' | 'left';
    /** The turn each bone is given from its parent. The picture of the hand stays the same, since the positions are written to match. */
    frame?: (depth: number) => Q;
    names?: (finger: string, i: number) => string;
    handName?: string;
    without?: string[];
    /** Bones in the palm between the hand and each finger. */
    metacarpal?: boolean;
    /** A turn over the whole rig. */
    root?: Q;
}

/** A hand built so its world shape does not depend on how its bones face. Answers the bones by finger, tips included. */
function buildRig(world: World, options: RigOptions = {}) {
    const mirror = options.side === 'left' ? -1 : 1;
    const frame = options.frame ?? (() => IDENTITY);
    const names = options.names ?? ((finger, i) => `mixamorig:${options.side === 'left' ? 'Left' : 'Right'}Hand${finger[0]!.toUpperCase()}${finger.slice(1)}${i + 1}`);
    const spawn = (name: string, parent: Entity | null, position: V, rotation: Q): Entity => {
        const e = world.spawn(name);
        world.insert(e, Name, { value: name });
        world.insert(e, Transform, { position, rotation });
        if (parent !== null) world.setParent(e, parent);
        return e;
    };
    const root = spawn('Rig', null, { x: 0, y: 0, z: 0 }, options.root ?? IDENTITY);
    const armature = spawn('Armature', root, { x: 0, y: 0, z: 0 }, IDENTITY);
    const handTurn = frame(0);
    const hand = spawn(options.handName ?? `mixamorig:${options.side === 'left' ? 'Left' : 'Right'}Hand`, armature, { x: 0, y: 0, z: 0 }, handTurn);
    const bones: Record<string, Entity[]> = {};
    for (const [finger, layout] of Object.entries(LAYOUT)) {
        if (options.without?.includes(finger)) continue;
        let parent = hand, parentTurn = handTurn, at: V = { x: 0, y: 0, z: 0 };
        const chain: Entity[] = [];
        const placeChild = (name: string, worldAt: V, depth: number): Entity => {
            const turn = frame(depth);
            const local = q.rotate(q.conjugate(parentTurn), { x: worldAt.x - at.x, y: worldAt.y - at.y, z: worldAt.z - at.z });
            const e = spawn(name, parent, local, q.normalize(q.mul(q.conjugate(parentTurn), turn)));
            parent = e; parentTurn = turn; at = worldAt;
            return e;
        };
        const start: V = { x: layout.from.x * mirror, y: layout.from.y, z: layout.from.z };
        if (options.metacarpal && finger !== 'thumb') placeChild(`${finger}_metacarpal`, { x: start.x * 0.5, y: start.y * 0.4, z: start.z }, 1);
        let p = start;
        chain.push(placeChild(names(finger, 0), p, 2));
        const along = { x: layout.along.x * mirror, y: layout.along.y, z: layout.along.z };
        const unit = Math.hypot(along.x, along.y, along.z);
        layout.lengths.forEach((l, i) => {
            p = { x: p.x + along.x / unit * l, y: p.y + along.y / unit * l, z: p.z + along.z / unit * l };
            chain.push(placeChild(names(finger, i + 1), p, 3 + i));
        });
        bones[finger] = chain;
    }
    return { root, hand, bones };
}

/** A bone's place in the world, from the locals: the world's own record is last frame's. */
function placeOf(world: World, e: Entity, stop: Entity): V {
    const links: Entity[] = [];
    for (let at = e; ; at = (world.get(at, getParent(world)) as { entity: Entity }).entity) { links.unshift(at); if (at === stop) break; }
    let p: V = { x: 0, y: 0, z: 0 }, r: Q = IDENTITY;
    for (const link of links) {
        const t = world.get(link, Transform) as TransformData;
        p = (() => { const v = q.rotate(r, t.position); return { x: p.x + v.x, y: p.y + v.y, z: p.z + v.z }; })();
        r = q.normalize(q.mul(r, t.rotation));
    }
    return p;
}
import { Parent } from '../src/ecs/component';
const getParent = (_world: World) => Parent;

const tips = (world: World, rig: ReturnType<typeof buildRig>): Record<string, V> => Object.fromEntries(Object.entries(rig.bones).map(([finger, chain]) => [finger, placeOf(world, chain[chain.length - 1]!, rig.hand)]));
const hold = (world: World, rig: { root: Entity }, data: Partial<GripPoseData>): void => { world.insert(rig.root, GripPose, { blendSeconds: 0, ...data }); };
const close = (a: V, b: V, digits = 3): void => { expect(a.x).toBeCloseTo(b.x, digits); expect(a.y).toBeCloseTo(b.y, digits); expect(a.z).toBeCloseTo(b.z, digits); };
const dist = (a: V, b: V): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A turn that has nothing to do with how a hand bends: bones in a real rig face wherever the exporter left them. */
const scrambled = (depth: number): Q => q.normalize({ w: 0.3 + depth * 0.17, x: Math.sin(depth * 1.9 + 0.4), y: Math.cos(depth * 2.7), z: Math.sin(depth * 0.8 - 1) });

describe.skipIf(!HAS_WASM)('a grip pose', () => {
    beforeAll(async () => { if (HAS_WASM) core = await loadWasmModule(); });

    it('closes the fingers toward the palm, not away from it', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        const open = tips(s.world, rig);
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        const shut = tips(s.world, rig);
        for (const f of ['index', 'middle', 'ring', 'pinky']) {
            // A closed finger rolls back toward the palm, so its tip ends near it, on the palm's side.
            expect(shut[f]!.z, f).toBeLessThan(-0.005);
            expect(shut[f]!.y, f).toBeLessThan(open[f]!.y - 0.03);
        }
    });

    it('brings the thumb across the palm toward the fingers', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        const open = tips(s.world, rig);
        hold(s.world, rig, { rightPose: 'handle' });
        await s.tick(2);
        const held = tips(s.world, rig);
        expect(held.thumb!.z).toBeLessThan(-0.01);
        expect(dist(held.thumb!, held.index!)).toBeLessThan(dist(open.thumb!, open.index!));
    });

    it('does not turn the thumb back over the wrist, however closed', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        // Ahead of where the fingers start from the hand, and on the palm's side: a thumb that has gone past the wrist is behind both.
        const tip = tips(s.world, rig).thumb!;
        expect(tip.y).toBeGreaterThan(0);
        expect(tip.z).toBeLessThan(0);
        // And over the fingers, not out past the little one on the far side.
        const knuckles = LAYOUT.pinky!.from.x;
        expect(tip.x).toBeLessThan(knuckles);
        expect(tip.x).toBeGreaterThan(LAYOUT.index!.from.x - 0.02);
    });

    it('turns the thumb toward the fingers by its opposition, whatever else it does', async () => {
        const none = { curl: 0 };
        registerGripPose('thumb-beside', { thumb: { curl: 0, opposition: 0 }, index: none, middle: none, ring: none, pinky: none });
        registerGripPose('thumb-across', { thumb: { curl: 0, opposition: 1 }, index: none, middle: none, ring: none, pinky: none });
        const s = scene();
        const beside = buildRig(s.world);
        hold(s.world, beside, { rightPose: 'thumb-beside' });
        const t = scene();
        const across = buildRig(t.world);
        hold(t.world, across, { rightPose: 'thumb-across' });
        await s.tick(2);
        await t.tick(2);
        const a = tips(s.world, beside).thumb!, b = tips(t.world, across).thumb!;
        expect(b.z).toBeLessThan(a.z - 0.01);
        expect(b.y).toBeGreaterThan(a.y);
        expect(tips(t.world, across).index!.z).toBeCloseTo(tips(s.world, beside).index!.z, 5);
    });

    it('makes the same hand on rigs whose bones face different ways', async () => {
        for (const pose of ['fist', 'pistol', 'cup', 'pinch']) {
            const s = scene();
            const a = buildRig(s.world);
            hold(s.world, a, { rightPose: pose });
            const t = scene();
            const b = buildRig(t.world, { frame: scrambled });
            hold(t.world, b, { rightPose: pose });
            await s.tick(2);
            await t.tick(2);
            const ta = tips(s.world, a), tb = tips(t.world, b);
            for (const f of Object.keys(ta)) close(ta[f]!, tb[f]!);
        }
    });

    it('mirrors for the other hand', async () => {
        const s = scene();
        const right = buildRig(s.world);
        hold(s.world, right, { rightPose: 'pistol' });
        const t = scene();
        const left = buildRig(t.world, { side: 'left' });
        hold(t.world, left, { leftPose: 'pistol' });
        await s.tick(2);
        await t.tick(2);
        const r = tips(s.world, right), l = tips(t.world, left);
        for (const f of Object.keys(r)) close({ x: -r[f]!.x, y: r[f]!.y, z: r[f]!.z }, l[f]!);
    });

    it('holds both hands of one rig, each its own', async () => {
        const s = scene();
        const root = s.world.spawn('Rig');
        s.world.insert(root, Transform, {});
        const r = buildRig(s.world), l = buildRig(s.world, { side: 'left' });
        s.world.setParent(r.root, root); s.world.setParent(l.root, root);
        const openLeft = tips(s.world, l);
        hold(s.world, { root }, { rightPose: 'fist', leftPose: 'open' });
        await s.tick(2);
        expect(tips(s.world, r).index!.z).toBeLessThan(-0.015);
        close(tips(s.world, l).index!, openLeft.index!);
    });

    it('does not depend on the turn of the rig it is on', async () => {
        const s = scene();
        const a = buildRig(s.world);
        hold(s.world, a, { rightPose: 'handle' });
        const t = scene();
        const b = buildRig(t.world, { root: q.normalize({ w: 0.5, x: 0.5, y: -0.5, z: 0.5 }) });
        hold(t.world, b, { rightPose: 'handle' });
        await s.tick(2);
        await t.tick(2);
        const ta = tips(s.world, a), tb = tips(t.world, b);
        for (const f of Object.keys(ta)) close(ta[f]!, tb[f]!);
    });

    it('finds the hand and fingers under other rigs\' names, through the bones in the palm', async () => {
        const s = scene();
        const rig = buildRig(s.world, { handName: 'hand_r', metacarpal: true, names: (finger, i) => `${finger}_0${i + 1}_r` });
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        const status = gripPoseStatus(s.app, rig.root)!;
        expect(status.right.hand).toBe(rig.hand);
        expect(status.right.joints).toBe(15);
        expect(status.right.missing).toEqual([]);
        expect(tips(s.world, rig).middle!.z).toBeLessThan(-0.015);
    });

    it('does not take a finger for the hand', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(1);
        expect(gripPoseStatus(s.app, rig.root)!.right.hand).toBe(rig.hand);
    });

    it('does without the fingers a rig has no bones for, and says so', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = scene();
        const rig = buildRig(s.world, { without: ['ring', 'pinky'] });
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        const status = gripPoseStatus(s.app, rig.root)!;
        expect(status.right.missing).toEqual(['ring', 'pinky']);
        expect(status.right.joints).toBe(9);
        expect(tips(s.world, rig).index!.z).toBeLessThan(-0.015);
        warn.mockRestore();
    });

    it('takes the hand from a path where the name would not find it', async () => {
        const s = scene();
        const rig = buildRig(s.world, { handName: 'bone_17' });
        hold(s.world, rig, { rightPose: 'fist', rightHand: 'Armature/bone_17' });
        await s.tick(2);
        expect(gripPoseStatus(s.app, rig.root)!.right.hand).toBe(rig.hand);
        expect(tips(s.world, rig).index!.z).toBeLessThan(-0.015);
    });

    it('leaves a hand it cannot find alone, and goes on', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = scene();
        const rig = buildRig(s.world, { handName: 'bone_17' });
        const before = tips(s.world, rig);
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        expect(gripPoseStatus(s.app, rig.root)!.right.hand).toBeNull();
        close(tips(s.world, rig).index!, before.index!);
        warn.mockRestore();
    });

    it('stays put however long it is held: nothing piles up', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        hold(s.world, rig, { rightPose: 'pistol', rightWeight: 0.5 });
        await s.tick(2);
        const once = tips(s.world, rig);
        await s.tick(120);
        const later = tips(s.world, rig);
        for (const f of Object.keys(once)) close(once[f]!, later[f]!, 5);
    });

    it('goes part of the way by its weight', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        const open = tips(s.world, rig).index!;
        hold(s.world, rig, { rightPose: 'fist', rightWeight: 1 });
        await s.tick(2);
        const shut = tips(s.world, rig).index!;
        const t = scene();
        const half = buildRig(t.world);
        hold(t.world, half, { rightPose: 'fist', rightWeight: 0.5 });
        await t.tick(2);
        const between = tips(t.world, half).index!;
        expect(dist(between, open)).toBeGreaterThan(0.01);
        expect(dist(between, shut)).toBeGreaterThan(0.01);
    });

    it('eases from one pose to the next, with no jump', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        hold(s.world, rig, { rightPose: 'open', blendSeconds: 0.2 });
        await s.tick(30);
        s.world.update(rig.root, GripPose, (d: GripPoseData) => { d.rightPose = 'fist'; });
        let last = tips(s.world, rig).index!, biggest = 0, first = -1;
        for (let i = 0; i < 40; i++) {
            await s.tick(1);
            const now = tips(s.world, rig).index!;
            if (first < 0) first = dist(now, last);
            biggest = Math.max(biggest, dist(now, last));
            last = now;
        }
        const t = scene();
        const direct = buildRig(t.world);
        const open = tips(t.world, direct).index!;
        hold(t.world, direct, { rightPose: 'fist' });
        await t.tick(2);
        const whole = dist(tips(t.world, direct).index!, open);
        expect(dist(last, tips(t.world, direct).index!)).toBeLessThan(0.002);
        // It starts from still: a share of the gap each frame would be at its fastest on the first.
        expect(first).toBeLessThan(whole * 0.25);
        expect(biggest).toBeLessThan(whole * 0.4);
    });

    it('presses the trigger with the index finger alone, in a pose that has one', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        hold(s.world, rig, { rightPose: 'pistol', rightTrigger: 0 });
        await s.tick(2);
        const resting = tips(s.world, rig);
        s.world.update(rig.root, GripPose, (d: GripPoseData) => { d.rightTrigger = 1; });
        await s.tick(2);
        const pressed = tips(s.world, rig);
        expect(dist(resting.index!, pressed.index!)).toBeGreaterThan(0.01);
        close(resting.middle!, pressed.middle!, 5);
        close(resting.thumb!, pressed.thumb!, 5);

        const t = scene();
        const plain = buildRig(t.world);
        hold(t.world, plain, { rightPose: 'fist', rightTrigger: 0 });
        await t.tick(2);
        const shut = tips(t.world, plain).index!;
        t.world.update(plain.root, GripPose, (d: GripPoseData) => { d.rightTrigger = 1; });
        await t.tick(2);
        close(shut, tips(t.world, plain).index!, 5);
    });

    it('goes over what a clip says of the fingers, by its weight', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        s.world.insert(rig.root, Animator, {});
        const finger = rig.bones.index![0]!;
        const clip = q.normalize({ w: 0.9, x: 0.3, y: 0.1, z: 0 });
        const speak = (): void => { s.world.update(finger, Transform, (d: TransformData) => { d.rotation = clip; }); };
        hold(s.world, rig, { rightPose: 'fist', rightWeight: 0 });
        speak();
        await s.tick(2);
        const left = (s.world.get(finger, Transform) as TransformData).rotation;
        expect(left.x).toBeCloseTo(clip.x, 4);
        expect(left.w).toBeCloseTo(clip.w, 4);
        s.world.update(rig.root, GripPose, (d: GripPoseData) => { d.rightWeight = 1; });
        speak();
        await s.tick(2);
        const over = (s.world.get(finger, Transform) as TransformData).rotation;
        expect(Math.abs(over.x - clip.x) + Math.abs(over.w - clip.w)).toBeGreaterThan(0.05);
    });

    it('fades away when its pose is taken off, and leaves the hand as it found it when it goes', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        const open = tips(s.world, rig);
        hold(s.world, rig, { rightPose: 'fist', blendSeconds: 0.05 });
        await s.tick(30);
        s.world.update(rig.root, GripPose, (d: GripPoseData) => { d.rightPose = ''; });
        await s.tick(30);
        close(tips(s.world, rig).index!, open.index!);

        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        expect(dist(tips(s.world, rig).index!, open.index!)).toBeGreaterThan(0.02);
        s.world.remove(rig.root, GripPose);
        await s.tick(2);
        close(tips(s.world, rig).index!, open.index!, 4);
    });

    it('writes nothing once a hand has settled on a rig no clip moves', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        hold(s.world, rig, { rightPose: 'pistol' });
        await s.tick(3);
        const spy = vi.spyOn(s.world, 'update');
        await s.tick(10);
        expect(spy.mock.calls.filter((c) => c[1] === Transform).length).toBe(0);
    });

    it('takes a pose of the game\'s own, and leaves a name it does not know alone', async () => {
        registerGripPose('claw', { thumb: { curl: 1, opposition: 1 }, index: { curl: 1, base: 0 }, middle: { curl: 1, base: 0 }, ring: { curl: 1, base: 0 }, pinky: { curl: 1, base: 0 } });
        expect(gripPoseNames()).toContain('claw');
        const s = scene();
        const rig = buildRig(s.world);
        const open = tips(s.world, rig);
        hold(s.world, rig, { rightPose: 'claw' });
        await s.tick(2);
        expect(tips(s.world, rig).index!.z).toBeLessThan(-0.01);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const t = scene();
        const other = buildRig(t.world);
        hold(t.world, other, { rightPose: 'nothing like this' });
        await t.tick(2);
        close(tips(t.world, other).index!, open.index!);
        warn.mockRestore();
    });

    it('does nothing while not playing', async () => {
        const s = scene();
        const rig = buildRig(s.world);
        const open = tips(s.world, rig);
        setEditorMode(true); setPlayMode(false);
        hold(s.world, rig, { rightPose: 'fist' });
        await s.tick(2);
        close(tips(s.world, rig).index!, open.index!, 5);
    });
});
