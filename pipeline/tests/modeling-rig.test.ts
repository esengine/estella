// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A rig held to what moving proves: rest is rest, a joint turns what it should and nothing else, and the files say the same. */
import { describe, expect, it } from 'vitest';
import { decodeMesh, encodeMesh, MeshChannel } from 'esengine';
import { bakeModel, posedPositions, prefabOf, renderRigSheet, timelineOf, validateModelSource, type AnimationSource, type BakedModel, type ModelStep, type RigSource } from '../src/modeling';

/** An upright limb in three bones, base at the origin. */
const limb: ModelStep = { op: 'organic', resolution: 48, blend: 0.05, tag: 'limb', parts: [{ shape: 'chain', points: [[0, 0, 0, 0.2], [0, 2, 0, 0.2]] }] };
const limbRig: RigSource = { joints: [
    { name: 'base', at: [0, 0, 0] },
    { name: 'mid', at: [0, 1, 0], parent: 'base' },
    { name: 'tip', at: [0, 2, 0], parent: 'mid' },
] };
const bake = (animations: AnimationSource[] = [], rig: RigSource = limbRig, steps: ModelStep[] = [limb]): BakedModel =>
    bakeModel({ version: 1, rig, ...(animations.length ? { animations } : {}), steps });
const bend = (deg: number): AnimationSource => ({ name: 'bend', duration: 1, loop: false, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 0], [1, 0, 0, deg]] }] });

const pose = (m: BakedModel, a: AnimationSource | null, t: number) => posedPositions(m.poly, m.rig!.joints, m.rig!.skin, a, t);

describe('weights', () => {
    it('sum to one on every vertex, with the strongest first', () => {
        const { skin } = bake().rig!;
        for (let v = 0; v * 4 < skin.weights.length; v++) {
            const w = [...skin.weights.subarray(v * 4, v * 4 + 4)];
            expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
            expect(w[0]!).toBeGreaterThanOrEqual(w[1]!);
        }
    });

    it('a vertex well along a bone is held by that bone alone', () => {
        const m = bake();
        const { joints, weights } = m.rig!.skin;
        const baseIndex = m.rig!.joints.findIndex((j) => j.name === 'base');
        m.poly.positions.forEach((p, v) => {
            if (Math.abs(p[1] - 0.3) > 0.1) return;
            expect(joints[v * 4]).toBe(baseIndex);
            expect(weights[v * 4]!).toBeGreaterThan(0.95);
        });
    });

    it('two legs side by side do not take each other: they are far apart over the skin', () => {
        // Hips with two legs a hair apart through the air.
        const legs: ModelStep = { op: 'organic', resolution: 96, parts: [
            { shape: 'sphere', radius: 0.4, at: [0, 2, 0], tag: 'hips' },
            { shape: 'chain', mirror: 'x', points: [[0.17, 2, 0, 0.15], [0.17, 0, 0, 0.15]], tag: 'leg' },
        ] };
        const rig: RigSource = { joints: [
            { name: 'hips', at: [0, 2, 0] },
            { name: 'leg', at: [0.17, 1.8, 0], parent: 'hips', mirror: 'x' },
            { name: 'foot', at: [0.17, 0, 0], parent: 'leg', mirror: 'x' },
        ] };
        const m = bake([], rig, [legs]);
        const left = m.rig!.joints.findIndex((j) => j.name === 'leg.L');
        const right = m.rig!.joints.findIndex((j) => j.name === 'leg.R');
        let crossed = 0, checked = 0;
        m.poly.positions.forEach((p, v) => {
            if (p[1] > 1.3 || p[1] < 0.3) return; // well down the legs
            checked++;
            const wrong = p[0] > 0 ? right : left;
            for (let k = 0; k < 4; k++) if (m.rig!.skin.joints[v * 4 + k] === wrong && m.rig!.skin.weights[v * 4 + k]! > 0.01) crossed++;
        });
        expect(checked).toBeGreaterThan(100);
        expect(crossed).toBe(0);
    });

    it('a separate shell follows the bone nearest it, rigidly', () => {
        const m = bake([], limbRig, [limb, { op: 'sphere', radius: 0.1, at: [0.4, 1.6, 0], tag: 'eye' }]);
        const midIndex = m.rig!.joints.findIndex((j) => j.name === 'mid');
        m.poly.faces.filter((f) => f.tag === 'eye').flatMap((f) => f.v).forEach((v) => {
            expect(m.rig!.skin.joints[v * 4]).toBe(midIndex);
        });
    });

    it('the report says what each joint moves, and which move nothing', () => {
        const m = bake();
        expect(m.report.joints!.base).toBeGreaterThan(100);
        expect(m.report.warnings).toEqual([]);
        const far = bake([], { joints: [{ name: 'base', at: [0, 1, 0] }, { name: 'stray', at: [9, 0, 0], parent: 'base' }, { name: 'strayEnd', at: [10, 0, 0], parent: 'stray' }, { name: 'end', at: [0, 2, 0], parent: 'base' }] });
        expect(far.report.warnings.join()).toMatch(/stray moves no vertex/);
    });
});

