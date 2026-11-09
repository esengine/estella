// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { decodeMesh, encodeMesh, MeshChannel } from '../src/asset/meshFormat';
import {
    autoWeightPart, bakeRig, bindPartToBone, chainTip, checkRig, clampAngle, coverRigPart, createRig, findRigParts, paintPartWeights, parseRig,
    partWeightsOf, pushRigDeform, removeRigBone, rigBoneWorlds, rigImageFromRGBA, rigVertex, serializeRig, skinRigPart, solveChain2D,
    type ChainBone, type RigPart, type RigSource,
} from '../src/rig2d/index';

const solidImage = (w: number, h: number, drawn: (x: number, y: number) => boolean) => ({ width: w, height: h, alpha: (x: number, y: number) => (drawn(x, y) ? 255 : 0) });

/** A 100x20 limb along +x from the origin, two bones meeting at its middle. */
function limb(): RigSource {
    const rig = createRig('limb.png', 100, 20);
    rig.bones.push({ name: 'upper', parent: -1, x: 0, y: 0, rotation: 0, length: 50 }, { name: 'lower', parent: 0, x: 50, y: 0, rotation: 0, length: 50 });
    const rect = { x: 0, y: 0, w: 100, h: 20 };
    const part: RigPart = { name: 'limb', rect, x: 0, y: 10, ...coverRigPart(solidImage(100, 20, () => true), rect, { cell: 10 }), weights: [] };
    rig.parts.push(part);
    autoWeightPart(rig, part);
    return rig;
}

function vertexOf(mesh: ReturnType<typeof bakeRig>, v: number) {
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    const at = (s: number) => v * mesh.vertexStride + mesh.channels.find(c => c.semantic === s)!.offset;
    return {
        x: view.getFloat32(at(MeshChannel.Position), true), y: view.getFloat32(at(MeshChannel.Position) + 4, true),
        u: view.getFloat32(at(MeshChannel.TexCoord0), true), v: view.getFloat32(at(MeshChannel.TexCoord0) + 4, true),
        j0: view.getUint16(at(MeshChannel.Joints), true), w0: view.getFloat32(at(MeshChannel.Weights), true),
    };
}

describe('rig source', () => {
    it('round-trips through its file', () => {
        const rig = limb();
        expect(parseRig(serializeRig(rig)).bones).toEqual(rig.bones);
        expect(parseRig(serializeRig(rig)).parts[0]!.triangles).toEqual(rig.parts[0]!.triangles);
    });

    it.each([
        ['another version', (r: any) => { r.version = 99; }, /version/],
        ['a child before its parent', (r: any) => { r.bones[0].parent = 1; }, /earlier/],
        ['two bones of one name', (r: any) => { r.bones[1].name = 'upper'; }, /two bones/],
        ['a triangle past the vertices', (r: any) => { r.parts[0].triangles[0] = 99999; }, /triangles/],
        ['a vertex with no weight list', (r: any) => { r.parts[0].weights.pop(); }, /weight list/],
        ['a weight on a missing bone', (r: any) => { r.parts[0].weights[0] = [7, 1]; }, /not there/],
        ['more influences than the mesh holds', (r: any) => { r.parts[0].weights[0] = [0, .2, 0, .2, 0, .2, 0, .2, 0, .2]; }, /bad weights/],
        ['a deform of a missing part', (r: any) => { r.deforms.push({ name: 'd', offsets: { nope: [0, 1, 1] } }); }, /not there/],
        ['a deform of a missing vertex', (r: any) => { r.deforms.push({ name: 'd', offsets: { limb: [99999, 1, 1] } }); }, /does not have/],
    ])('refuses %s', (_name, spoil, message) => {
        const rig = limb();
        spoil(rig);
        expect(checkRig(rig).join(' ')).toMatch(message);
        expect(() => parseRig(JSON.stringify(rig))).toThrow(message);
    });

    it('gives a removed bone\'s children and vertices to its parent, leaving the children where they stood', () => {
        const rig = createRig('x.png', 10, 10);
        rig.bones.push(
            { name: 'a', parent: -1, x: 10, y: 0, rotation: Math.PI / 2, length: 10 },
            { name: 'b', parent: 0, x: 10, y: 0, rotation: 0.5, length: 10 },
            { name: 'c', parent: 1, x: 10, y: 0, rotation: 0.25, length: 10 },
        );
        rig.parts.push({ name: 'p', rect: { x: 0, y: 0, w: 1, h: 1 }, x: 0, y: 0, vertices: [0, 0], triangles: [], weights: [[1, 0.5, 2, 0.5]] });
        const before = rigBoneWorlds(rig.bones)[2]!;
        removeRigBone(rig, 1);
        expect(rig.bones.map(b => b.name)).toEqual(['a', 'c']);
        const after = rigBoneWorlds(rig.bones)[1]!;
        expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y); expect(after.rotation).toBeCloseTo(before.rotation);
        expect(rig.parts[0]!.weights[0]).toEqual([0, 0.5, 1, 0.5]);
        expect(checkRig(rig)).toEqual([]);
    });
});

