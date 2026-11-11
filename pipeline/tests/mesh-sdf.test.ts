// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    mesh-sdf.test.ts
 * @brief   A baked mesh distance field against the closed-form distance of the shapes it was baked from.
 */
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { bakeMeshSdf, decodeMeshSdf, encodeMeshSdf, sampleMeshSdf, toHalf, fromHalf } from '../src/assets/meshSdf';

function meshOf(positions: number[], indices: number[]): MeshData {
    const vertexCount = positions.length / 3, vertices = new Uint8Array(vertexCount * 12), view = new DataView(vertices.buffer);
    positions.forEach((v, i) => view.setFloat32(i * 4, v, true));
    const min = [Infinity, Infinity, Infinity] as [number, number, number], max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
    for (let v = 0; v < vertexCount; v++) for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[v * 3 + k]!); max[k] = Math.max(max[k], positions[v * 3 + k]!);
    }
    return { channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }], vertexStride: 12, vertexCount,
        vertices, indices: new Uint32Array(indices), aabbMin: min, aabbMax: max };
}

/** An axis-aligned box centred at the origin with half extents h, outward winding. */
function box(h: [number, number, number]): MeshData {
    const p: number[] = [];
    for (let i = 0; i < 8; i++) p.push((i & 1 ? 1 : -1) * h[0], (i & 2 ? 1 : -1) * h[1], (i & 4 ? 1 : -1) * h[2]);
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    const idx: number[] = [];
    // Each quad is wound so its normal points away from the centre; check and flip.
    for (const [a, b, c, d] of quads as [number, number, number, number][]) {
        const pa = p.slice(a * 3, a * 3 + 3), pb = p.slice(b * 3, b * 3 + 3), pc = p.slice(c * 3, c * 3 + 3);
        const u = pb.map((v, k) => v - pa[k]!), w = pc.map((v, k) => v - pa[k]!);
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        const outward = n[0]! * pa[0]! + n[1]! * pa[1]! + n[2]! * pa[2]! > 0;
        idx.push(...(outward ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
    }
    return meshOf(p, idx);
}

function sphere(radius: number, rings = 48, segments = 64): MeshData {
    const p: number[] = [], idx: number[] = [];
    for (let r = 0; r <= rings; r++) for (let s = 0; s <= segments; s++) {
        const th = (r / rings) * Math.PI, ph = (s / segments) * 2 * Math.PI;
        p.push(radius * Math.sin(th) * Math.cos(ph), radius * Math.cos(th), radius * Math.sin(th) * Math.sin(ph));
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
        const a = r * (segments + 1) + s, b = a + segments + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return meshOf(p, idx);
}

/** The signed distance from p to a box of half extents h (Quilez), the closed form the baked field is held to. */
function boxDistance(p: readonly [number, number, number], h: readonly [number, number, number]): number {
    const q = [Math.abs(p[0]) - h[0], Math.abs(p[1]) - h[1], Math.abs(p[2]) - h[2]];
    return Math.hypot(Math.max(q[0]!, 0), Math.max(q[1]!, 0), Math.max(q[2]!, 0)) + Math.min(Math.max(q[0]!, q[1]!, q[2]!), 0);
}

describe('a mesh distance field', () => {
    it('matches the distance to a sphere, inside and out, to a fraction of a cell', () => {
        const r = 1, sdf = bakeMeshSdf(sphere(r), { cellSize: 0.1, inflate: 0 })!;
        let worst = 0;
        for (const p of [[0, 0, 0], [0.5, 0, 0], [0, -0.8, 0.3], [1.3, 0, 0], [0, 0, -1.6], [0.9, 0.9, 0.9], [-1.4, 0.4, 0.2]] as const) {
            const truth = Math.hypot(...p) - r;
            // Within half a cell of the surface exactly; further out the sweep that fills the field is a chamfer, a few percent long.
            worst = Math.max(worst, Math.abs(sampleMeshSdf(sdf, p) - truth) - 0.1 * Math.abs(truth));
        }
        expect(worst).toBeLessThan(0.5 * sdf.cell);
    });

    it('matches the distance to a box, with the right sign on both sides of a face', () => {
        const h = [0.6, 0.4, 0.5] as const, sdf = bakeMeshSdf(box([...h]), { cellSize: 0.05, inflate: 0 })!;
        let worst = 0;
        for (const p of [[0, 0, 0], [0.3, 0.1, -0.2], [0.9, 0, 0], [0, 0.7, 0], [0.9, 0.7, 0.8], [-0.7, -0.5, 0.6], [0, 0, -0.45]] as const) {
            worst = Math.max(worst, Math.abs(sampleMeshSdf(sdf, p) - boxDistance(p, h)) - 0.1 * Math.abs(boxDistance(p, h)));
        }
        expect(worst).toBeLessThan(0.6 * sdf.cell);
        expect(sampleMeshSdf(sdf, [0, 0, 0])).toBeLessThan(0);
        expect(sampleMeshSdf(sdf, [0.9, 0, 0])).toBeGreaterThan(0);
    });

    it('is a wall to a trace when the wall is thinner than a cell: negative at its centre, positive just outside', () => {
        // A wall 0.1 thick in a 0.4 grid: without growth the centre cell reads a few centimetres, with it the wall is a body.
        const sdf = bakeMeshSdf(box([2, 1.5, 0.05]), { cellSize: 0.4 })!;
        expect(sampleMeshSdf(sdf, [0, 0, 0])).toBeLessThan(0);
        expect(sampleMeshSdf(sdf, [0, 0, 0.6])).toBeGreaterThan(0);
        expect(sampleMeshSdf(sdf, [0, 0, -0.6])).toBeGreaterThan(0);
        // And the growth is at most half a cell: a point further than that from the wall is not inside it.
        expect(sampleMeshSdf(sdf, [0, 0, 0.05 + 0.5 * sdf.cell + 0.15])).toBeGreaterThan(0);
    });

    it('measures an open surface exactly on the side its faces look at', () => {
        const plane = meshOf([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], [0, 2, 1, 0, 3, 2]);
        const sdf = bakeMeshSdf(plane, { cellSize: 0.1, inflate: 0 })!;
        expect(sampleMeshSdf(sdf, [0, 0.5, 0])).toBeCloseTo(0.5, 1);
    });

    it('never needs more cells than it is allowed along its longest side', () => {
        const sdf = bakeMeshSdf(box([50, 1, 1]), { cellSize: 0.1, maxDim: 64 })!;
        expect(Math.max(...sdf.dims)).toBeLessThanOrEqual(64);
        expect(sdf.cell).toBeGreaterThan(0.1);
    });

    it('returns nothing for a mesh with no position channel or no triangles', () => {
        expect(bakeMeshSdf({ ...box([1, 1, 1]), channels: [] }, { cellSize: 0.1 })).toBeNull();
        expect(bakeMeshSdf({ ...box([1, 1, 1]), indices: new Uint32Array(0) }, { cellSize: 0.1 })).toBeNull();
    });
});

describe('the file a field is written to', () => {
    it('reads back what was written, to the half float the distances are stored in', () => {
        const sdf = bakeMeshSdf(box([0.5, 0.5, 0.5]), { cellSize: 0.1 })!, back = decodeMeshSdf(encodeMeshSdf(sdf));
        expect(back.dims).toEqual(sdf.dims);
        expect(back.cell).toBeCloseTo(sdf.cell, 6);
        expect(back.origin).toEqual(sdf.origin.map((v) => Math.fround(v)));
        let worst = 0;
        for (let i = 0; i < sdf.distance.length; i++) worst = Math.max(worst, Math.abs(back.distance[i]! - sdf.distance[i]!));
        expect(worst).toBeLessThan(2e-3);
    });

    it('converts half floats the way IEEE does', () => {
        for (const v of [0, 1, -1, 0.5, 0.099975586, 3.14, -42.5, 1024, 6e-5, 65504]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) * 1e-3 + 1e-7);
        expect(toHalf(1)).toBe(0x3c00);
        expect(toHalf(-2)).toBe(0xc000);
    });

    it('refuses a file that is not one', () => {
        expect(() => decodeMeshSdf(new Uint8Array(64))).toThrow();
    });
});
