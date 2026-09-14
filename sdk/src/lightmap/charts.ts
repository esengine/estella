// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    charts.ts
 * @brief   Triangles in, flat pieces out — the first half of a lightmap unwrap.
 *
 * A bake is read through a UV set where no two surfaces share a texel, which the
 * UV set the art is wrapped in deliberately violates. Here the surface is cut
 * into charts that are nearly flat, and each is projected onto its own plane.
 */

/** One triangle of the source, by vertex index. */
export interface Tri {
    a: number;
    b: number;
    c: number;
}

export interface ChartSet {
    /** Chart index per triangle, parallel to the triangle list. */
    chartOf: Int32Array;
    /** How many charts the surface was cut into. */
    count: number;
    /** Orthonormal projection basis per chart: `[tx,ty,tz, bx,by,bz]`. */
    basis: Float32Array;
}

const dot = (a: Float32Array, i: number, b: Float32Array, j: number): number =>
    a[i] * b[j] + a[i + 1] * b[j + 1] + a[i + 2] * b[j + 2];

/**
 * Welds vertices by POSITION, returning a representative index per vertex.
 *
 * Adjacency has to be geometric: an importer already splits a vertex wherever a
 * normal or a UV is discontinuous, so two triangles sharing an edge of the model
 * usually share no vertex index at all. Quantising is what makes them meet.
 */
export function weldByPosition(positions: Float32Array, vertexCount: number,
                               epsilon: number): Int32Array {
    const rep = new Int32Array(vertexCount);
    const grid = new Map<string, number>();
    const inv = 1 / Math.max(epsilon, 1e-9);
    for (let v = 0; v < vertexCount; v++) {
        const x = Math.round(positions[v * 3] * inv);
        const y = Math.round(positions[v * 3 + 1] * inv);
        const z = Math.round(positions[v * 3 + 2] * inv);
        const key = `${x},${y},${z}`;
        const seen = grid.get(key);
        if (seen === undefined) { grid.set(key, v); rep[v] = v; } else { rep[v] = seen; }
    }
    return rep;
}

/** Geometric normal of a triangle, unnormalised — its length is twice the area. */
function faceNormal(p: Float32Array, t: Tri, out: Float32Array, at: number): number {
    const ax = p[t.a * 3], ay = p[t.a * 3 + 1], az = p[t.a * 3 + 2];
    const ux = p[t.b * 3] - ax, uy = p[t.b * 3 + 1] - ay, uz = p[t.b * 3 + 2] - az;
    const vx = p[t.c * 3] - ax, vy = p[t.c * 3 + 1] - ay, vz = p[t.c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[at] = nx; out[at + 1] = ny; out[at + 2] = nz;
    return Math.hypot(nx, ny, nz);
}

/** Triangles sharing each welded edge, as a map from edge key to triangle list. */
function edgeMap(tris: Tri[], rep: Int32Array): Map<number, number[]> {
    const edges = new Map<number, number[]>();
    const add = (u: number, v: number, t: number): void => {
        const lo = Math.min(u, v), hi = Math.max(u, v);
        // A pair key rather than a string: this runs once per edge of every model
        // imported, and 2^26 vertices is past what the format can index anyway.
        const key = lo * 67108864 + hi;
        const at = edges.get(key);
        if (at) at.push(t); else edges.set(key, [t]);
    };
    for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        add(rep[t.a], rep[t.b], i);
        add(rep[t.b], rep[t.c], i);
        add(rep[t.c], rep[t.a], i);
    }
    return edges;
}

/**
 * Cuts the surface into nearly-flat charts and gives each a projection basis.
 *
 * @param maxAngleCos Cosine of the widest angle two neighbours may differ by and
 *        still be one chart. Flatter charts project with less stretch and pack
 *        worse; this is the whole of that trade.
 */
export function buildCharts(positions: Float32Array, tris: Tri[], rep: Int32Array,
                            maxAngleCos: number): ChartSet {
    const count = tris.length;
    const normals = new Float32Array(count * 3);
    const degenerate = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
        const len = faceNormal(positions, tris[i], normals, i * 3);
        // A triangle with no area has no normal to grow a chart along, and no
        // texels to light either. It joins whatever claims it and is projected
        // with that chart's basis.
        if (len < 1e-12) { degenerate[i] = 1; continue; }
        normals[i * 3] /= len; normals[i * 3 + 1] /= len; normals[i * 3 + 2] /= len;
    }

    const edges = edgeMap(tris, rep);
    const neighboursOf = (t: number): number[] => {
        const tri = tris[t];
        const out: number[] = [];
        const push = (u: number, v: number): void => {
            const lo = Math.min(rep[u], rep[v]), hi = Math.max(rep[u], rep[v]);
            for (const other of edges.get(lo * 67108864 + hi) ?? []) {
                if (other !== t) out.push(other);
            }
        };
        push(tri.a, tri.b); push(tri.b, tri.c); push(tri.c, tri.a);
        return out;
    };

    const chartOf = new Int32Array(count).fill(-1);
    const seeds: number[] = [];
    let charts = 0;
    for (let start = 0; start < count; start++) {
        if (chartOf[start] >= 0) continue;
        const id = charts++;
        seeds.push(start);
        chartOf[start] = id;
        // Grown against the SEED's normal, not each neighbour's: comparing to the
        // neighbour lets a chart walk around a cylinder one small step at a time
        // and come back facing away from where it started.
        const queue = [start];
        while (queue.length > 0) {
            const t = queue.pop() as number;
            for (const n of neighboursOf(t)) {
                if (chartOf[n] >= 0) continue;
                if (!degenerate[n] && !degenerate[start]
                    && dot(normals, start * 3, normals, n * 3) < maxAngleCos) continue;
                chartOf[n] = id;
                queue.push(n);
            }
        }
    }

    const basis = new Float32Array(charts * 6);
    const sum = new Float32Array(charts * 3);
    for (let i = 0; i < count; i++) {
        if (degenerate[i]) continue;
        const c = chartOf[i] * 3;
        sum[c] += normals[i * 3]; sum[c + 1] += normals[i * 3 + 1]; sum[c + 2] += normals[i * 3 + 2];
    }
    for (let c = 0; c < charts; c++) {
        let nx = sum[c * 3], ny = sum[c * 3 + 1], nz = sum[c * 3 + 2];
        let len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) { nx = 0; ny = 0; nz = 1; len = 1; }
        nx /= len; ny /= len; nz /= len;
        // Any axis not parallel to the normal gives a tangent; the least of the
        // three components is the one that cannot be.
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        const up = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
        let tx = up[1] * nz - up[2] * ny;
        let ty = up[2] * nx - up[0] * nz;
        let tz = up[0] * ny - up[1] * nx;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        basis[c * 6] = tx; basis[c * 6 + 1] = ty; basis[c * 6 + 2] = tz;
        basis[c * 6 + 3] = ny * tz - nz * ty;
        basis[c * 6 + 4] = nz * tx - nx * tz;
        basis[c * 6 + 5] = nx * ty - ny * tx;
    }
    return { chartOf, count: charts, basis };
}