describe('from an image', () => {
    it('finds each separate picture, leaving specks out', () => {
        const image = solidImage(40, 20, (x, y) => (x < 10 && y < 10) || (x >= 20 && x < 35 && y >= 5 && y < 15) || (x === 39 && y === 19));
        expect(findRigParts(image)).toEqual([{ x: 20, y: 5, w: 15, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }]);
    });

    it('reads alpha out of RGBA rows', () => {
        const rgba = new Uint8Array(2 * 2 * 4); rgba[(1 * 2 + 1) * 4 + 3] = 200;
        const image = rigImageFromRGBA(2, 2, rgba);
        expect(image.alpha(1, 1)).toBe(200); expect(image.alpha(0, 0)).toBe(0);
    });

    it('covers what is drawn and nothing else, sharing corners', () => {
        const image = solidImage(30, 10, x => x < 10 || x >= 20);
        const { vertices, triangles } = coverRigPart(image, { x: 0, y: 0, w: 30, h: 10 }, { cell: 10 });
        expect(triangles.length).toBe(2 * 2 * 3);
        expect(vertices.length / 2).toBe(8);
        for (let v = 0; v < vertices.length; v += 2) expect(vertices[v]! <= 10 || vertices[v]! >= 20).toBe(true);
    });

    it('stays inside a rect that is not a whole number of cells', () => {
        const { vertices } = coverRigPart(solidImage(25, 13, () => true), { x: 0, y: 0, w: 25, h: 13 }, { cell: 10 });
        expect(Math.max(...vertices.filter((_, i) => i % 2 === 0))).toBe(25);
        expect(Math.max(...vertices.filter((_, i) => i % 2 === 1))).toBe(13);
    });

    it('winds its triangles the way the mesh pipeline culls, counter-clockwise with y up', () => {
        const rig = limb(), part = rig.parts[0]!;
        for (let t = 0; t < part.triangles.length; t += 3) {
            const [a, b, c] = [0, 1, 2].map(i => rigVertex(rig, part, part.triangles[t + i]!)) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
            expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0);
        }
    });
});

