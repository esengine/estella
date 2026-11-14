// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The tree step: one step grows a whole tree, the same numbers the same tree, at three levels of detail.
 */
import { describe, expect, it } from 'vitest';
import { bakeModel, treeLeafPicture, TREE_SHAPES } from '../src/modeling';

const grow = (fields: Record<string, unknown>) => bakeModel({ version: 1, steps: [{ op: 'tree', height: 1000, seed: 4, ...fields }] });
const tagged = (m: ReturnType<typeof grow>, tag: string) => m.poly.faces.filter((f) => f.tag === tag);

describe('the tree step', () => {
    it('grows wood and a crown of leaf cards, standing on y 0 and as tall as asked', () => {
        const m = grow({});
        expect(tagged(m, 'bark').length).toBeGreaterThan(50);
        const leaves = tagged(m, 'leaf');
        // Cards: four corners each, mapped into the sprig, and the model says it has them.
        expect(leaves.length).toBeGreaterThan(60);
        expect(leaves.every((f) => f.v.length === 4 && f.cornerUvs?.length === 4)).toBe(true);
        expect(m.leaves).toBe(true);
        // The wood reads the bark along the picture's top (a v near 1: v runs up from the picture's foot), and not one place of it:
        // the grain runs along a limb and round it.
        const bark = tagged(m, 'bark').flatMap((f) => [...(f.cornerUvs ?? [])]);
        expect(bark.length).toBeGreaterThan(150);
        expect(bark.every((uv) => uv[0] > 0 && uv[0] < 0.68 && uv[1] > 0.8 && uv[1] < 1)).toBe(true);
        expect(Math.max(...bark.map((uv) => uv[0])) - Math.min(...bark.map((uv) => uv[0]))).toBeGreaterThan(0.5);
        expect(Math.max(...bark.map((uv) => uv[1])) - Math.min(...bark.map((uv) => uv[1]))).toBeGreaterThan(0.08);
        // A card shows the square under it, and nothing of the bark.
        expect(leaves.every((f) => f.cornerUvs!.every((uv) => uv[1] < 0.79 && uv[1] > 0.05 && uv[0] > 0.1))).toBe(true);
        const { min, max } = m.report.bounds;
        expect(min[1]).toBeLessThan(0);
        expect(max[1]).toBeGreaterThan(800);
        expect(max[1]).toBeLessThan(1300);
    });

    it('is the same tree for the same numbers, and another for another seed', () => {
        expect(grow({}).poly.positions).toEqual(grow({}).poly.positions);
        expect(grow({ seed: 5 }).poly.positions).not.toEqual(grow({}).poly.positions);
    });

    it('thins with detail: fewer cards at 1, and at 0 one solid body with no cards', () => {
        const full = grow({}), mid = grow({ detail: 1 }), far = grow({ detail: 0 });
        expect(tagged(mid, 'leaf').length).toBeLessThan(tagged(full, 'leaf').length);
        expect(far.leaves).toBeUndefined();
        expect(far.report.triangles).toBeLessThan(full.report.triangles);
        // Drawn with the near trees' cut-out material, a far tree must not have holes: every face reads what is solid, the
        // bark or the white beside it, both in the band along the picture's top.
        expect(far.poly.faces.every((f) => f.cornerUvs?.every((uv) => uv[1] > 0.8))).toBe(true);
        expect(tagged(far, 'leaf').every((f) => f.cornerUvs!.every((uv) => uv[0] > 0.72))).toBe(true);
        // Thinned, wood keeps each corner's own place in the bark, and a card its light.
        const thin = bakeModel({ version: 1, steps: [{ op: 'tree', height: 1000, seed: 4 }, { op: 'decimate', faces: 'bark', triangles: 120 }] });
        const kept = tagged(thin, 'bark');
        expect(kept.length).toBeLessThan(600);
        expect(kept.every((f) => f.cornerUvs?.length === 3 && f.cornerUvs.every((uv) => uv[0] < 0.68 && uv[1] > 0.8))).toBe(true);
        expect(kept.some((f) => f.cornerUvs![0]![0] !== f.cornerUvs![1]![0])).toBe(true);
        expect(tagged(thin, 'leaf').every((f) => f.cornerNormals?.length === 4)).toBe(true);
    });

    it('grows every shape, solid crowns when asked, and refuses what it does not know', () => {
        for (const shape of TREE_SHAPES) expect(grow({ shape, detail: 1 }).report.triangles, shape).toBeGreaterThan(40);
        expect(grow({ leaves: 'solid' }).leaves).toBeUndefined();
        expect(() => grow({ shape: 'palm' })).toThrow(/round, tall, flat, bush, cone/);
        expect(() => grow({ detail: 3 })).toThrow(/detail/);
        expect(() => grow({ height: 0 })).toThrow(/height/);
    });

    it('draws a tuft clear all round, with bark and solid white along the top of the picture', () => {
        const size = 256, p = treeLeafPicture(size), at = (x: number, y: number, k: number) => p[(y * size + x) * 4 + k]!;
        // The square a card shows: x 0.14..0.86, y 0.22..0.94. A leaf on its rim is a leaf cut by a straight line.
        const x0 = Math.round(size * 0.14), x1 = Math.round(size * 0.86), y0 = Math.round(size * 0.22), y1 = Math.round(size * 0.94);
        let clear = 0, solid = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (at(x, y, 3) === 0) clear++; else if (at(x, y, 3) > 200) solid++; }
        for (let i = 0; i < x1 - x0; i++) for (let k = 0; k < 4; k++) {
            expect(at(x0 + i, y0 + k, 3) + at(x0 + i, y1 - 1 - k, 3) + at(x0 + k, y0 + i, 3) + at(x1 - 1 - k, y0 + i, 3)).toBe(0);
        }
        expect(clear).toBeGreaterThan((x1 - x0) * (y1 - y0) * 0.3);
        expect(solid).toBeGreaterThan((x1 - x0) * (y1 - y0) * 0.25);
        // Nothing lies along the foot of the picture, which a card reading its lowest row would meet the top band through.
        for (let x = 0; x < size; x++) for (let y = y1 + 2; y < size; y++) expect(at(x, y, 3)).toBe(0);
        // The band along the top is solid everywhere a face reads it: bark, which has light and dark in it, and white.
        const tones = new Set<number>();
        for (let y = 2; y < size * 0.14 - 2; y++) for (let x = 2; x < size * 0.68 - 2; x++) { expect(at(x, y, 3)).toBe(255); tones.add(at(x, y, 0)); }
        expect(Math.max(...tones) - Math.min(...tones)).toBeGreaterThan(100);
        for (let y = 2; y < size * 0.14 - 2; y++) for (let x = Math.ceil(size * 0.72) + 2; x < size - 2; x++) expect(at(x, y, 0) + at(x, y, 3)).toBe(510);
        // A birch's bark is pale with dark marks; smooth bark is one tone.
        const tone = (bark: 'banded' | 'smooth') => { const q = treeLeafPicture(size, bark), all: number[] = []; for (let y = 2; y < 34; y++) for (let x = 2; x < 170; x++) all.push(q[(y * size + x) * 4]!); return all; };
        const banded = tone('banded'), smooth = tone('smooth');
        expect(banded.filter((g) => g > 220).length).toBeGreaterThan(banded.length * 0.7);
        expect(Math.min(...banded)).toBeLessThan(140);
        expect(new Set(smooth).size).toBe(1);
    });
});
