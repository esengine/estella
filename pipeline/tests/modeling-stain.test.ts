// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Colour laid over a surface by what is there, and that colour carried onto a thin mesh by the bake. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { applyModelEdits, bakeModel, bakeNormalMap, prepareModeling, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';

beforeAll(() => prepareModeling());

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });
const ball: ModelStep = { id: 'form', op: 'sphere', radius: 1, rings: 32, sides: 64, color: [1, 1, 1], tag: 'ball' };
const sheet: ModelStep = { op: 'plane', size: 2, color: [1, 1, 1], tag: 'sheet' };
const RED = [1, 0, 0];

const centre = (m: BakedModel, f: number): number[] => {
    const v = m.poly.faces[f]!.v;
    return [0, 1, 2].map((k) => v.reduce((sum, i) => sum + m.poly.positions[i]![k]!, 0) / v.length);
};
const redness = (m: BakedModel, f: number): number => 1 - (m.poly.faces[f]!.color?.[1] ?? 1);

describe('stain', () => {
    it('`near` with `hard` is a clean disc: all colour inside, none out', () => {
        const m = model(sheet, { op: 'stain', near: { at: [0, 0, 0], radius: 0.3 }, hard: true, color: RED });
        let inside = 0, outside = 0;
        m.poly.faces.forEach((_, f) => {
            const [x, , z] = centre(m, f);
            const d = Math.hypot(x!, z!);
            if (d < 0.25) { expect(redness(m, f)).toBe(1); inside++; }
            if (d > 0.45) { expect(redness(m, f)).toBe(0); outside++; }
        });
        expect(inside).toBeGreaterThan(10);
        expect(outside).toBeGreaterThan(0);
    });

    it('`near` without `hard` fades toward its edge', () => {
        const m = model(sheet, { op: 'stain', near: { at: [0, 0, 0], radius: 0.8 }, color: RED, detail: 0.05 });
        const byRing = (lo: number, hi: number): number => {
            const hits = m.poly.faces.map((_, f) => f).filter((f) => { const [x, , z] = centre(m, f); const d = Math.hypot(x!, z!); return d >= lo && d < hi; });
            return hits.reduce((sum, f) => sum + redness(m, f), 0) / hits.length;
        };
        expect(byRing(0, 0.1)).toBeGreaterThan(0.9);
        expect(byRing(0.35, 0.45)).toBeGreaterThan(0.2);
        expect(byRing(0.35, 0.45)).toBeLessThan(0.8);
        expect(byRing(0.9, 1.5)).toBe(0);
    });

    it('`facing` takes what looks that way', () => {
        const m = model(ball, { op: 'stain', facing: [0, 1, 0], color: RED });
        m.poly.faces.forEach((_, f) => {
            const y = centre(m, f)[1]!;
            if (y > 0.85) expect(redness(m, f)).toBeGreaterThan(0.9);
            if (y < 0) expect(redness(m, f)).toBe(0);
        });
    });

    it('`where: cavity` finds the groove and `where: edges` the ridge', () => {
        // One straight groove across a sheet, and a ridge further along.
        const shaped: ModelStep[] = [
            { op: 'plane', size: 4, color: [1, 1, 1] }, { op: 'slice', axis: 'x', at: Array.from({ length: 79 }, (_, i) => -1.95 + i * 0.05) },
            { op: 'slice', axis: 'z', at: Array.from({ length: 79 }, (_, i) => -1.95 + i * 0.05) }, { op: 'weld' },
            { op: 'transform', faces: { within: { min: [-1.2, null, null], max: [-0.8, null, null] } }, translate: [0, -0.2, 0] },
            { op: 'transform', faces: { within: { min: [0.8, null, null], max: [1.2, null, null] } }, translate: [0, 0.2, 0] },
        ];
        const dirt = model(...shaped, { op: 'stain', where: 'cavity', reach: 0.4, color: RED });
        const wear = model(...shaped, { op: 'stain', where: 'edges', reach: 0.4, color: RED });
        const mean = (m: BakedModel, lo: number, hi: number): number => {
            const hits = m.poly.faces.map((_, f) => f).filter((f) => { const c = centre(m, f); return c[0]! > lo && c[0]! < hi && Math.abs(c[2]!) < 1; });
            return hits.reduce((sum, f) => sum + redness(m, f), 0) / hits.length;
        };
        expect(mean(dirt, -1.1, -0.9)).toBeGreaterThan(0.5);
        expect(mean(dirt, 0.9, 1.1)).toBeLessThan(0.1);
        expect(mean(wear, 0.9, 1.1)).toBeGreaterThan(0.5);
        expect(mean(wear, -1.1, -0.9)).toBeLessThan(0.1);
    }, 60000);

    it('a pattern takes the share `threshold` says', () => {
        const share = (threshold: number): number => {
            const m = model(sheet, { op: 'stain', pattern: 'bumps', scale: 0.3, threshold, softness: 0.02, color: RED, detail: 0.03 });
            return m.poly.faces.reduce((sum, _, f) => sum + (redness(m, f) > 0.5 ? 1 : 0), 0) / m.poly.faces.length;
        };
        expect(share(0.3)).toBeGreaterThan(share(0.5));
        expect(share(0.5)).toBeGreaterThan(share(0.7));
    });

    it('`amount` stops part of the way, and goes over what is there', () => {
        const m = model({ ...sheet, color: [0, 0, 1] }, { op: 'stain', near: { at: [0, 0, 0], radius: 10 }, hard: true, amount: 0.5, color: RED, detail: 2 });
        for (const f of m.poly.faces) expect(f.color).toEqual([0.5, 0, 0.5, 1]);
    });

    it('`faces` keeps it off the others, and `mirror` puts a spot on both sides', () => {
        const off = model(ball, { op: 'sphere', radius: 0.2, at: [3, 0, 0], tag: 'eye', color: [0, 1, 0] }, { op: 'stain', faces: 'eye', near: { at: [3, 0, 0], radius: 1 }, hard: true, color: RED });
        for (const f of off.poly.faces) if (f.tag === 'ball') expect(f.color).toEqual([1, 1, 1, 1]);
        const both = model(sheet, { op: 'stain', near: { at: [0.5, 0, 0], radius: 0.2 }, hard: true, mirror: 'x', color: RED });
        const sides = [1, -1].map((side) => both.poly.faces.filter((_, f) => redness(both, f) > 0.5 && Math.sign(centre(both, f)[0]!) === side).length);
        expect(sides[0]).toBeGreaterThan(5);
        expect(sides[1]).toBe(sides[0]);
    });

    it('moves nothing: it is colour, and the shape stays as it was', () => {
        const a = model(ball);
        const b = model(ball, { op: 'stain', facing: [0, 1, 0], color: RED });
        expect(b.poly.positions).toEqual(a.poly.positions);
    });

    it('refuses what cannot be meant', () => {
        expect(() => model(ball, { op: 'stain', color: RED })).toThrow(/say where/);
        expect(() => model(ball, { op: 'stain', color: RED, pattern: 'bumps' })).toThrow(/positive `scale`/);
        expect(() => model(ball, { op: 'stain', color: RED, facing: [0, 1, 0], amount: 2 })).toThrow(/amount/);
        expect(() => validateModelSource({ steps: [ball, { op: 'stain', color: RED, where: 'moss' }] })).toThrow(/must be cavity or edges/);
        expect(() => model(ball, { op: 'stain', color: RED, near: { at: [9, 9, 9], radius: 1 } })).toThrow(/no surface/);
    });
});