describe('weights', () => {
    it('follows the nearer bone, and sums to one', () => {
        const rig = limb(), part = rig.parts[0]!;
        part.weights.forEach((w, v) => {
            let sum = 0;
            for (let i = 1; i < w.length; i += 2) sum += w[i]!;
            expect(sum).toBeCloseTo(1);
            const at = rigVertex(rig, part, v), share = partWeightsOf(part, 0)[v]!;
            if (at.x < 30) expect(share).toBeGreaterThan(0.9);
            if (at.x > 70) expect(share).toBeLessThan(0.1);
        });
    });

    it('binds only to the bones it is allowed', () => {
        const rig = limb(), part = rig.parts[0]!;
        autoWeightPart(rig, part, { bones: [1] });
        expect(part.weights.every(w => w.length === 2 && w[0] === 1 && w[1] === 1)).toBe(true);
        bindPartToBone(part, 0);
        expect(part.weights.every(w => w[0] === 0 && w[1] === 1)).toBe(true);
    });

    const sums = (part: RigPart) => part.weights.map(w => w.reduce((t, x, i) => (i % 2 ? t + x : t), 0));

    it('paints a bone in within the brush, the others giving way', () => {
        const rig = limb(), part = rig.parts[0]!;
        bindPartToBone(part, 0);
        const changed = paintPartWeights(rig, part, { x: 80, y: 0, radius: 15, bone: 1, strength: 1, mode: 'add' });
        expect(changed).toBeGreaterThan(0);
        const share = partWeightsOf(part, 1);
        part.weights.forEach((_, v) => {
            const at = rigVertex(rig, part, v), d = Math.hypot(at.x - 80, at.y);
            if (d >= 15) expect(share[v]).toBe(0); else expect(share[v]).toBeGreaterThan(0);
            if (d === 0) expect(share[v]).toBeCloseTo(1);
        });
        for (const s of sums(part)) expect(s).toBeCloseTo(1);
        expect(checkRig(rig)).toEqual([]);
    });

    it('removes a bone without ever leaving a vertex that follows nothing', () => {
        const rig = limb(), part = rig.parts[0]!;
        bindPartToBone(part, 0);
        paintPartWeights(rig, part, { x: 50, y: 0, radius: 500, bone: 0, strength: 1, mode: 'remove' });
        expect(part.weights.every(w => w.length >= 2)).toBe(true);
        for (const s of sums(part)) expect(s).toBeCloseTo(1);
    });

    it('smooths a hard edge, keeping the sum', () => {
        const rig = limb(), part = rig.parts[0]!;
        part.weights = part.weights.map((_, v) => [rigVertex(rig, part, v).x < 50 ? 0 : 1, 1]);
        const near = part.weights.findIndex((_, v) => rigVertex(rig, part, v).x === 50);
        expect(partWeightsOf(part, 0)[near]).toBe(0);
        paintPartWeights(rig, part, { x: 50, y: 0, radius: 40, bone: 0, strength: 1, mode: 'smooth' });
        const share = partWeightsOf(part, 0)[near]!;
        expect(share).toBeGreaterThan(0.2); expect(share).toBeLessThan(0.8);
        for (const s of sums(part)) expect(s).toBeCloseTo(1);
    });
});

