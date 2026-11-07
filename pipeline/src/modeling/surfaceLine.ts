// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  surfaceLine.ts — a line drawn on a surface as seen from one side.
 *
 *        What is traced from a picture has no depth: a crease in a sleeve is known by where it is on the
 *        screen, not by how far the cloth stands out there. So a line can be given in the two axes of a view,
 *        and it lands on whatever faces that view and is nearest it, as a pen on the picture would.
 */
import { boundsOf, type PolyMesh, type Vec3 } from './polyMesh';
import { curveThrough } from './surfaces';

export type ViewName = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const VIEW_NAMES: readonly string[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

export interface View {
    /** The axis looked along, and which end of it the eye is at. */
    axis: 0 | 1 | 2;
    sign: 1 | -1;
    /** The two axes the picture has, in x, y, z order. */
    u: 0 | 1 | 2;
    v: 0 | 1 | 2;
}

export function viewOf(name: ViewName): View {
    const axis = ({ x: 0, y: 1, z: 2 } as const)[name[1] as 'x' | 'y' | 'z'];
    const [u, v] = axis === 0 ? [1, 2] as const : axis === 1 ? [0, 2] as const : [0, 1] as const;
    return { axis, sign: name[0] === '+' ? 1 : -1, u, v };
}

export interface LineHit {
    distance: number;
    /** How far along the whole line the nearest point is, 0..1. */
    along: number;
    /** Which side of the line the point is on, by the line's direction: in a view, left of it is +1. */
    side: number;
}

/** A line's points, rounded through by `curve` segments between each; a point given twice keeps a corner. */
export const drawnLine = (points: readonly (readonly number[])[], curve: number | undefined): readonly (readonly number[])[] => (curve && curve > 1 ? curveThrough(points, curve, false) : points);

/** A polyline in any number of coordinates, and what is nearest a point on it. */
export function lineMeasure(points: readonly (readonly number[])[]): (at: readonly number[], normal: Vec3 | null) => LineHit {
    const dims = points[0]!.length;
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        let sum = 0;
        for (let k = 0; k < dims; k++) sum += (points[i]![k]! - points[i - 1]![k]!) ** 2;
        const len = Math.sqrt(sum);
        lengths.push(len);
        total += len;
    }
    return (at, normal) => {
        let best = Infinity, along = 0, run = 0, seg = 0, bestT = 0;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1]!, b = points[i]!, len = lengths[i - 1]!;
            let dotted = 0;
            for (let k = 0; k < dims; k++) dotted += (at[k]! - a[k]!) * (b[k]! - a[k]!);
            const t = len > 0 ? Math.max(0, Math.min(1, dotted / (len * len))) : 0;
            let sum = 0;
            for (let k = 0; k < dims; k++) sum += (at[k]! - a[k]! - (b[k]! - a[k]!) * t) ** 2;
            if (sum < best) { best = sum; along = run + len * t; seg = i; bestT = t; }
            run += len;
        }
        const a = points[seg - 1]!, b = points[seg]!;
        const [dx, dy, dz] = [b[0]! - a[0]!, b[1]! - a[1]!, (b[2] ?? 0) - (a[2] ?? 0)];
        const [ox, oy, oz] = [at[0]! - a[0]! - dx * bestT, at[1]! - a[1]! - dy * bestT, (at[2] ?? 0) - (a[2] ?? 0) - dz * bestT];
        // In a view, the screen's own "out"; on the surface, the way it faces.
        const [nx, ny, nz] = dims === 2 || !normal ? [0, 0, 1] : normal;
        const side = (ny * dz - nz * dy) * ox + (nz * dx - nx * dz) * oy + (nx * dy - ny * dx) * oz;
        return { distance: Math.sqrt(best), along: total > 0 ? along / total : 0, side: side >= 0 ? 1 : -1 };
    };
}

/** Those of @p hit whose outline in the view comes within the box. */
export function facesInView(mesh: PolyMesh, hit: readonly number[], view: View, lo: readonly [number, number], hi: readonly [number, number]): number[] {
    return hit.filter((f) => {
        const { min, max } = boundsOf(mesh, mesh.faces[f]!.v);
        return max[view.u] >= lo[0] && min[view.u] <= hi[0] && max[view.v] >= lo[1] && min[view.v] <= hi[1];
    });
}

/** How much of each vertex the view sees, 0..1: facing it, and at the front of what lies along the line of sight there. Fades with depth, as neighbours that split into one moved and one not dent the surface. */
export function seenFrom(mesh: PolyMesh, normals: Float64Array, view: View, vertices: readonly number[], cell: number): Float32Array {
    const seen = new Float32Array(mesh.positions.length);
    const front = new Map<number, number>();
    const key = (a: number, b: number): number => a * 1048576 + b;
    const place = (at: Vec3): [number, number] => [Math.floor(at[view.u] / cell) + 500000, Math.floor(at[view.v] / cell)  + 500000];
    for (const v of vertices) {
        const at = mesh.positions[v]!;
        const depth = at[view.axis] * view.sign;
        const [a, b] = place(at);
        const k = key(a, b);
        const was = front.get(k);
        if (was === undefined || depth > was) front.set(k, depth);
    }
    for (const v of vertices) {
        if (normals[v * 3 + view.axis]! * view.sign <= 0.02) continue;
        const at = mesh.positions[v]!;
        const [a, b] = place(at);
        let nearest = -Infinity;
        for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) nearest = Math.max(nearest, front.get(key(a + da, b + db)) ?? -Infinity);
        const behind = nearest - at[view.axis] * view.sign;
        const t = 1 - (behind - cell * 2) / (cell * 3);
        seen[v] = t >= 1 ? 1 : t <= 0 ? 0 : t * t * (3 - 2 * t);
    }
    return seen;
}
