import { describe, it, expect } from 'vitest';
import { GlobalSdf, type SdfInstance } from '../src/gi/globalSdf';
import type { MeshSdf } from '../src/gi/meshSdfFormat';

/** A mesh field built from a closed-form distance, over [-half - pad, half + pad] in local units. */
function analytic(distance: (p: [number, number, number]) => number, half: number, cell: number, inflate = 0): MeshSdf {
    const pad = 2 * cell, n = Math.ceil((2 * half + 2 * pad) / cell);
    const origin: [number, number, number] = [-half - pad, -half - pad, -half - pad];
    const field = new Float32Array(n * n * n);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        field[x + y * n + z * n * n] = distance([origin[0] + (x + 0.5) * cell, origin[1] + (y + 0.5) * cell, origin[2] + (z + 0.5) * cell]) - inflate;
    }
    return { dims: [n, n, n], cell, origin, distance: field, inflate };
}
const sphereSdf = (r: number, cell: number) => analytic((p) => Math.hypot(...p) - r, r, cell);
const boxDistance = (p: number[], h: number[]) => {
    const q = p.map((v, k) => Math.abs(v) - h[k]!);
    return Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(...q), 0);
};
const matrix = (t: [number, number, number], s = 1): number[] => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t[0], t[1], t[2], 1];
const instance = (id: number, sdf: MeshSdf, t: [number, number, number], s = 1): SdfInstance => ({ id, sdf, worldFromLocal: matrix(t, s) });
const field = () => new GlobalSdf([{ dim: 64, cell: 0.25 }, { dim: 64, cell: 1 }]);

describe('the scene distance field', () => {
    it('reads a placed, scaled sphere as its closed-form distance', () => {
        const g = field();
        g.setCenter([5, 0, 0]);
        g.update(instance(1, sphereSdf(1, 0.1), [5, 0, 0], 2));  // radius 2 in the world
        for (const p of [[5, 0, 0], [6, 0.5, 0], [7.4, 0, 0], [5, 3, 0.5]] as const) {
            const truth = Math.hypot(p[0] - 5, p[1], p[2]) - 2;
            // A cell remembers a surface only to +-6 cells (1.5 here), the rest reads as that far.
            expect(Math.abs(g.sample(p)! - Math.min(Math.max(truth, -1.5), 1.5))).toBeLessThan(0.15);
        }
    });

    it('never reads further than the truth outside the box of an instance (a trace may step what it reads)', () => {
        const g = field();
        g.setCenter([5, 0, 0]);
        g.update(instance(1, sphereSdf(1, 0.1), [5, 0, 0], 2));
        for (const p of [[2.5, -1, 1], [8, 2, 2], [5, 4, 1]] as const) expect(g.sample(p)!).toBeLessThanOrEqual(Math.hypot(p[0] - 5, p[1], p[2]) - 2 + 0.15);
    });

    it('traces a ray to the sphere it hits, and past one it misses', () => {
        const g = field();
        g.setCenter([0, 0, 0]);
        g.update(instance(1, sphereSdf(1, 0.1), [0, 0, 6]));
        const hit = g.sphereTrace([0, 0, 0], [0, 0, 1], 20)!;
        expect(Math.abs(hit - 5)).toBeLessThan(0.2);
        expect(g.sphereTrace([0, 3, 0], [0, 0, 1], 20)).toBeNull();
    });

    it('treats a wall thinner than a cell as a wall: a ray across it is blocked, the room beside it is not', () => {
        const cell = 0.2, halfs = [3, 2, 0.05];
        const wall = analytic((p) => boxDistance(p, halfs), 3, cell, 0.5 * cell);  // a 0.1 thick wall, grown by half a cell as the baker does
        const g = field();
        g.setCenter([0, 0, 0]);
        g.update(instance(1, wall, [0, 0, 0]));
        expect(g.occluded([0, 0, -1], [0, 0, 1])).toBe(true);
        expect(g.occluded([0, 0, 1], [0, 0, 3])).toBe(false);
        expect(g.occluded([4.5, 0, -1], [4.5, 0, 1])).toBe(false);  // round the end of it
    });

    it('forgets an instance that moved or was removed', () => {
        const g = field();
        g.setCenter([0, 0, 0]);
        g.update(instance(1, sphereSdf(1, 0.1), [0, 0, 5]));
        expect(g.sphereTrace([0, 0, 0], [0, 0, 1], 20)).not.toBeNull();
        g.update(instance(1, sphereSdf(1, 0.1), [0, 6, 5]));
        expect(g.sphereTrace([0, 0, 0], [0, 0, 1], 20)).toBeNull();
        expect(g.sphereTrace([0, 0, 0], [0, 1, 0.8], 20)).not.toBeNull();
        g.remove(1);
        expect(g.sphereTrace([0, 0, 0], [0, 1, 0.8], 20)).toBeNull();
    });

    it('rebuilds only what came into view when the window moves, and agrees with a field built there', () => {
        const stepped = field();
        stepped.setCenter([0, 0, 0]);
        stepped.update(instance(1, sphereSdf(1, 0.1), [3, 0, 0]));
        stepped.update(instance(2, sphereSdf(1, 0.1), [12, 1, 0]));
        for (const c of [[2, 0, 0], [9, 0, 0], [9, 3, 1], [-4, 0, 0]] as const) stepped.setCenter([...c]);
        const fresh = field();
        fresh.setCenter([-4, 0, 0]);
        fresh.update(instance(1, sphereSdf(1, 0.1), [3, 0, 0]));
        fresh.update(instance(2, sphereSdf(1, 0.1), [12, 1, 0]));
        for (const p of [[0, 0, 0], [3, 0.5, 0], [-10, 2, 3], [8, 1, 0]] as const) {
            const a = stepped.sample(p), b = fresh.sample(p);
            expect(a).not.toBeNull();
            expect(Math.abs(a! - b!)).toBeLessThan(1e-4);
        }
    });

    it('falls back to a coarser level where the finer window ends', () => {
        const g = field();  // fine window is 16 across, coarse 64
        g.setCenter([0, 0, 0]);
        g.update(instance(1, sphereSdf(1, 0.1), [30, 0, 0]));
        expect(g.sphereTrace([0, 0, 0], [1, 0, 0], 60)).not.toBeNull();
        expect(g.levelAt([40, 0, 0])).toBeNull();
        expect(g.levelAt([10, 0, 0])).toBe(g.levels[1]);
    });

    it('refuses a level whose size is not a power of two', () => {
        expect(() => new GlobalSdf([{ dim: 48, cell: 1 }])).toThrow();
    });
});