describe('poses', () => {
    it('the bind pose is where the mesh already is', () => {
        const m = bake();
        pose(m, null, 0).forEach((p, v) => {
            const q = m.poly.positions[v]!;
            expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(1e-5);
        });
    });

    it('turning a joint moves what is past it and leaves what is before it', () => {
        const a = bend(90);
        const m = bake([a]);
        const after = pose(m, a, 1);
        m.poly.positions.forEach((q, v) => {
            const p = after[v]!;
            if (q[1] < 0.6) expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(0.01);
        });
        // 90 degrees about Z takes the tip from straight up to out along -X, from the joint at height 1.
        const tip = after[m.poly.positions.reduce((best, q, v) => (q[1] > m.poly.positions[best]![1] ? v : best), 0)]!;
        expect(tip[0]).toBeLessThan(-1);
        expect(tip[1]).toBeCloseTo(1, 0);
    });

    it('the joints stack: turning two adds up', () => {
        const a: AnimationSource = { name: 'curl', duration: 1, loop: false, tracks: [
            { joint: 'base', rotate: [[0, 0, 0, 0], [1, 0, 0, 90]] },
            { joint: 'mid', rotate: [[0, 0, 0, 0], [1, 0, 0, 90]] },
        ] };
        const m = bake([a]);
        const after = pose(m, a, 1);
        const top = m.poly.positions.reduce((best, q, v) => (q[1] > m.poly.positions[best]![1] ? v : best), 0);
        // Base: out along -X for 1. Then a further 90: on down -Y for 1.
        expect(after[top]![0]).toBeCloseTo(-1, 0);
        expect(after[top]![1]).toBeLessThan(-0.5);
    });

    it('a clip passes through its keys exactly, and a loop joins up', () => {
        const a: AnimationSource = { name: 'wave', duration: 2, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 0], [0.5, 0, 0, 40], [1.5, 0, 0, -40]] }] };
        const m = bake([a]);
        const near = (x: readonly (readonly number[])[], y: readonly (readonly number[])[]): number =>
            Math.max(...x.map((p, i) => Math.hypot(p[0]! - y[i]![0]!, p[1]! - y[i]![1]!, p[2]! - y[i]![2]!)));
        expect(near(pose(m, a, 0), pose(m, a, 2))).toBeLessThan(1e-4);
        const key: AnimationSource = { name: 'k', duration: 2, loop: false, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 40]] }] };
        expect(near(pose(m, a, 0.5), pose(m, key, 0))).toBeLessThan(1e-4);
    });

    it('phase puts a second joint behind the first', () => {
        const keys = [[0, 0, 0, 30], [0.5, 0, 0, -30]];
        const a: AnimationSource = { name: 'p', duration: 1, tracks: [{ joint: 'mid', rotate: keys, phase: 0.5 }] };
        const b: AnimationSource = { name: 'q', duration: 1, tracks: [{ joint: 'mid', rotate: keys }] };
        const m = bake([a, b]);
        const [x, y] = [pose(m, a, 0.5), pose(m, b, 0)];
        expect(Math.hypot(x[0]![0] - y[0]![0], x[0]![1] - y[0]![1])).toBeLessThan(1e-4);
    });

    it('move shifts a joint: a whole body bobs', () => {
        const a: AnimationSource = { name: 'bob', duration: 1, loop: false, tracks: [{ joint: 'base', move: [[0, 0, 0, 0], [1, 0, 1, 0]] }] };
        const m = bake([a]);
        pose(m, a, 1).forEach((p, v) => expect(p[1]).toBeCloseTo(m.poly.positions[v]![1] + 1, 3));
    });

    it('mirror makes both sides, each with its own parent side', () => {
        const rig: RigSource = { joints: [
            { name: 'hips', at: [0, 1, 0] },
            { name: 'leg', at: [0.3, 1, 0], parent: 'hips', mirror: 'x' },
            { name: 'foot', at: [0.3, 0, 0], parent: 'leg', mirror: 'x' },
        ] };
        const m = bake([], rig, [{ op: 'box', size: 2 }]);
        const names = m.rig!.joints.map((j) => j.name);
        expect(names).toEqual(expect.arrayContaining(['leg.L', 'leg.R', 'foot.L', 'foot.R']));
        const footR = m.rig!.joints.find((j) => j.name === 'foot.R')!;
        expect(m.rig!.joints[footR.parent]!.name).toBe('leg.R');
        expect(footR.at[0]).toBeCloseTo(-0.3, 6);
    });
});

