// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @file  triangulate.ts — a polygon as triangles, for the bake and for a boolean's input. */
import { cross, dot, faceNormal, normalize, type Face, type PolyMesh, type Vec3 } from './polyMesh';

/** Ear clipping in the face's own plane: n-gons here can be concave (a prism's floor plan). */
export function triangulateFace(mesh: PolyMesh, face: Face): [number, number, number][] {
    const count = face.v.length;
    if (count < 3) return [];
    if (count === 3) return [[face.v[0]!, face.v[1]!, face.v[2]!]];
    if (face.smooth && count === 4) {
        // A skin's quad bends, and may be a sliver. Split on the shorter diagonal, keeping both halves whatever their size: a dropped one is a crack.
        const [a, b, c, d] = face.v as [number, number, number, number];
        const gap = (i: number, j: number): number => {
            const [p, q] = [mesh.positions[i]!, mesh.positions[j]!];
            return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        };
        return gap(a, c) <= gap(b, d) ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
    }
    const n = faceNormal(mesh, face);
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] as Vec3 : [0, 1, 0] as Vec3;
    const u = normalize(cross(ref, n));
    const w = cross(n, u);
    const flat = face.v.map((i) => {
        const p = mesh.positions[i]!;
        return [dot(p, u), dot(p, w)] as const;
    });
    const area2 = (a: number, b: number, c: number): number => {
        const [ax, ay] = flat[a]!, [bx, by] = flat[b]!, [cx, cy] = flat[c]!;
        return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    };
    const span = Math.max(...flat.map((q) => Math.hypot(q[0] - flat[0]![0], q[1] - flat[0]![1])), 1e-9);
    const tiny = span * span * 1e-10;
    const out: [number, number, number][] = [];
    const loop = flat.map((_, i) => i);
    let guard = count * count + 8;
    while (loop.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[(i + loop.length - 1) % loop.length]!, b = loop[i]!, c = loop[(i + 1) % loop.length]!;
            if (area2(a, b, c) <= tiny) continue; // reflex, or a vertex lying on a straight run (kept: a neighbour may rely on it)
            let blocked = false;
            for (const q of loop) {
                if (q === a || q === b || q === c) continue;
                if (area2(a, b, q) >= -tiny && area2(b, c, q) >= -tiny && area2(c, a, q) >= -tiny) { blocked = true; break; }
            }
            if (blocked) continue;
            out.push([face.v[a]!, face.v[b]!, face.v[c]!]);
            loop.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break;
    }
    // What is left is a triangle, or a loop no ear could be cut from: a self-crossing face. Fanned, it still draws something to look at.
    // All of it, even with no area: the edges are shared with the neighbours whether or not this has any.
    for (let i = 1; i + 1 < loop.length; i++) out.push([face.v[loop[0]!]!, face.v[loop[i]!]!, face.v[loop[i + 1]!]!]);
    return out;
}
