// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { bakeModel, type BakedModel, type ModelStep } from '../src/modeling';

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });
const deck: ModelStep = { op: 'plane', size: [8, 4], color: [0.5, 0.5, 0.5], tag: 'deck' };
const plates = (m: BakedModel): number => m.report.tags.plate ?? 0;
const top = (m: BakedModel): number => m.report.bounds.max[1];

describe('panels', () => {
    it('cuts a face into plates, more of them as `size` shrinks', () => {
        const coarse = model(deck, { op: 'panels', faces: 'deck', size: 3, tag: 'plate' });
        const fine = model(deck, { op: 'panels', faces: 'deck', size: 1, tag: 'plate' });
        expect(plates(coarse)).toBeGreaterThan(1);
        expect(plates(fine)).toBeGreaterThan(plates(coarse) * 3);
    });

    it('stands each plate `height` out, leaves the seams where the face was and tags them as it was', () => {
        const m = model(deck, { op: 'panels', faces: 'deck', size: 2, gap: 0.1, height: 0.25, tag: 'plate' });
        expect(top(m)).toBeCloseTo(0.25, 5);
        expect(m.report.bounds.min[1]).toBeCloseTo(0, 5);
        expect(m.report.tags.deck).toBeGreaterThan(0);
        expect(m.report.tags.plateSide).toBeGreaterThan(0);
        expect(m.report.bounds.size[0]).toBeCloseTo(8, 5);
    });

    it('sinks plates with a negative height, and varies them between two', () => {
        const sunk = model(deck, { op: 'panels', faces: 'deck', size: 2, height: -0.2, tag: 'plate' });
        expect(sunk.report.bounds.min[1]).toBeCloseTo(-0.2, 5);
        const varied = model(deck, { op: 'panels', faces: 'deck', size: 1, height: [0.1, 0.3], tag: 'plate' });
        const tops = new Set(varied.poly.faces.filter((f) => f.tag === 'plate').map((f) => varied.poly.positions[f.v[0]!]![1].toFixed(3)));
        expect(tops.size).toBeGreaterThan(3);
        for (const y of tops) { expect(Number(y)).toBeGreaterThanOrEqual(0.1); expect(Number(y)).toBeLessThanOrEqual(0.3); }
    });

    it('a `bevel` puts a slope between a plate and its side', () => {
        const square = model(deck, { op: 'panels', faces: 'deck', size: 2, gap: 0.1, height: 0.2, tag: 'plate' });
        const eased = model(deck, { op: 'panels', faces: 'deck', size: 2, gap: 0.1, height: 0.2, bevel: 0.05, tag: 'plate' });
        expect(plates(eased)).toBe(plates(square));
        expect(eased.report.tags.plateSide).toBe(square.report.tags.plateSide! * 2);
    });

    it('`tones` gives the plates paint that differs, about what the face had', () => {
        const m = model(deck, { op: 'panels', faces: 'deck', size: 1, tones: 0.3, tag: 'plate' });
        const greys = m.poly.faces.filter((f) => f.tag === 'plate').map((f) => f.color![0]);
        expect(new Set(greys.map((g) => g.toFixed(3))).size).toBeGreaterThan(5);
        for (const g of greys) { expect(g).toBeGreaterThanOrEqual(0.5 * 0.7 - 1e-6); expect(g).toBeLessThanOrEqual(0.5 * 1.3 + 1e-6); }
    });

    it('is the same every time for a seed, and different for another', () => {
        const at = (seed: number): string => JSON.stringify(model(deck, { op: 'panels', faces: 'deck', size: 1.5, uneven: 0.9, seed, tag: 'plate' }).poly.positions);
        expect(at(4)).toBe(at(4));
        expect(at(4)).not.toBe(at(5));
    });

    it('covers the face it cut: the plates and seams have its area', () => {
        const m = model(deck, { op: 'panels', faces: 'deck', size: 1.5, uneven: 1, gap: 0.08, height: 0, tag: 'plate' });
        let area = 0;
        for (const { v: [a, b, c] } of m.triangles) {
            const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
            area += Math.abs((q[0] - p[0]) * (r[2] - p[2]) - (r[0] - p[0]) * (q[2] - p[2])) / 2;
        }
        expect(area).toBeCloseTo(32, 4);
    });

    it('refuses a size it cannot use and faces that are not there', () => {
        expect(() => model(deck, { op: 'panels', faces: 'deck', size: 0 })).toThrow(/size/);
        expect(() => model(deck, { op: 'panels', faces: 'hull', size: 1 })).toThrow(/matched no face/);
        expect(() => model(deck, { op: 'panels', faces: 'deck', size: 1, uneven: 2 })).toThrow(/uneven/);
    });
});