describe('baking', () => {
    it('refuses what could not move', () => {
        const none = createRig('x.png', 10, 10);
        expect(() => bakeRig(none)).toThrow(/no bones/);
        const rig = limb();
        rig.parts[0]!.weights[0] = [];
        expect(() => bakeRig(rig)).toThrow();
    });

    it('survives the mesh file with its skin and shapes', () => {
        const rig = limb();
        rig.deforms.push({ name: 'bulge', offsets: { limb: [0, 3, 4] } });
        const mesh = decodeMesh(encodeMesh(bakeRig(rig)));
        expect(mesh.vertexCount).toBe(rig.parts[0]!.vertices.length / 2);
        expect(mesh.inverseBindMatrices!.length).toBe(32);
        expect(mesh.morph!.names).toEqual(['bulge']);
        expect([...mesh.morph!.deltas.slice(0, 3)]).toEqual([3, 4, 0]);
    });

    it('turns image pixels into rig space and into UVs with row 0 at the top', () => {
        const rig = createRig('x.png', 200, 100, 0.5);
        rig.bones.push({ name: 'b', parent: -1, x: 0, y: 0, rotation: 0, length: 0 });
        const part: RigPart = { name: 'p', rect: { x: 50, y: 20, w: 10, h: 10 }, x: 7, y: 9, vertices: [10, 10], triangles: [], weights: [[0, 1]] };
        rig.parts.push(part);
        const v = vertexOf(bakeRig(rig), 0);
        expect(v.x).toBeCloseTo(7 + 5); expect(v.y).toBeCloseTo(9 - 5);
        expect(v.u).toBeCloseTo(60 / 200); expect(v.v).toBeCloseTo(1 - 30 / 100);
    });

    it('lays parts down in draw order', () => {
        const rig = limb();
        rig.parts.push({ ...rig.parts[0]!, name: 'front' });
        const mesh = bakeRig(rig), count = rig.parts[0]!.vertices.length / 2;
        const last = mesh.indices.slice(mesh.indices.length / 2);
        expect(Math.min(...last)).toBe(count);
    });

    it('holds the bind pose: joint world times inverse bind is identity', () => {
        const rig = limb();
        rig.bones[1]!.rotation = 0.7;
        const mesh = bakeRig(rig), worlds = rigBoneWorlds(rig.bones);
        worlds.forEach((w, i) => {
            const m = mesh.inverseBindMatrices!.slice(i * 16, i * 16 + 16);
            // Applying the inverse to the joint's own origin lands on zero, and to a point one along its +x on (1, 0).
            const apply = (x: number, y: number) => ({ x: m[0]! * x + m[4]! * y + m[12]!, y: m[1]! * x + m[5]! * y + m[13]! });
            expect(apply(w.x, w.y).x).toBeCloseTo(0); expect(apply(w.x, w.y).y).toBeCloseTo(0);
            const along = apply(w.x + Math.cos(w.rotation), w.y + Math.sin(w.rotation));
            expect(along.x).toBeCloseTo(1); expect(along.y).toBeCloseTo(0);
        });
    });
});

describe('skinning a preview', () => {
    it('leaves the bind pose where it is', () => {
        const rig = limb(), out = skinRigPart(rig, 0, rigBoneWorlds(rig.bones));
        for (let v = 0; v < out.length / 2; v++) {
            const at = rigVertex(rig, rig.parts[0]!, v);
            expect(out[v * 2]).toBeCloseTo(at.x); expect(out[v * 2 + 1]).toBeCloseTo(at.y);
        }
    });

    it('carries a vertex with its bone, and deforms before it bends', () => {
        const rig = limb(), part = rig.parts[0]!;
        bindPartToBone(part, 1);
        rig.deforms.push({ name: 'up', offsets: { limb: [0, 0, 10] } });
        const posed = rigBoneWorlds(rig.bones, [0, Math.PI / 2]);
        const out = skinRigPart(rig, 0, posed, [1]);
        const v0 = rigVertex(rig, part, 0);
        // Offset up 10 in bind space, then a quarter turn about (50, 0): (x, y) -> (50 - y, x - 50).
        expect(out[0]).toBeCloseTo(50 - (v0.y + 10)); expect(out[1]).toBeCloseTo(v0.x - 50);
    });
});

describe('pushing a deform', () => {
    it('moves what is under the brush, adds up, and bakes', () => {
        const rig = limb();
        rig.deforms.push({ name: 'bulge', offsets: {} });
        expect(pushRigDeform(rig, 0, 500, 500, 10, 1, 1)).toBe(0);
        expect(pushRigDeform(rig, 0, 50, 0, 25, 0, 8)).toBeGreaterThan(0);
        const offsets = rig.deforms[0]!.offsets.limb!;
        const centre = rig.parts[0]!.vertices.findIndex((_, i) => i % 2 === 0 && rig.parts[0]!.vertices[i] === 50 && rig.parts[0]!.vertices[i + 1] === 10) / 2;
        const at = offsets.findIndex((_, i) => i % 3 === 0 && offsets[i] === centre);
        expect(offsets[at + 2]).toBeCloseTo(8);
        expect(checkRig(rig)).toEqual([]);
        pushRigDeform(rig, 0, 50, 8, 25, 0, 4);
        expect(rig.deforms[0]!.offsets.limb![at + 2]).toBeCloseTo(12);
        expect(bakeRig(rig).morph!.names).toEqual(['bulge']);
    });
});

