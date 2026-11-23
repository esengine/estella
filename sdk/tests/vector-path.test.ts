// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import {
    buildPathGeometry, circlePoints, cubicBezier, mergeGeometry, quadraticBezier, type PathStroke,
} from '../src/render/vectorPath';
import type { MeshRendererGeometry } from '../src/ecs/component';

const white = [1, 1, 1, 1] as const;
const P = (x: number, y: number) => ({ x, y });

/** Sum of the triangles' areas: equals the covered area exactly where nothing overlaps. */
function area(g: MeshRendererGeometry, onlyOpaque = false): number {
    let sum = 0;
    for (let t = 0; t < g.indices.length; t += 3) {
        const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
        if (onlyOpaque && [a, b, c].some((i) => (g.colors![i * 4 + 3] ?? 1) < 1)) continue;
        const ax = g.positions[a * 2]!, ay = g.positions[a * 2 + 1]!;
        const bx = g.positions[b * 2]!, by = g.positions[b * 2 + 1]!;
        const cx = g.positions[c * 2]!, cy = g.positions[c * 2 + 1]!;
        sum += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    }
    return sum;
}

function valid(g: MeshRendererGeometry): void {
    const n = g.positions.length / 2;
    expect(g.colors!.length).toBe(n * 4);
    expect(g.indices.length % 3).toBe(0);
    for (const i of g.indices) { expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(n); }
    for (const v of g.positions) expect(Number.isFinite(v)).toBe(true);
}

const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];

describe('path fill', () => {
    it('covers a convex polygon exactly, whichever way it winds', () => {
        const g = buildPathGeometry(square, { fill: { color: white } });
        valid(g);
        expect(area(g)).toBeCloseTo(100, 6);
        expect(area(buildPathGeometry([...square].reverse(), { fill: { color: white } }))).toBeCloseTo(100, 6);
    });

    it('covers a concave polygon without spilling into its notch', () => {
        // An L: 10x10 with the top-right 5x5 taken out.
        const L = [P(0, 0), P(10, 0), P(10, 5), P(5, 5), P(5, 10), P(0, 10)];
        const g = buildPathGeometry(L, { fill: { color: white } });
        valid(g);
        expect(area(g)).toBeCloseTo(75, 6);
    });

    it('leaves a hole empty', () => {
        const hole = [P(3, 3), P(7, 3), P(7, 7), P(3, 7)];
        const g = buildPathGeometry(square, { fill: { color: white, holes: [hole] } });
        valid(g);
        expect(area(g)).toBeCloseTo(84, 6);
    });

    it('leaves two holes empty', () => {
        const h1 = [P(1, 1), P(3, 1), P(3, 3), P(1, 3)];
        const h2 = [P(6, 6), P(9, 6), P(9, 9), P(6, 9)];
        const g = buildPathGeometry(square, { fill: { color: white, holes: [h1, h2] } });
        valid(g);
        expect(area(g)).toBeCloseTo(100 - 4 - 9, 6);
    });

    it('draws nothing for fewer than three points', () => {
        expect(buildPathGeometry([P(0, 0), P(1, 1)], { fill: { color: white } }).indices.length).toBe(0);
    });

    it('feathers the edge: a fringe of transparent vertices, the opaque core unchanged', () => {
        const g = buildPathGeometry(square, { fill: { color: white }, feather: 1 });
        valid(g);
        expect(area(g, true)).toBeCloseTo(100, 6);
        const transparent = g.colors!.filter((v, i) => i % 4 === 3 && v === 0).length;
        expect(transparent).toBe(4);
        expect(area(g)).toBeGreaterThan(100 + 40);
    });
});