describe('normalBake color', () => {
    const SIZE = 128;
    /** The colour map at a point of a triangle of the mesh. */
    function read(m: BakedModel, rgba: Uint8Array, triangle: number, w: readonly number[]): number[] {
        const { data } = m;
        const { offset } = data.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!;
        const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
        let [u, v] = [0, 0];
        for (let k = 0; k < 3; k++) {
            const at = data.indices[triangle * 3 + k]! * data.vertexStride + offset;
            u += view.getFloat32(at, true) * w[k]!;
            v += view.getFloat32(at + 4, true) * w[k]!;
        }
        const x = Math.min(SIZE - 1, Math.floor(u * SIZE)), y = Math.min(SIZE - 1, Math.floor((1 - v) * SIZE));
        return [...rgba.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];
    }
    const positionsOf = (m: BakedModel, triangle: number, w: readonly number[]): number[] => {
        const { data } = m;
        const { offset } = data.channels.find((c) => c.semantic === MeshChannel.Position)!;
        const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
        return [0, 1, 2].map((a) => [0, 1, 2].reduce((sum, k) => sum + view.getFloat32(data.indices[triangle * 3 + k]! * data.vertexStride + offset + a * 4, true) * w[k]!, 0));
    };
    const allWhite = (m: BakedModel): boolean => {
        const { data } = m;
        const { offset } = data.channels.find((c) => c.semantic === MeshChannel.Color)!;
        for (let v = 0; v < data.vertexCount; v++) for (let k = 0; k < 4; k++) if (data.vertices[v * data.vertexStride + offset + k] !== 255) return false;
        return true;
    };

    it('finer paint than the mesh has triangles lands where it was: upper half red, lower half blue, on 200 triangles', () => {
        const m = bakeModel({ version: 1, normalBake: { size: SIZE, color: true }, steps: [
            { ...ball, color: [0, 0, 1], rings: 64, sides: 128 }, { op: 'stain', facing: [0, 1, 0], color: RED, faces: { within: { min: [null, 0, null] } }, threshold: 0.1 },
            { op: 'decimate', from: 'form', triangles: 200, error: 0.5 },
        ] });
        const map = bakeNormalMap(m);
        expect(map.colorRgba).toBeDefined();
        const seen = { red: 0, blue: 0 };
        for (let t = 0; t < m.data.indices.length / 3; t++) {
            const middle = [1 / 3, 1 / 3, 1 / 3];
            const y = positionsOf(m, t, middle)[1]!;
            if (y > 0.75) { expect(read(m, map.colorRgba!, t, middle)[0]).toBeGreaterThan(200); expect(read(m, map.colorRgba!, t, middle)[2]).toBeLessThan(60); seen.red++; }
            if (y < -0.2) { expect(read(m, map.colorRgba!, t, middle)[2]).toBeGreaterThan(200); expect(read(m, map.colorRgba!, t, middle)[0]).toBeLessThan(10); seen.blue++; }
        }
        expect(seen.red).toBeGreaterThan(3);
        expect(seen.blue).toBeGreaterThan(3);
    }, 60000);

    it('holds a colour as the same number a vertex colour would be: linear, not encoded', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 64, color: true, from: 'high' }, steps: [{ id: 'high', op: 'box', size: 2, color: [0.25, 0.5, 0.75] }] });
        const map = bakeNormalMap(m);
        expect(read2(m, map.colorRgba!, 64)).toEqual([Math.round(0.25 * 255), Math.round(0.5 * 255), Math.round(0.75 * 255), 255]);
    });
    function read2(m: BakedModel, rgba: Uint8Array, size: number): number[] {
        const { offset } = m.data.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!;
        const view = new DataView(m.data.vertices.buffer, m.data.vertices.byteOffset, m.data.vertices.byteLength);
        const [a, b, c] = [m.data.indices[0]!, m.data.indices[1]!, m.data.indices[2]!];
        const uv = [a, b, c].map((i) => [view.getFloat32(i * m.data.vertexStride + offset, true), view.getFloat32(i * m.data.vertexStride + offset + 4, true)]);
        const [u, v] = [(uv[0]![0]! + uv[1]![0]! + uv[2]![0]!) / 3, (uv[0]![1]! + uv[1]![1]! + uv[2]![1]!) / 3];
        const at = (Math.floor((1 - v) * size) * size + Math.floor(u * size)) * 4;
        return [...rgba.subarray(at, at + 4)];
    }

    it('turns the mesh\'s own colours white, or they would multiply in twice; without `color` they stay', () => {
        const steps: ModelStep[] = [{ ...ball, color: [0.2, 0.4, 0.6] }, { op: 'decimate', ratio: 0.5, error: 0.2 }];
        const colored = bakeModel({ version: 1, normalBake: { size: 64, color: true }, steps });
        expect(allWhite(colored)).toBe(true);
        const plain = bakeModel({ version: 1, normalBake: { size: 64 }, steps });
        expect(allWhite(plain)).toBe(false);
        expect(bakeNormalMap(plain).colorRgba).toBeUndefined();
    });

    it('where it finds no surface it falls back on what the mesh was painted, not on nothing', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 64, color: true, from: 'away', distance: 0.1 }, steps: [
            { op: 'plane', size: 4, at: [0, 5, 0], color: [1, 0, 0] }, { id: 'away', op: 'transform', scale: 1 }, { op: 'delete', faces: 'all' }, { op: 'plane', size: 1, color: [0, 1, 0] },
        ] });
        const map = bakeNormalMap(m);
        expect(map.report.missed).toBe(1);
        expect(read2(m, map.colorRgba!, 64)).toEqual([0, 255, 0, 255]);
    });

    it('works on a rigged mesh', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 64, color: true }, rig: { joints: [{ name: 'root', at: [0, -1, 0] }, { name: 'top', at: [0, 1, 0], parent: 'root' }] }, steps: [{ ...ball, color: [0.5, 0.2, 0.1] }, { op: 'decimate', ratio: 0.3, error: 0.2 }] });
        expect(allWhite(m)).toBe(true);
        expect(read2(m, bakeNormalMap(m).colorRgba!, 64).slice(0, 3)).toEqual([Math.round(0.5 * 255), Math.round(0.2 * 255), Math.round(0.1 * 255)]);
    });

    it('`color` must be true or false, and an edit can take it away', () => {
        expect(() => validateModelSource({ steps: [ball, { op: 'decimate', ratio: 0.5 }], normalBake: { color: 'yes' } })).toThrow(/color must be true or false/);
        const source = validateModelSource({ steps: [ball, { op: 'decimate', ratio: 0.5 }], normalBake: { color: true } });
        expect(applyModelEdits(source, [{ op: 'settings', fields: { normalBake: { size: 64 } } }]).normalBake?.color).toBeUndefined();
    });
});