describe('chain solving', () => {
    const arm = (): ChainBone[] => [{ x: 0, y: 0, rotation: 0 }, { x: 50, y: 0, rotation: 0.2 }];

    it('reaches exactly with two bones, either way it bends', () => {
        for (const bend of [1, -1]) {
            const chain = arm();
            solveChain2D(chain, 40, 60, { tipLength: 50, bend });
            const tip = chainTip(chain, 50);
            expect(tip.x).toBeCloseTo(40); expect(tip.y).toBeCloseTo(60);
            expect(Math.sign(Math.sin(chain[1]!.rotation))).toBe(bend);
        }
    });

    it('reaches with a middle joint that does not lie along the bone above it', () => {
        const chain: ChainBone[] = [{ x: 5, y: 7, rotation: 0 }, { x: 40, y: 30, rotation: 0.3 }];
        solveChain2D(chain, 30, 60, { tipLength: 50, bend: 1 });
        const tip = chainTip(chain, 50);
        expect(tip.x).toBeCloseTo(30); expect(tip.y).toBeCloseTo(60);
    });

    it('finds another way when a limit stops the exact answer of two bones', () => {
        const chain: ChainBone[] = [{ x: 0, y: 0, rotation: 0, min: -0.2, max: 0.2 }, { x: 50, y: 0, rotation: 0.2 }];
        solveChain2D(chain, 60, 45, { tipLength: 50, bend: 1 });
        const tip = chainTip(chain, 50);
        expect(Math.hypot(tip.x - 60, tip.y - 45)).toBeLessThan(0.5);
        expect(Math.abs(chain[0]!.rotation)).toBeLessThanOrEqual(0.2 + 1e-9);
    });

    it('straightens at what it cannot reach, and does not break at what it cannot fold to', () => {
        const far = arm();
        solveChain2D(far, 500, 0, { tipLength: 50 });
        expect(chainTip(far, 50).x).toBeCloseTo(100);
        const close = arm();
        solveChain2D(close, 0, 0, { tipLength: 50 });
        expect(close.every(b => Number.isFinite(b.rotation))).toBe(true);
        const shortTip = arm();
        solveChain2D(shortTip, 3, 4, { tipLength: 20 });
        const tip = chainTip(shortTip, 20);
        expect(Math.hypot(tip.x, tip.y)).toBeCloseTo(30);
    });

    it('reaches with a long chain', () => {
        const chain: ChainBone[] = Array.from({ length: 6 }, (_, i) => ({ x: i === 0 ? 0 : 20, y: 0, rotation: 0.1 }));
        solveChain2D(chain, 40, 70, { tipLength: 20 });
        const tip = chainTip(chain, 20);
        expect(Math.hypot(tip.x - 40, tip.y - 70)).toBeLessThan(0.5);
    });

    it('keeps a long chain within its joints\' limits', () => {
        const chain: ChainBone[] = Array.from({ length: 4 }, (_, i) => ({ x: i === 0 ? 0 : 20, y: 0, rotation: 0, min: -0.3, max: 0.3 }));
        solveChain2D(chain, -40, 10, { tipLength: 20 });
        for (const b of chain) expect(Math.abs(b.rotation)).toBeLessThanOrEqual(0.3 + 1e-9);
    });

    it('clamps across the wrap, the short way round', () => {
        expect(clampAngle(3.1, 2.8, 3.4)).toBeCloseTo(3.1);
        expect(clampAngle(-3.1, 2.8, 3.4)).toBeCloseTo(-3.1 + Math.PI * 2);
        expect(clampAngle(0, -1, 1)).toBe(0);
        expect(clampAngle(5, undefined, undefined)).toBe(5);
    });
});
