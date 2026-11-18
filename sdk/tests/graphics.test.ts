// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a Graphics fills any outline it is given - a path between beginFill and endFill as much as a rectangle, concave ones
 * included - builds its triangles once, and draws them in one batched call that can move, turn, scale and fade the drawing, so one
 * shape drawn many times a frame rebuilds nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Graphics } from '../src/render/graphics';
import { Draw } from '../src/render/draw';
import type { MeshRendererGeometry } from '../src/ecs/component';

vi.mock('../src/render/draw', () => ({ Draw: { triangles: vi.fn() } }));

const RED = { r: 1, g: 0, b: 0, a: 1 };
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

/** The area the triangles cover, counting only those whose first vertex `pick` accepts by colour. */
function areaOf(geo: MeshRendererGeometry, pick: (rgba: number[]) => boolean = () => true): number {
    let sum = 0;
    const p = geo.positions, c = geo.colors ?? [];
    for (let i = 0; i < geo.indices.length; i += 3) {
        const [a, b, d] = [geo.indices[i], geo.indices[i + 1], geo.indices[i + 2]];
        if (!pick(c.slice(a * 4, a * 4 + 4))) continue;
        sum += Math.abs((p[b * 2] - p[a * 2]) * (p[d * 2 + 1] - p[a * 2 + 1]) - (p[d * 2] - p[a * 2]) * (p[b * 2 + 1] - p[a * 2 + 1])) / 2;
    }
    return sum;
}

const isRed = (rgba: number[]) => rgba[0] === 1 && rgba[1] === 0 && rgba[2] === 0;

/** A regular hexagon of radius r about (cx, cy), as a path. */
function hexagonPath(g: Graphics, cx: number, cy: number, r: number): void {
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
}

beforeEach(() => vi.mocked(Draw.triangles).mockClear());

describe('a Graphics path', () => {
    it('counts the points of the path being drawn, and clear() forgets them', () => {
        const g = new Graphics();
        g.moveTo(0, 0);
        g.lineTo(100, 100);
        g.lineTo(200, 0);
        expect(g.pathLength).toBe(3);
        g.clear();
        expect(g.pathLength).toBe(0);
        expect(g.geometry().indices).toHaveLength(0);
    });

    it('is filled between beginFill and endFill: a hexagon covers the area a hexagon has', () => {
        const g = new Graphics();
        g.lineStyle(0, WHITE);
        g.beginFill(RED);
        hexagonPath(g, 0, 0, 50);
        g.endFill();
        const hexagon = (3 * Math.sqrt(3) / 2) * 50 * 50;
        expect(areaOf(g.geometry())).toBeCloseTo(hexagon, 3);
        expect(g.geometry().indices.length).toBe(4 * 3);
    });

    it('fills a concave outline exactly, not its hull', () => {
        const g = new Graphics();
        g.lineStyle(0, WHITE);
        g.beginFill(RED);
        // An L: three squares of 10, area 300, where its hull would be 350.
        g.drawPolygon([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }]);
        g.endFill();
        expect(areaOf(g.geometry())).toBeCloseTo(300, 6);
    });

    it('is only stroked with no fill on, and the stroke turns its corners', () => {
        const g = new Graphics();
        g.lineStyle(4, RED, { join: 'miter' });
        g.moveTo(0, 0);
        g.lineTo(100, 0);
        g.lineTo(100, 100);
        const geo = g.geometry();
        expect(geo.indices.length).toBeGreaterThan(0);
        // Two 100-long segments of width 4 meeting in a mitre: about 4 * 200, give or take the corner.
        expect(areaOf(geo, isRed)).toBeGreaterThan(790);
        expect(areaOf(geo, isRed)).toBeLessThan(820);
    });

    it('draws nothing with neither a fill nor a line width', () => {
        const g = new Graphics();
        g.lineStyle(0, WHITE);
        hexagonPath(g, 0, 0, 10);
        expect(g.geometry().indices).toHaveLength(0);
        g.flush();
        expect(Draw.triangles).not.toHaveBeenCalled();
    });

    it('goes on from the same point when the style changes part-way along it', () => {
        const g = new Graphics();
        g.lineStyle(2, RED);
        g.moveTo(0, 0);
        g.lineTo(50, 0);
        g.lineStyle(2, WHITE);
        g.lineTo(50, 50);
        g.geometry();
        expect(g.shapeCount).toBe(2);
    });

    it('ends a curve and an arc where they were asked to end', () => {
        const g = new Graphics();
        g.moveTo(0, 0);
        g.curveTo(50, 100, 100, 0, 10);
        expect(g.pathLength).toBe(11);
        g.cubicCurveTo(110, 50, 140, 50, 150, 0, 10);
        expect(g.pathLength).toBe(21);
        g.arc(200, 0, 50, Math.PI, 0, false, 8);
        expect(g.pathLength).toBe(21 + 9);
    });
});