describe('the files', () => {
    it('the mesh carries the joints, the weights and one bind matrix each, and no lightmap', () => {
        const m = bake();
        const back = decodeMesh(encodeMesh(m.data));
        expect(back.channels.find((c) => c.semantic === MeshChannel.Joints)).toBeDefined();
        expect(back.channels.find((c) => c.semantic === MeshChannel.Weights)).toBeDefined();
        expect(back.channels.find((c) => c.semantic === MeshChannel.TexCoord1)).toBeUndefined();
        expect(back.inverseBindMatrices!.length).toBe(3 * 16);
        const mid = m.rig!.joints.findIndex((j) => j.name === 'mid');
        expect(back.inverseBindMatrices![mid * 16 + 13]).toBeCloseTo(-1, 6);
    });

    it('a clip addresses each joint by its path under the root, and keeps to the short way round', () => {
        const m = bake([bend(350)]);
        const doc = timelineOf(bend(350), m.rig!.joints) as { duration: number; wrapMode: string; tracks: { childPath: string; component: string; channels: { property: string; keyframes: { value: number }[] }[] }[] };
        expect(doc.duration).toBe(1);
        expect(doc.wrapMode).toBe('once');
        expect(doc.tracks[0]!.childPath).toBe('base/mid');
        expect(doc.tracks[0]!.component).toBe('Transform');
        expect(doc.tracks[0]!.channels.map((c) => c.property)).toEqual(['rotation.x', 'rotation.y', 'rotation.z', 'rotation.w']);
        const [z, w] = [doc.tracks[0]!.channels[2]!.keyframes, doc.tracks[0]!.channels[3]!.keyframes];
        for (let i = 1; i < z.length; i++) {
            const dot = z[i]!.value * z[i - 1]!.value + w[i]!.value * w[i - 1]!.value;
            expect(dot).toBeGreaterThan(0);
        }
    });

    it('a looping clip says so', () => {
        const a: AnimationSource = { name: 'w', duration: 1, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 30]] }] };
        expect((timelineOf(a, bake([a]).rig!.joints) as { wrapMode: string }).wrapMode).toBe('loop');
    });

    it('the prefab has the mesh on its root, the joints under it by name, the skin naming them in bind order', () => {
        const m = bake();
        const doc = prefabOf('Limb', 'assets/Limb.esmesh', m.rig!.joints, true, 'assets/Limb_bend.estimeline') as { rootEntityId: string; entities: { prefabEntityId: string; name: string; parent: string | null; children: string[]; components: { type: string; data: Record<string, unknown> }[] }[] };
        const root = doc.entities.find((e) => e.prefabEntityId === doc.rootEntityId)!;
        const comp = (t: string) => root.components.find((c) => c.type === t)!.data;
        expect(comp('MeshRenderer')).toMatchObject({ mesh: 'assets/Limb.esmesh', lit: true, opaque: true, cullBackfaces: true });
        expect(comp('TimelinePlayer')).toMatchObject({ timeline: 'assets/Limb_bend.estimeline', playing: true });
        const ids = comp('MeshSkin').joints as string[];
        expect(ids.map((id) => doc.entities.find((e) => e.prefabEntityId === id)!.name)).toEqual(m.rig!.joints.map((j) => j.name));
        const mid = doc.entities.find((e) => e.name === 'mid')!;
        expect(mid.components[0]!.data.position).toEqual({ x: 0, y: 1, z: 0 });
        expect(doc.entities.find((e) => e.prefabEntityId === mid.parent)!.name).toBe('base');
        expect(root.children.length).toBe(1);
    });
});

describe('looking at it', () => {
    const a = bend(90);
    const m = bake([a]);
    const darkCount = (s: { width: number; height: number; rgba: Uint8Array }): number => {
        let n = 0;
        for (let i = 0; i < s.width * s.height; i++) if (s.rgba[i * 4 + 2]! === 0 && s.rgba[i * 4]! === 255) n++;
        return n;
    };

    it('draws the bones over the body by default', () => {
        expect(darkCount(renderRigSheet(m, [a], { views: ['front'], panel: 128 }))).toBeGreaterThan(20);
        expect(darkCount(renderRigSheet(m, [a], { views: ['front'], panel: 128, skeleton: false }))).toBe(0);
    });

    it('a strip shows a clip over time, at one scale', () => {
        const s = renderRigSheet(m, [a], { animation: 'bend', times: [0, 1], views: ['front'], panel: 96 });
        expect(s.width).toBe(96 * 2 + 1);
        const silhouette = (col: number): number => {
            let n = 0;
            for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (s.rgba[((97 + y) * s.width + col * 97 + x) * 4]! < 60) n++;
            return n;
        };
        // Different shapes, and close to the same amount of body: a bend, not a zoom.
        expect(Math.abs(silhouette(0) - silhouette(1)) / silhouette(0)).toBeLessThan(0.2);
        let differ = 0;
        for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (s.rgba[((97 + y) * s.width + x) * 4] !== s.rgba[((97 + y) * s.width + 97 + x) * 4]) differ++;
        expect(differ).toBeGreaterThan(100);
    });

    it('shows who moves what, or how far one joint reaches', () => {
        const all = renderRigSheet(m, [a], { weights: true, views: ['front'], panel: 96, skeleton: false });
        expect(all.width).toBe(96);
        const one = renderRigSheet(m, [a], { weights: 'mid', views: ['front'], panel: 96, skeleton: false });
        expect(one.rgba).not.toEqual(all.rgba);
    });

    it('refuses what it cannot show', () => {
        expect(() => renderRigSheet(m, [a], { animation: 'nope' })).toThrow(/no animation "nope"; there are bend/);
        expect(() => renderRigSheet(m, [a], { weights: 'nope' })).toThrow(/no joint "nope"/);
        const still = bakeModel({ version: 1, steps: [{ op: 'box', size: 1 }] });
        expect(() => renderRigSheet(still, [], { weights: true })).toThrow(/no rig/);
    });
});