describe('path stroke', () => {
    const stroke = (over: Partial<PathStroke> = {}): PathStroke => ({ color: white, width: 2, ...over });

    it('is a rectangle for a straight segment, longer by the cap', () => {
        const line = [P(0, 0), P(10, 0)];
        expect(area(buildPathGeometry(line, { stroke: stroke() }))).toBeCloseTo(20, 6);
        expect(area(buildPathGeometry(line, { stroke: stroke({ cap: 'square' }) }))).toBeCloseTo(24, 6);
        const round = area(buildPathGeometry(line, { stroke: stroke({ cap: 'round' }), arcStep: 0.05 }));
        expect(round).toBeGreaterThan(20 + Math.PI * 0.98);
        expect(round).toBeLessThan(20 + Math.PI + 1e-6);
    });

    it('lays a closed square out with no overlap, by join', () => {
        const miter = buildPathGeometry(square, { stroke: stroke({ join: 'miter' }), closed: true });
        valid(miter);
        expect(area(miter)).toBeCloseTo(144 - 64, 6);
        const bevel = buildPathGeometry(square, { stroke: stroke({ join: 'bevel' }), closed: true });
        valid(bevel);
        expect(area(bevel)).toBeCloseTo(80 - 4 * 0.5, 6);
        const round = buildPathGeometry(square, { stroke: stroke({ join: 'round' }), closed: true, arcStep: 0.05 });
        valid(round);
        expect(area(round)).toBeGreaterThan(80 - 4 * (1 - Math.PI / 4) - 0.01);
        expect(area(round)).toBeLessThan(80 - 4 * (1 - Math.PI / 4) + 1e-6);
    });

    it('bevels a miter past its limit', () => {
        // A hairpin: the miter of this corner is far longer than the line is wide.
        const spike = [P(0, 0), P(10, 0), P(0, 3.6)];
        const limited = buildPathGeometry(spike, { stroke: stroke({ join: 'miter', miterLimit: 2 }) });
        const open = buildPathGeometry(spike, { stroke: stroke({ join: 'miter', miterLimit: 100 }) });
        valid(limited);
        valid(open);
        const maxX = (g: MeshRendererGeometry) => Math.max(...g.positions.filter((_, i) => i % 2 === 0));
        expect(maxX(open)).toBeGreaterThan(maxX(limited) + 1);
    });

    it('draws every segment of a bent open line', () => {
        const g = buildPathGeometry([P(0, 0), P(10, 0), P(10, 10)], { stroke: stroke() });
        valid(g);
        // Two 10-long segments of width 2, the corner shared once: the outer 1x1 corner added, the inner 1x1 taken away.
        expect(area(g)).toBeCloseTo(40, 6);
    });

    it('survives repeated points, one point and zero width', () => {
        valid(buildPathGeometry([P(0, 0), P(0, 0), P(5, 0), P(5, 0)], { stroke: stroke() }));
        expect(buildPathGeometry([P(1, 1)], { stroke: stroke() }).indices.length).toBe(0);
        expect(buildPathGeometry([P(0, 0), P(5, 0)], { stroke: stroke({ width: 0 }) }).indices.length).toBe(0);
    });

    it('feathers the sides: transparent fringe vertices, the opaque core unchanged', () => {
        const g = buildPathGeometry([P(0, 0), P(10, 0)], { stroke: stroke(), feather: 0.5 });
        valid(g);
        expect(area(g, true)).toBeCloseTo(20, 6);
        expect(area(g)).toBeGreaterThan(20);
    });

    it('stays finite on a smooth curve at every join and cap', () => {
        const curve = cubicBezier(P(0, 0), P(10, 20), P(20, -20), P(30, 0), 0.05);
        for (const join of ['miter', 'round', 'bevel'] as const) {
            for (const cap of ['butt', 'round', 'square'] as const) {
                valid(buildPathGeometry(curve, { stroke: stroke({ join, cap }), feather: 0.3 }));
            }
        }
    });
});

describe('path helpers', () => {
    it('cuts a Bezier through its end points, finer where it bends', () => {
        const flat = cubicBezier(P(0, 0), P(3, 0), P(6, 0), P(9, 0));
        const bent = cubicBezier(P(0, 0), P(0, 30), P(30, 30), P(30, 0));
        expect(flat[0]).toEqual(P(0, 0));
        expect(flat[flat.length - 1]!.x).toBeCloseTo(9, 9);
        expect(bent.length).toBeGreaterThan(flat.length);
        const q = quadraticBezier(P(0, 0), P(5, 10), P(10, 0));
        expect(q[Math.floor(q.length / 2)]!.y).toBeGreaterThan(4);
    });

    it('makes a circle and an arc', () => {
        const c = circlePoints(0, 0, 10, 32);
        expect(c.length).toBe(32);
        for (const p of c) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
        const arc = circlePoints(0, 0, 10, 8, 0, Math.PI);
        expect(arc.length).toBe(9);
        expect(arc[8]!.x).toBeCloseTo(-10, 9);
    });

    it('merges geometries with their indices shifted', () => {
        const a = buildPathGeometry(square, { fill: { color: white } });
        const g = mergeGeometry([a, a]);
        valid(g);
        expect(area(g)).toBeCloseTo(200, 6);
    });

    it('builds a four-hundred-point fill and stroke quickly', () => {
        const ring = circlePoints(0, 0, 50, 400);
        const t = performance.now();
        const g = buildPathGeometry(ring, { fill: { color: white }, stroke: { color: white, width: 2 }, closed: true, feather: 0.5 });
        expect(performance.now() - t).toBeLessThan(500);
        valid(g);
    });
});