describe('Graphics shapes', () => {
    const filled = (draw: (g: Graphics) => void): number => {
        const g = new Graphics();
        g.lineStyle(0, WHITE);
        g.beginFill(RED);
        draw(g);
        g.endFill();
        return areaOf(g.geometry());
    };

    it('fill a rectangle, a circle and an ellipse to the area they have', () => {
        expect(filled((g) => g.drawRect(10, 10, 40, 30))).toBeCloseTo(1200, 6);
        expect(filled((g) => g.drawCircle(0, 0, 50, 128))).toBeCloseTo(Math.PI * 2500, -1);
        expect(filled((g) => g.drawEllipse(0, 0, 50, 20, 128))).toBeCloseTo(Math.PI * 1000, -1);
    });

    it('fill a rounded rectangle rounded, short of its corners', () => {
        const area = filled((g) => g.drawRoundRect(0, 0, 100, 60, 20, 16));
        expect(area).toBeLessThan(6000);
        expect(area).toBeCloseTo(6000 - (4 - Math.PI) * 400, -1);
    });

    it('stroke a shape with no fill on', () => {
        const g = new Graphics();
        g.lineStyle(2, RED);
        g.drawRect(0, 0, 100, 100);
        expect(areaOf(g.geometry(), isRed)).toBeGreaterThan(780);
        expect(areaOf(g.geometry(), isRed)).toBeLessThan(820);
    });
});

describe('drawing a Graphics', () => {
    const hexagon = (): Graphics => {
        const g = new Graphics();
        g.lineStyle(0, WHITE);
        g.beginFill(RED);
        hexagonPath(g, 0, 0, 10);
        g.endFill();
        return g;
    };

    it('is one batched call with the triangles it built', () => {
        hexagon().flush();
        expect(Draw.triangles).toHaveBeenCalledTimes(1);
        const [mesh, options] = vi.mocked(Draw.triangles).mock.calls[0];
        expect(mesh.indices.length).toBe(12);
        expect(options?.transform?.map((v) => v + 0)).toEqual([1, 0, 0, 1, 0, 0]);
        expect(options?.tint).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });

    it('moves, turns, scales and fades the drawing as it is asked', () => {
        hexagon().flush({ x: 30, y: 40, rotation: Math.PI / 2, scale: 2, alpha: 0.25, tint: { r: 0.5, g: 1, b: 1, a: 1 } });
        const [, options] = vi.mocked(Draw.triangles).mock.calls[0];
        const [xx, xy, yx, yy, tx, ty] = options!.transform!;
        expect([xx, xy, yx, yy].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 2, -2, 0]);
        expect([tx, ty]).toEqual([30, 40]);
        expect(options!.tint).toEqual({ r: 0.5, g: 1, b: 1, a: 0.25 });
    });

    it('draws nothing at alpha 0', () => {
        hexagon().flush({ alpha: 0 });
        expect(Draw.triangles).not.toHaveBeenCalled();
    });

    it('builds its triangles once, however many times it is drawn, and again only after a change', () => {
        const g = hexagon();
        const first = g.geometry();
        for (let i = 0; i < 100; i++) g.flush({ x: i, alpha: (i + 1) / 100 });
        expect(g.geometry()).toBe(first);
        const meshes = new Set(vi.mocked(Draw.triangles).mock.calls.map(([mesh]) => mesh));
        expect(meshes.size).toBe(1);
        // A shape that draws nothing (no fill, no line width) changes nothing.
        g.drawCircle(0, 0, 5);
        expect(g.geometry()).toBe(first);
        g.lineStyle(1, WHITE);
        g.drawCircle(0, 0, 5);
        expect(g.geometry()).not.toBe(first);
    });
});