describe('refusals name what to change', () => {
    const source = (extra: Record<string, unknown>) => ({ version: 1, steps: [limb], ...extra });

    it('a rig that does not hold together', () => {
        expect(() => validateModelSource(source({ rig: { joints: [] } }))).toThrow(/at least one joint/);
        expect(() => validateModelSource(source({ rig: { joints: [{ name: 'a', at: [0, 0, 0] }, { name: 'b', at: [0, 1, 0] }] } }))).toThrow(/one root; these have no parent: a, b/);
        expect(() => validateModelSource(source({ rig: { joints: [{ name: 'a', at: [0, 0, 0] }, { name: 'b', at: [0, 1, 0], parent: 'c' }] } }))).toThrow(/parent "c", which is not a joint/);
        expect(() => validateModelSource(source({ rig: { joints: [{ name: 'a', at: [0, 0, 0], parent: 'b' }, { name: 'b', at: [0, 1, 0], parent: 'a' }] } }))).toThrow(/one root/);
        expect(() => validateModelSource(source({ rig: { joints: [{ name: 'a', at: [0, 0, 0] }, { name: 'a', at: [0, 1, 0], parent: 'a' }] } }))).toThrow(/two joints called "a"/);
        expect(() => validateModelSource(source({ rig: { joints: [{ name: 'a/b', at: [0, 0, 0] }] } }))).toThrow(/cannot hold a slash/);
        expect(() => validateModelSource(source({ rig: { joints: [{ name: 'a', at: [0, 0, 0], bend: 1 }] } }))).toThrow(/unknown field "bend"/);
        const many = Array.from({ length: 70 }, (_, i) => ({ name: `j${i}`, at: [0, i, 0], ...(i ? { parent: `j${i - 1}` } : {}) }));
        expect(() => validateModelSource(source({ rig: { joints: many } }))).toThrow(/at most 64/);
    });

    it('clips that do not fit the rig', () => {
        const rig = limbRig;
        const anim = (tracks: unknown[], extra = {}) => source({ rig, animations: [{ name: 'a', duration: 1, tracks, ...extra }] });
        expect(() => validateModelSource(source({ animations: [] }))).toThrow(/no rig/);
        expect(() => validateModelSource(anim([{ joint: 'elbow', rotate: [[0, 0, 0, 0]] }]))).toThrow(/no joint "elbow"; there are base, mid, tip/);
        expect(() => validateModelSource(anim([{ joint: 'mid' }]))).toThrow(/none of rotate, move, reach/);
        expect(() => validateModelSource(anim([{ joint: 'mid', rotate: [[2, 0, 0, 0]] }]))).toThrow(/time 2 is outside/);
        expect(() => validateModelSource(anim([{ joint: 'mid', rotate: [[0.5, 0, 0, 0], [0.2, 0, 0, 0]] }]))).toThrow(/time order/);
        expect(() => validateModelSource(anim([{ joint: 'mid', rotate: [[0, 0, 0]] }]))).toThrow(/every key is \[time, x, y, z\]/);
        expect(() => validateModelSource(anim([{ joint: 'mid', rotate: [[0, 0, 0, 0]] }, { joint: 'mid', move: [[0, 0, 0, 0]] }]))).toThrow(/two tracks for joint/);
        expect(() => validateModelSource(source({ rig, animations: [{ name: 'a b', duration: 1, tracks: [] }] }))).toThrow(/file name/);
    });

    it('an atlas on a rigged mesh, with what to use', () => {
        expect(() => validateModelSource(source({ rig: limbRig, uvAtlas: true }))).toThrow(/Use uv steps/);
    });
});
