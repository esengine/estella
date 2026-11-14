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
        // The wood reads one point of the picture: its solid corner.
        expect(tagged(m, 'bark').every((f) => f.cornerUvs?.every((uv) => uv[0] < 0.05 && uv[1] < 0.05))).toBe(true);
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
        // Drawn with the near trees' cut-out material, a far tree must not have holes: every face reads the solid corner.
        expect(far.poly.faces.every((f) => f.cornerUvs?.every((uv) => uv[0] < 0.05))).toBe(true);
    });

    it('grows every shape, solid crowns when asked, and refuses what it does not know', () => {
        for (const shape of TREE_SHAPES) expect(grow({ shape, detail: 1 }).report.triangles, shape).toBeGreaterThan(40);
        expect(grow({ leaves: 'solid' }).leaves).toBeUndefined();
        expect(() => grow({ shape: 'palm' })).toThrow(/round, tall, flat, bush, cone/);
        expect(() => grow({ detail: 3 })).toThrow(/detail/);
        expect(() => grow({ height: 0 })).toThrow(/height/);
    });

    it('draws a sprig with clear between its leaves and solid corners for the wood', () => {
        const size = 256, p = treeLeafPicture(size), alpha = (x: number, y: number) => p[(y * size + x) * 4 + 3]!;
        expect(alpha(1, 1)).toBe(255);
        expect(alpha(size - 2, size - 2)).toBe(255);
        let clear = 0, solid = 0;
        for (let y = 32; y < size - 32; y++) for (let x = 32; x < size - 32; x++) { if (alpha(x, y) === 0) clear++; else if (alpha(x, y) > 200) solid++; }
        // A card shows the picture a tenth in from every edge: a leaf past that is a leaf cut by a straight line.
        const edge = Math.floor(size * 0.1) - 1, corner = Math.ceil(size * 0.07);
        for (let i = corner; i < size - corner; i++) for (let k = 0; k < edge; k++) {
            expect(alpha(i, k) + alpha(i, size - 1 - k) + alpha(k, i) + alpha(size - 1 - k, i)).toBe(0);
        }
        expect(clear).toBeGreaterThan(192 * 192 * 0.3);
        expect(solid).toBeGreaterThan(192 * 192 * 0.2);
    });
});
