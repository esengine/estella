// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The composite batch's plan: a part is placed in its ROOT's space (so the draws follow the root),
 * a mesh repeated often enough is one instanced set, the rest are merged in chunks of the root's
 * space, and an edit changes only the chunk it lands in.
 */
import { describe, it, expect } from 'vitest';
import {
    COMPOSITE_DEFAULTS, multiply, placementsOf, planComposite, rootLocalMatrix, sameMatrix, type CompositePart,
} from '../src/render/compositeBatch';
import { worldMatrix } from '../src/render/staticBatch';

const Q0 = { x: 0, y: 0, z: 0, w: 1 };
const ONE = { x: 1, y: 1, z: 1 };
const at = (x: number, y = 0, z = 0) => ({ position: { x, y, z }, rotation: Q0, scale: ONE });
const quarterTurnY = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

function part(entity: number, key: string, mesh: number, x: number, z = 0): CompositePart {
    const local = rootLocalMatrix([at(x, 0, z)]);
    return { entity, key, mesh, local, vertices: 24, center: [x, 0, z] };
}

describe('rootLocalMatrix', () => {
    it('composes the local transforms from under the root down to the part', () => {
        const m = rootLocalMatrix([{ position: { x: 10, y: 0, z: 0 }, rotation: quarterTurnY, scale: ONE }, at(0, 0, 5)]);
        // Five forward, turned a quarter about Y, lands five along +X from the parent at x = 10.
        expect(m[12]).toBeCloseTo(15);
        expect(m[13]).toBeCloseTo(0);
        expect(m[14]).toBeCloseTo(0);
    });

    it('does not depend on where the root is: the root is not in the chain', () => {
        const local = rootLocalMatrix([at(3, 1, 2)]);
        const rootA = worldMatrix({ x: 0, y: 0, z: 0 }, Q0, ONE);
        const rootB = worldMatrix({ x: 500, y: -20, z: 9 }, quarterTurnY, { x: 2, y: 2, z: 2 });
        // Drawn from an entity parented to the root, the part lands at root * local wherever the root is.
        const a = multiply(rootA, local), b = multiply(rootB, local);
        expect(a[12]).toBeCloseTo(3);
        expect(b[12]).toBeCloseTo(500 + 2 * 2);
        expect(b[14]).toBeCloseTo(9 - 2 * 3);
        expect(sameMatrix(local, rootLocalMatrix([at(3, 1, 2)]))).toBe(true);
    });
});

describe('planComposite', () => {
    const planks = Array.from({ length: 12 }, (_, i) => part(i + 1, 'wood', 7, i));
    const props = [part(100, 'wood', 21, 0.5), part(101, 'wood', 22, 1.5), part(102, 'wood', 23, 2.5)];

    it('draws a repeated mesh as one instanced set, and merges the parts that are each different', () => {
        const plan = planComposite([...planks, ...props], { ...COMPOSITE_DEFAULTS, cellSize: 100 });
        expect(plan.sets).toEqual([{ key: 'wood', mesh: 7, entities: planks.map((p) => p.entity) }]);
        expect(plan.chunks).toHaveLength(1);
        expect(plan.chunks[0]!.entities).toEqual([100, 101, 102]);
        expect(plan.alone).toEqual([]);
    });

    it('leaves a part that nothing shares a draw with to draw itself', () => {
        const plan = planComposite([...props, part(200, 'metal', 30, 1)], { ...COMPOSITE_DEFAULTS, cellSize: 100 });
        expect(plan.alone).toEqual([200]);
    });

    it('merges a mesh that repeats fewer times than instanceMin, and instances it past', () => {
        const three = planks.slice(0, 3);
        expect(planComposite(three, { ...COMPOSITE_DEFAULTS, instanceMin: 4, cellSize: 100 }).sets).toEqual([]);
        expect(planComposite(three, { ...COMPOSITE_DEFAULTS, instanceMin: 3, cellSize: 100 }).sets).toHaveLength(1);
    });

    it('re-merges only the chunk a new part lands in', () => {
        // Two chunks of props, one per cell of side 10 along X.
        const left = [part(300, 'wood', 40, 1), part(301, 'wood', 41, 2)];
        const right = [part(310, 'wood', 42, 21), part(311, 'wood', 43, 22)];
        const before = planComposite([...left, ...right], COMPOSITE_DEFAULTS, 10);
        const after = planComposite([...left, ...right, part(312, 'wood', 44, 23)], COMPOSITE_DEFAULTS, 10);
        const ids = (p: typeof before) => p.chunks.map((c) => c.id);
        const kept = ids(after).filter((id) => ids(before).includes(id));
        expect(kept).toEqual([before.chunks.find((c) => c.entities.includes(300))!.id]);
        expect(after.chunks.find((c) => c.entities.includes(312))!.entities).toEqual([310, 311, 312]);
    });

    it('chooses a chunk size from the model when none is given, and says what it chose', () => {
        const plan = planComposite([part(1, 'k', 1, 0), part(2, 'k', 2, 40)]);
        expect(plan.cellSize).toBeCloseTo(10);
    });
});

describe('placementsOf', () => {
    it('writes the three rows of each matrix with translation last, then an untinted colour', () => {
        const m = rootLocalMatrix([{ position: { x: 4, y: 5, z: 6 }, rotation: Q0, scale: { x: 2, y: 3, z: 1 } }]);
        const out = placementsOf([m]);
        expect(Array.from(out)).toEqual([2, 0, 0, 4, 0, 3, 0, 5, 0, 0, 1, 6, 1, 1, 1, 1]);
    });
});
