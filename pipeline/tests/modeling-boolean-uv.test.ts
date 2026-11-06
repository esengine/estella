// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Real holes and how a texture lands: volumes for the first, the numbers on the corners for the second. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { bakeModel, needsPreparing, prepareModeling, renderModelSheet, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';

beforeAll(() => prepareModeling());

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });

function volume(m: BakedModel): number {
    let v = 0;
    for (const { v: [a, b, c] } of m.triangles) {
        const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
        v += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return v / 6;
}

function sound(m: BakedModel): void {
    expect(m.report.openEdges).toBe(0);
    expect(m.report.nonManifoldEdges).toBe(0);
    expect(m.report.insideOutShells).toBe(0);
    expect(m.report.warnings).toEqual([]);
}

const wall: ModelStep = { op: 'box', size: [4, 3, 0.5], tag: 'wall', color: [1, 1, 1] };
const cutter: ModelStep = { op: 'box', size: [1, 1, 2], tag: 'cutter', color: [1, 0, 0] };

describe('boolean', () => {
    it('subtract goes all the way through: the volume drops by exactly the hole, and the cutter is gone', () => {
        const m = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall' });
        sound(m);
        expect(volume(m)).toBeCloseTo(6 - 0.5, 4);
        expect(m.report.shells).toBe(1);
        expect(m.report.bounds.size).toEqual([4, 3, 0.5]);
    });

    it('you can see through the hole, in the silhouette', () => {
        const m = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall' });
        const s = renderModelSheet(m, ['front'], 128);
        const px = (x: number, y: number): number => s.rgba[(y * s.width + x) * 4]!;
        expect(px(64, 129 + 64)).toBeGreaterThan(200); // through the middle
        expect(px(64 + 30, 129 + 64)).toBeLessThan(60); // wall beside it
    });

    it('`from` defaults to everything else', () => {
        const m = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter' });
        expect(volume(m)).toBeCloseTo(5.5, 4);
    });

    it('union of overlapping solids counts the overlap once, with no wall left inside', () => {
        const m = model({ op: 'box', size: 2, tag: 'a' }, { op: 'box', size: 2, at: [1, 0, 0], tag: 'b' }, { op: 'boolean', operation: 'union', with: 'b', from: 'a' });
        sound(m);
        expect(m.report.shells).toBe(1);
        expect(volume(m)).toBeCloseTo(12, 4);
    });

    it('intersect keeps what both hold', () => {
        const m = model({ op: 'box', size: 2, tag: 'a' }, { op: 'box', size: 2, at: [1, 0, 0], tag: 'b' }, { op: 'boolean', operation: 'intersect', with: 'b', from: 'a' });
        sound(m);
        expect(volume(m)).toBeCloseTo(4, 4);
    });

    it('a cut face keeps what it had: the wall its tag and colour, and the walls of the hole the cutter\'s or those named', () => {
        const plain = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall' });
        expect(plain.report.tags.cutter).toBeGreaterThan(0);
        expect(plain.report.tags.wall).toBeGreaterThan(0);
        const named = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall', tag: 'reveal', color: [0, 1, 0] });
        expect(named.report.tags.cutter).toBeUndefined();
        const reveal = named.poly.faces.filter((f) => f.tag === 'reveal');
        expect(reveal.length).toBeGreaterThan(0);
        expect(reveal.every((f) => f.color![1] === 1 && f.color![0] === 0)).toBe(true);
        expect(named.poly.faces.filter((f) => f.tag === 'wall').every((f) => f.color![0] === 1)).toBe(true);
    });

    it('leaves other shells alone, and keep leaves the cutter standing', () => {
        const other: ModelStep = { op: 'box', size: 1, at: [9, 0, 0], tag: 'other' };
        const m = model(wall, cutter, other, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall' });
        expect(m.report.tags.other).toBe(6);
        const kept = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall', keep: true });
        expect(volume(kept)).toBeCloseTo(5.5 + 2, 4);
    });

    it('later steps can work on the result', () => {
        const m = model(wall, cutter, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall', tag: 'reveal' }, { op: 'paint', faces: 'reveal', color: [0, 0, 1] }, { op: 'extrude', faces: { tag: 'wall', facing: '+z' }, distance: 0.1 });
        sound(m);
    });

    it('cuts through an organic skin too, and a concave prism', () => {
        const blob = model({ op: 'organic', resolution: 48, tag: 'blob', parts: [{ shape: 'sphere', radius: 1 }] }, { op: 'box', size: [0.5, 3, 0.5], tag: 'cutter' }, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'blob' });
        expect(blob.report.openEdges).toBe(0);
        expect(volume(blob)).toBeLessThan((4 / 3) * Math.PI - 0.4);
        const prism = model({ op: 'prism', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], height: 1, tag: 'l' }, { op: 'box', size: [0.4, 3, 0.4], at: [0.5, 0, 0.5], tag: 'cutter' }, { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'l' });
        sound(prism);
        expect(volume(prism)).toBeCloseTo(3 - 0.16, 3);
    });

    it('refuses what it cannot cut, saying why', () => {
        expect(() => model(wall, { op: 'boolean', operation: 'subtract', with: 'nope' })).toThrow(/`with` "nope" matched no face/);
        expect(() => model(cutter, { op: 'boolean', operation: 'subtract', with: 'cutter' })).toThrow(/leaves no face/);
        expect(() => model(wall, cutter, { op: 'delete', faces: { tag: 'cutter', facing: '+y' } }, { op: 'boolean', operation: 'subtract', with: 'cutter' })).toThrow(/`with` are not a closed solid.*open edge/);
        expect(() => model(wall, { op: 'box', size: 1, at: [9, 9, 9], tag: 'cutter' }, { op: 'boolean', operation: 'intersect', with: 'cutter', from: 'wall' })).toThrow(/leaves nothing/);
        expect(() => validateModelSource({ steps: [{ op: 'boolean', operation: 'carve', with: 'x' }] })).toThrow(/operation must be subtract, union or intersect/);
    });

    it('says which sources need loading first', () => {
        expect(needsPreparing([{ op: 'box' }])).toBe(false);
        expect(needsPreparing([{ op: 'box' }, { op: 'boolean' }])).toBe(true);
    });
});

describe('uv', () => {
    /** Every corner's position and base UV, from the baked vertices. */
    function corners(m: BakedModel): { p: number[]; n: number[]; uv: number[] }[] {
        const off = (s: number): number => m.data.channels.find((c) => c.semantic === s)!.offset;
        const view = new DataView(m.data.vertices.buffer);
        return Array.from({ length: m.data.vertexCount }, (_, i) => {
            const at = i * m.data.vertexStride;
            return {
                p: [0, 1, 2].map((k) => view.getFloat32(at + off(MeshChannel.Position) + k * 4, true)),
                n: [0, 1, 2].map((k) => view.getFloat32(at + off(MeshChannel.Normal) + k * 4, true)),
                uv: [0, 1].map((k) => view.getFloat32(at + off(MeshChannel.TexCoord0) + k * 4, true)),
            };
        });
    }
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

    it('by default tiles at uvScale world units a repeat, on every side alike', () => {
        const m = bakeModel({ version: 1, uvScale: 0.5, steps: [{ op: 'box', size: [4, 2, 1] }] });
        const front = corners(m).filter((c) => c.n[2]! > 0.9);
        expect(spread(front.map((c) => c.uv[0]!))).toBeCloseTo(8, 4); // 4 units at 0.5 a repeat
        expect(spread(front.map((c) => c.uv[1]!))).toBeCloseTo(4, 4);
    });

    it('up on a wall is up in the texture, on all four walls', () => {
        const m = model({ op: 'box', size: 2 });
        for (const c of corners(m).filter((x) => Math.abs(x.n[1]!) < 0.1)) expect(c.uv[1]).toBeCloseTo(c.p[1]!, 4);
    });

    it('reads left to right when you face it: a texture is not mirrored', () => {
        const m = model({ op: 'box', size: 2 });
        const facing = (axis: number, sign: number, right: number, rightSign: number): void => {
            const face = corners(m).filter((c) => c.n[axis]! * sign > 0.9);
            const a = face.find((c) => c.p[right]! * rightSign > 0)!, b = face.find((c) => c.p[right]! * rightSign < 0)!;
            expect(a.uv[0]!).toBeGreaterThan(b.uv[0]!);
        };
        facing(2, 1, 0, 1); // front: +x is on the right
        facing(2, -1, 0, -1); // back: -x is
        facing(0, 1, 2, -1); // right side: -z is
        facing(0, -1, 2, 1); // left side: +z is
    });

    it('planar aims faces, and takes scale, offset and rotate', () => {
        const m = model({ op: 'box', size: 2 }, { op: 'uv', faces: '+z', mode: 'planar', axis: '+z', scale: 2, offset: [0.25, 0.5] });
        const front = corners(m).filter((c) => c.n[2]! > 0.9);
        expect(spread(front.map((c) => c.uv[0]!))).toBeCloseTo(1, 4);
        expect(Math.min(...front.map((c) => c.uv[0]!))).toBeCloseTo(-0.25, 4);
        const turned = model({ op: 'box', size: 2 }, { op: 'uv', faces: '+z', mode: 'planar', axis: '+z', rotate: 90 });
        const f = corners(turned).filter((c) => c.n[2]! > 0.9);
        for (const c of f) expect(c.uv[0]).toBeCloseTo(-c.p[1]!, 4);
    });

    it('cylinder wraps a pole once around, with no face painted backwards across the seam', () => {
        const m = model({ op: 'cylinder', radius: 1, height: 4, sides: 16, tag: 'pole' }, { op: 'uv', faces: { tag: 'pole', not: { any: ['+y', '-y'] } }, mode: 'cylinder', axis: 'y', repeat: [2, 3] });
        const side = corners(m).filter((c) => Math.abs(c.n[1]!) < 0.1);
        expect(spread(side.map((c) => c.uv[1]!))).toBeCloseTo(3, 3);
        expect(spread(side.map((c) => c.uv[0]!))).toBeGreaterThan(1.9);
        // Each triangle spans a sixteenth of the way round, twice over for the repeat: a seam crossed wrongly would span nearly all of it.
        const view = m.data.indices;
        const all = corners(m);
        for (let i = 0; i < view.length; i += 3) {
            const tri = [all[view[i]!]!, all[view[i + 1]!]!, all[view[i + 2]!]!];
            if (tri.some((c) => Math.abs(c.n[1]!) > 0.1)) continue;
            expect(spread(tri.map((c) => c.uv[0]!))).toBeLessThan(0.3);
        }
    });

    it('sphere maps pole to pole', () => {
        const m = model({ op: 'sphere', radius: 1 }, { op: 'uv', mode: 'sphere' });
        const v = corners(m).map((c) => c.uv[1]!);
        expect(Math.min(...v)).toBeCloseTo(0, 3);
        expect(Math.max(...v)).toBeCloseTo(1, 3);
    });

    it('uvAtlas: no two triangles share texels, and all of them are on the sheet', () => {
        const m = bakeModel({ version: 1, uvAtlas: true, steps: [{ op: 'box', size: 2 }] });
        const all = corners(m);
        for (const c of all) {
            expect(c.uv[0]).toBeGreaterThanOrEqual(0);
            expect(c.uv[0]).toBeLessThanOrEqual(1);
        }
        // Six faces, six separate rectangles: the UV bounding boxes do not overlap.
        const byFace = new Map<string, number[][]>();
        for (const c of all) {
            const key = c.n.map((x) => Math.round(x)).join();
            byFace.set(key, [...(byFace.get(key) ?? []), c.uv]);
        }
        const boxes = [...byFace.values()].map((uvs) => ({
            minU: Math.min(...uvs.map((u) => u[0]!)), maxU: Math.max(...uvs.map((u) => u[0]!)),
            minV: Math.min(...uvs.map((u) => u[1]!)), maxV: Math.max(...uvs.map((u) => u[1]!)),
        }));
        expect(boxes.length).toBe(6);
        for (let i = 0; i < 6; i++) {
            for (let j = i + 1; j < 6; j++) {
                const [a, b] = [boxes[i]!, boxes[j]!];
                const apart = a.maxU <= b.minU || b.maxU <= a.minU || a.maxV <= b.minV || b.maxV <= a.minV;
                expect(apart, `faces ${i} and ${j} overlap on the sheet`).toBe(true);
            }
        }
    });

    it('refuses an axis that is not one, and a mode that is not one', () => {
        expect(() => model({ op: 'box', size: 1 }, { op: 'uv', mode: 'planar', axis: 'up' })).toThrow(/planar uv's axis "up"/);
        expect(() => model({ op: 'box', size: 1 }, { op: 'uv', mode: 'cylinder', axis: '+y' })).toThrow(/cylinder uv's axis/);
        expect(() => validateModelSource({ steps: [{ op: 'uv', mode: 'wrap' }] })).toThrow(/mode must be box, planar/);
    });
});
