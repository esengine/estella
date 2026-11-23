// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomTextures.ts — textures made from a groom's strands: a follicle mask, and the strands textures hair cards are drawn with.
 *
 *        - The FOLLICLE MASK is a small distance field round every root, at the root's UV, in one colour channel per groom: a skin
 *          material reads it to darken or tint the scalp where hair grows, so the hair and the skin under it meet without a seam.
 *        - The STRANDS TEXTURES are the strands laid onto a mesh's UVs: each point of a strand is found on the mesh (the nearest
 *          surface within the trace distance, outside it, inside it or either), and the strands are drawn there as the mesh's
 *          texels see them. Four pictures: Depth (how far from the surface the nearest strand is, 0 on it, 1 at the trace distance),
 *          Coverage (how much of a texel strands cover), Tangent (the strand's direction in the mesh's tangent space, as a normal map
 *          writes one) and Attribute (R how far along its strand, G a value per strand, B and A the strand's root UV). A hair-card
 *          or hair-shell mesh drawn with them looks like the groom from a distance, for far LODs and for devices that cannot draw strands.
 *
 *        Finding strands on the mesh is a nearest-point query per strand point, against a bounding-volume tree of the mesh's
 *        triangles: an answer the CPU gives at once from the mesh it already holds. Drawing them into the texels is rasterising
 *        hundreds of thousands of thin quads with blending, which is what the GPU is for: it is done there, by the engine's own
 *        immediate draw into render targets, and read back.
 */
import { MeshChannel, MeshChannelType, type MeshData } from '../asset/meshFormat';
import { Draw } from '../render/draw';
import { RenderTexture, type RenderTextureHandle } from '../render/renderTexture';
import { Renderer } from '../render/renderer';
import { BlendMode } from '../render/blend';
import { captureTargetPixels } from '../render/framePixels';
import type { ESEngineModule } from '../wasm';
import { linearColorSpace } from '../ecs/env';
import type { CurveSet, GroomCurves } from './groomFormat';

type V3 = [number, number, number];

// ─── The mesh, in the groom's space ─────────────────────────────────────────────────────────────────────────────────────────

/** Where the mesh is in the groom's space: its vertices are scaled, turned (a quaternion) and moved, in that order, into metres. */
export interface MeshPlacement {
    position?: V3;
    rotation?: [number, number, number, number];
    /** Default: one over the project's world units a metre, the scale a mesh of the scene has against a groom in metres. */
    scale?: V3;
}

function channelReader(mesh: MeshData, semantic: number): ((v: number, k: number) => number) | null {
    const c = mesh.channels.find((ch) => ch.semantic === semantic);
    if (!c) return null;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const stride = mesh.vertexStride;
    switch (c.type) {
        case MeshChannelType.Float32: return (v, k) => view.getFloat32(v * stride + c.offset + k * 4, true);
        case MeshChannelType.UNorm16: return (v, k) => view.getUint16(v * stride + c.offset + k * 2, true) / 65535;
        case MeshChannelType.UNorm8: return (v, k) => view.getUint8(v * stride + c.offset + k) / 255;
        default: return null;
    }
}

/** A mesh's triangles where the groom is, with their UVs and what the texels on each measure. */
export interface MeshSurface {
    triangles: number;
    /** Three corners a triangle, xyz, in metres in the groom's space. */
    corners: Float64Array;
    /** Three UVs a triangle. */
    uvs: Float64Array;
    /** Per triangle: its normal (out of the surface), then its tangent and bitangent (along +u and +v), nine numbers. */
    frames: Float64Array;
    /** Per triangle: metres a unit of UV is across it (the square root of its area over its UV area). */
    metresPerUv: Float64Array;
    /** Per triangle: the UV a metre along x, y and z in its plane moves, as two rows of three (du, then dv). */
    uvPerMetre: Float64Array;
    /** The tree the nearest-point query walks. */
    bvh: Bvh;
}

function rotate(q: [number, number, number, number], v: V3): V3 {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The mesh's triangles in the groom's space, read from UV set `uvChannel` (0 or 1). Throws for a mesh with no such UVs. */
export function meshSurface(mesh: MeshData, placement: MeshPlacement, uvChannel = 0, unitsPerMeter = 100): MeshSurface {
    const pos = channelReader(mesh, MeshChannel.Position);
    const uv = channelReader(mesh, uvChannel === 1 ? MeshChannel.TexCoord1 : MeshChannel.TexCoord0);
    const nrm = channelReader(mesh, MeshChannel.Normal);
    if (!pos) throw new Error('the mesh has no positions');
    if (!uv) throw new Error(`the mesh has no UV channel ${uvChannel}`);
    const s = placement.scale ?? [1 / unitsPerMeter, 1 / unitsPerMeter, 1 / unitsPerMeter];
    const q = placement.rotation ?? [0, 0, 0, 1];
    const t = placement.position ?? [0, 0, 0];
    const at = (v: number): V3 => {
        const r = rotate(q, [pos(v, 0) * s[0], pos(v, 1) * s[1], pos(v, 2) * s[2]]);
        return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
    };
    const n = Math.floor(mesh.indices.length / 3);
    const corners = new Float64Array(n * 9), uvs = new Float64Array(n * 6), frames = new Float64Array(n * 9), metresPerUv = new Float64Array(n);
    const uvPerMetre = new Float64Array(n * 6);
    let kept = 0;
    for (let f = 0; f < n; f++) {
        const ids = [mesh.indices[f * 3]!, mesh.indices[f * 3 + 1]!, mesh.indices[f * 3 + 2]!];
        const P = ids.map(at), U = ids.map((v) => [uv(v, 0), uv(v, 1)]);
        const e1 = sub(P[1]!, P[0]!), e2 = sub(P[2]!, P[0]!);
        let N = cross(e1, e2);
        const area2 = len(N);
        if (area2 < 1e-14) continue;
        N = scale(N, 1 / area2);
        // Out of the surface as its own normals say, where it has them: a mirrored or flipped winding does not turn it inside out.
        if (nrm) {
            const vn = rotate(q, [nrm(ids[0]!, 0) + nrm(ids[1]!, 0) + nrm(ids[2]!, 0), nrm(ids[0]!, 1) + nrm(ids[1]!, 1) + nrm(ids[2]!, 1), nrm(ids[0]!, 2) + nrm(ids[1]!, 2) + nrm(ids[2]!, 2)]);
            if (dot(vn, N) < 0) N = scale(N, -1);
        }
        const du1 = U[1]![0]! - U[0]![0]!, dv1 = U[1]![1]! - U[0]![1]!, du2 = U[2]![0]! - U[0]![0]!, dv2 = U[2]![1]! - U[0]![1]!;
        const det = du1 * dv2 - du2 * dv1;
        const uvArea2 = Math.abs(det);
        if (uvArea2 < 1e-14) continue;
        // dP/du and dP/dv, then square to the normal.
        let T = scale(sub(scale(e1, dv2), scale(e2, dv1)), 1 / det);
        let B = scale(sub(scale(e2, du1), scale(e1, du2)), 1 / det);
        T = norm(sub(T, scale(N, dot(T, N))));
        B = norm(sub(B, scale(N, dot(B, N))));
        for (let k = 0; k < 3; k++) { corners.set(P[k]!, kept * 9 + k * 3); uvs[kept * 6 + k * 2] = U[k]![0]!; uvs[kept * 6 + k * 2 + 1] = U[k]![1]!; }
        frames.set(N, kept * 9); frames.set(T, kept * 9 + 3); frames.set(B, kept * 9 + 6);
        metresPerUv[kept] = Math.sqrt(area2 / uvArea2);
        // d = a e1 + b e2 in the plane: [a, b] = G^-1 [e1.d, e2.d], and the UV moves a duv1 + b duv2.
        const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2), gd = g11 * g22 - g12 * g12;
        const i11 = g22 / gd, i12 = -g12 / gd, i22 = g11 / gd;
        for (let k = 0; k < 3; k++) {
            const a = i11 * e1[k]! + i12 * e2[k]!, b = i12 * e1[k]! + i22 * e2[k]!;
            uvPerMetre[kept * 6 + k] = a * du1 + b * du2;
            uvPerMetre[kept * 6 + 3 + k] = a * dv1 + b * dv2;
        }
        kept++;
    }
    if (kept === 0) throw new Error('the mesh has no triangle with both an area and a UV area');
    const surface = {
        triangles: kept, corners: corners.slice(0, kept * 9), uvs: uvs.slice(0, kept * 6), frames: frames.slice(0, kept * 9),
        metresPerUv: metresPerUv.slice(0, kept), uvPerMetre: uvPerMetre.slice(0, kept * 6),
    };
    return { ...surface, bvh: buildBvh(surface.corners, kept) };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => { const l = len(a); return l > 1e-14 ? scale(a, 1 / l) : [0, 0, 0]; };

// ─── The nearest point on the mesh ──────────────────────────────────────────────────────────────────────────────────────────

/** A bounding-volume tree over triangles: per node its box, and either two children or a run of triangles. */
export interface Bvh {
    min: Float64Array;
    max: Float64Array;
    /** Per node: its first child (the second follows it), or -1 for a leaf. */
    child: Int32Array;
    /** Per node: its first triangle in `order` and how many, for a leaf. */
    start: Int32Array;
    count: Int32Array;
    order: Int32Array;
}

function buildBvh(corners: Float64Array, n: number): Bvh {
    const order = Int32Array.from({ length: n }, (_, i) => i);
    const centre = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) centre[i * 3 + k] = (corners[i * 9 + k]! + corners[i * 9 + 3 + k]! + corners[i * 9 + 6 + k]!) / 3;
    const cap = n * 2;
    const min = new Float64Array(cap * 3), max = new Float64Array(cap * 3);
    const child = new Int32Array(cap).fill(-1), start = new Int32Array(cap), count = new Int32Array(cap);
    let nodes = 1;
    const stack: number[] = [0];
    start[0] = 0; count[0] = n;
    while (stack.length) {
        const node = stack.pop()!;
        const s = start[node]!, c = count[node]!;
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        let clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity];
        for (let i = s; i < s + c; i++) {
            const t = order[i]!;
            for (let k = 0; k < 9; k++) { const a = k % 3, v = corners[t * 9 + k]!; if (v < lo[a]!) lo[a] = v; if (v > hi[a]!) hi[a] = v; }
            for (let a = 0; a < 3; a++) { const v = centre[t * 3 + a]!; if (v < clo[a]!) clo[a] = v; if (v > chi[a]!) chi[a] = v; }
        }
        for (let a = 0; a < 3; a++) { min[node * 3 + a] = lo[a]!; max[node * 3 + a] = hi[a]!; }
        if (c <= 4) continue;
        let axis = 0;
        for (let a = 1; a < 3; a++) if (chi[a]! - clo[a]! > chi[axis]! - clo[axis]!) axis = a;
        const mid = (clo[axis]! + chi[axis]!) / 2;
        let i = s, j = s + c - 1;
        while (i <= j) {
            if (centre[order[i]! * 3 + axis]! < mid) i++;
            else { const tmp = order[i]!; order[i] = order[j]!; order[j] = tmp; j--; }
        }
        let left = i - s;
        if (left === 0 || left === c) left = c >> 1;
        const a = nodes++, b = nodes++;
        child[node] = a;
        start[a] = s; count[a] = left; start[b] = s + left; count[b] = c - left;
        stack.push(a, b);
        lo = hi = clo = chi = [];
    }
    return { min: min.slice(0, nodes * 3), max: max.slice(0, nodes * 3), child: child.slice(0, nodes), start: start.slice(0, nodes), count: count.slice(0, nodes), order };
}

/** The nearest point of triangle `t` to p: its barycentric weights of corners 1 and 2 (corner 0's is the rest), into `out`. */
function closestOnTriangle(c: Float64Array, t: number, px: number, py: number, pz: number, out: Float64Array): void {
    const o = t * 9;
    const ax = c[o]!, ay = c[o + 1]!, az = c[o + 2]!;
    const abx = c[o + 3]! - ax, aby = c[o + 4]! - ay, abz = c[o + 5]! - az;
    const acx = c[o + 6]! - ax, acy = c[o + 7]! - ay, acz = c[o + 8]! - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let v = 0, w = 0;
    if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
    else {
        const bpx = px - c[o + 3]!, bpy = py - c[o + 4]!, bpz = pz - c[o + 5]!;
        const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - c[o + 6]!, cpy = py - c[o + 7]!, cpz = pz - c[o + 8]!;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
        else if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
        else if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
        else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; }
        else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; }
    }
    const qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w;
    out[0] = v; out[1] = w; out[2] = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/** The triangle nearest p within `reach`, with the barycentric weights of its corners 1 and 2, or -1. */
function nearest(s: MeshSurface, px: number, py: number, pz: number, reach: number, out: Float64Array, stack: Int32Array): number {
    const b = s.bvh;
    let best = -1, bestD = reach * reach, bv = 0, bw = 0;
    let top = 0;
    stack[top++] = 0;
    const tmp = out;
    while (top) {
        const node = stack[--top]!;
        let d = 0;
        for (let a = 0; a < 3; a++) {
            const v = a === 0 ? px : a === 1 ? py : pz;
            const lo = b.min[node * 3 + a]!, hi = b.max[node * 3 + a]!;
            if (v < lo) d += (lo - v) ** 2; else if (v > hi) d += (v - hi) ** 2;
        }
        if (d > bestD) continue;
        const c = b.child[node]!;
        if (c < 0) {
            for (let i = b.start[node]!; i < b.start[node]! + b.count[node]!; i++) {
                const t = b.order[i]!;
                closestOnTriangle(s.corners, t, px, py, pz, tmp);
                if (tmp[2]! < bestD) { bestD = tmp[2]!; best = t; bv = tmp[0]!; bw = tmp[1]!; }
            }
        } else if (top + 2 <= stack.length) { stack[top++] = c; stack[top++] = c + 1; }
    }
    out[0] = bv; out[1] = bw; out[2] = bestD;
    return best;
}

// ─── Strands onto the mesh ──────────────────────────────────────────────────────────────────────────────────────────────────

export type TraceType = 'outside' | 'inside' | 'both';

export interface StrandsProjectionOptions {
    /** Which way from the surface a strand is looked for: outside it (fur, a beard), inside it (a hair shell or cards over the hair), or either. */
    trace?: TraceType;
    /** How far from the surface, in metres, a strand is still laid onto it. */
    traceDistance?: number;
    /** The groups to lay on; absent, every group. */
    groups?: number[];
}

/** Strands laid onto a mesh's UVs, a segment at a time: what the strands textures are drawn from. */
export interface ProjectedStrands {
    count: number;
    /**
     * {@link SEGMENT_FLOATS} per segment: u0, v0, u1, v1, its half width in UV, how much of that width it covers (0..1; a strand
     * narrower than a texel is drawn a texel wide at that share), depth (0..1 of the trace distance), tangent x, y, z (-1..1), how far
     * along its strand (0..1), the strand's own value (0..1), and its root's UV.
     */
    data: Float32Array;
}

export const SEGMENT_FLOATS = 14;

function strandsOf(curves: GroomCurves, groups: number[] | undefined): CurveSet[] {
    return curves.groups.filter((_, i) => !groups || groups.length === 0 || groups.includes(i)).map((g) => g.strands);
}

/** Lays every strand point of `curves` within reach onto `surface`, and joins the neighbours that landed near each other into segments. */
export function projectStrands(curves: GroomCurves, surface: MeshSurface, resolution: number, opts: StrandsProjectionOptions = {}): ProjectedStrands {
    const trace = opts.trace ?? 'both';
    const reach = Math.max(opts.traceDistance ?? 0.03, 1e-6);
    const out: number[] = [];
    const q = new Float64Array(3);
    const stack = new Int32Array(256);
    // One point's landing: u, v, depth share, triangle, tangent-space direction filled after.
    let pu = 0, pv = 0, pDepth = 0, pTri = -1;
    let strandId = 0;
    for (const set of strandsOf(curves, opts.groups)) {
        let first = 0;
        for (let c = 0; c < set.counts.length; c++) {
            const n = set.counts[c]!;
            const seed = hash01(strandId++);
            const ru = set.rootUV ? set.rootUV[c * 2]! : 0, rv = set.rootUV ? set.rootUV[c * 2 + 1]! : 0;
            let prevOk = false;
            for (let k = 0; k < n; k++) {
                const i = (first + k) * 3;
                const px = set.positions[i]!, py = set.positions[i + 1]!, pz = set.positions[i + 2]!;
                const t = nearest(surface, px, py, pz, reach, q, stack);
                let ok = false, u = 0, v = 0, depth = 0;
                if (t >= 0) {
                    const o = t * 9, w1 = q[0]!, w2 = q[1]!, w0 = 1 - w1 - w2;
                    const qx = surface.corners[o]! * w0 + surface.corners[o + 3]! * w1 + surface.corners[o + 6]! * w2;
                    const qy = surface.corners[o + 1]! * w0 + surface.corners[o + 4]! * w1 + surface.corners[o + 7]! * w2;
                    const qz = surface.corners[o + 2]! * w0 + surface.corners[o + 5]! * w1 + surface.corners[o + 8]! * w2;
                    const signed = (px - qx) * surface.frames[o]! + (py - qy) * surface.frames[o + 1]! + (pz - qz) * surface.frames[o + 2]!;
                    ok = trace === 'both' || (trace === 'outside' ? signed >= -1e-6 : signed <= 1e-6);
                    const uo = t * 6;
                    u = surface.uvs[uo]! * w0 + surface.uvs[uo + 2]! * w1 + surface.uvs[uo + 4]! * w2;
                    v = surface.uvs[uo + 1]! * w0 + surface.uvs[uo + 3]! * w1 + surface.uvs[uo + 5]! * w2;
                    depth = Math.min(1, Math.sqrt(q[2]!) / reach);
                }
                if (ok && prevOk && k > 0) {
                    // Across a UV seam the two ends land far apart in UV however near they are on the mesh: no segment between them.
                    const du = u - pu, dv = v - pv;
                    const j = (first + k - 1) * 3;
                    const sx = px - set.positions[j]!, sy = py - set.positions[j + 1]!, sz = pz - set.positions[j + 2]!;
                    const mpu = surface.metresPerUv[pTri]!;
                    // Where the segment should land, carried across the triangle it starts on; landing far from there is a seam.
                    const J = pTri * 6;
                    const eu = surface.uvPerMetre[J]! * sx + surface.uvPerMetre[J + 1]! * sy + surface.uvPerMetre[J + 2]! * sz;
                    const ev = surface.uvPerMetre[J + 3]! * sx + surface.uvPerMetre[J + 4]! * sy + surface.uvPerMetre[J + 5]! * sz;
                    const off = Math.sqrt((du - eu) ** 2 + (dv - ev) ** 2), expected = Math.sqrt(eu * eu + ev * ev);
                    if (off <= expected * 0.75 + 2 / resolution) {
                        // The direction in the tangent space of the triangle the segment starts on.
                        const f = pTri * 9;
                        const tx = sx * surface.frames[f + 3]! + sy * surface.frames[f + 4]! + sz * surface.frames[f + 5]!;
                        const ty = sx * surface.frames[f + 6]! + sy * surface.frames[f + 7]! + sz * surface.frames[f + 8]!;
                        const tz = sx * surface.frames[f]! + sy * surface.frames[f + 1]! + sz * surface.frames[f + 2]!;
                        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
                        const width = (set.radii[first + k - 1]! + set.radii[first + k]!) ; // two half widths averaged, doubled
                        const texels = (width / mpu) * resolution;
                        const half = Math.max(texels, 1) / resolution / 2;
                        out.push(pu, pv, u, v, half, Math.min(1, texels), (pDepth + depth) / 2, tx / tl, ty / tl, tz / tl, (k - 0.5) / (n - 1), seed, ru, rv);
                    }
                }
                prevOk = ok;
                if (ok) { pu = u; pv = v; pDepth = depth; pTri = t; }
            }
            first += n;
        }
    }
    return { count: out.length / SEGMENT_FLOATS, data: Float32Array.from(out) };
}

function hash01(i: number): number {
    let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
}

// ─── Drawn on the GPU ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** RGBA bytes, rows from the top (v = 1) down, as a PNG is written. */
export interface BakedTexture { width: number; height: number; rgba: Uint8Array }

/** Column-major orthographic projection over [0,1]^2, as RenderTexture.begin wants it. */
const UV_SPACE = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, -1, -1, 0, 1]);
/** Opens a pass into `target` that writes data (no post chain, no colour encoding), cleared to `clear` as it is. */
function openDataPass(target: RenderTextureHandle, clear: readonly [number, number, number, number]): void {
    // Bit 1 clears colour, 4 marks the pass as data: its clear is not decoded as a colour either.
    Renderer.begin(UV_SPACE, target._handle, 1 | 4, { x: clear[0], y: clear[1], z: clear[2], w: clear[3] });
}

/** Segments a draw: the immediate draw copies each batch, and a head of hair is a million. */
const BATCH = 16384;

type Colour = (seg: Float32Array, at: number, out: Float32Array) => void;

/**
 * A number as a vertex colour that reaches the target as that number. A linear project reads vertex colours as sRGB and decodes them,
 * so the number goes in encoded; alpha is never encoded.
 */
function asVertexColour(): (v: number) => number {
    if (!linearColorSpace()) return (v) => v;
    return (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
}

/** Draws `count` segments of `data` into `target` as quads in UV space, each its own colour. */
function drawSegments(target: RenderTextureHandle, data: Float32Array, order: Int32Array, blend: BlendMode, colour: Colour, clear: [number, number, number, number]): void {
    const enc = asVertexColour();
    openDataPass(target, clear);
    Draw.begin(UV_SPACE);
    Renderer.setViewport(0, 0, target.width, target.height);
    Draw.setBlendMode(blend);
    const c = new Float32Array(4);
    for (let from = 0; from < order.length; from += BATCH) {
        const n = Math.min(BATCH, order.length - from);
        const positions = new Float32Array(n * 8), colors = new Float32Array(n * 16), indices = new Uint32Array(n * 6);
        for (let s = 0; s < n; s++) {
            const at = order[from + s]! * SEGMENT_FLOATS;
            const u0 = data[at]!, v0 = data[at + 1]!, u1 = data[at + 2]!, v1 = data[at + 3]!, h = data[at + 4]!;
            let dx = u1 - u0, dy = v1 - v0;
            const l = Math.sqrt(dx * dx + dy * dy) || 1;
            dx /= l; dy /= l;
            // Across, by the half width; and a half width further along at each end, so segments meet.
            const nx = -dy * h, ny = dx * h, ex = dx * h, ey = dy * h;
            positions.set([u0 - nx - ex, v0 - ny - ey, u0 + nx - ex, v0 + ny - ey, u1 + nx + ex, v1 + ny + ey, u1 - nx + ex, v1 - ny + ey], s * 8);
            colour(data, at, c);
            c[0] = enc(c[0]!); c[1] = enc(c[1]!); c[2] = enc(c[2]!);
            for (let k = 0; k < 4; k++) colors.set(c, s * 16 + k * 4);
            const b = s * 4;
            indices.set([b, b + 1, b + 2, b, b + 2, b + 3], s * 6);
        }
        Draw.triangles({ positions, colors, indices });
    }
    Draw.end();
    RenderTexture.end();
}

/** What a target holds, rows from the top. */
async function readTarget(module: ESEngineModule, target: RenderTextureHandle): Promise<BakedTexture> {
    const px = await captureTargetPixels(module, target._handle, target.width, target.height);
    if (!px) throw new Error('the engine could not read the baked texture back');
    const w = px.width, h = px.height, rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) rgba.set(px.rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return { width: w, height: h, rgba };
}

const pow2 = (n: number): number => 2 ** Math.round(Math.log2(Math.min(8192, Math.max(16, n))));

/** The four strands textures, drawn on the GPU at `resolution` (rounded to a power of two). */
export async function bakeStrandsTextures(module: ESEngineModule, projected: ProjectedStrands, resolution: number):
Promise<{ depth: BakedTexture; coverage: BakedTexture; tangent: BakedTexture; attribute: BakedTexture }> {
    const size = pow2(resolution);
    const target = RenderTexture.create({ width: size, height: size, depth: false, filter: 'nearest' });
    if (!target._handle) throw new Error('the engine could not make a render target to bake into');
    try {
        const d = projected.data;
        // Far strands first, so the one nearest the surface is what a texel keeps.
        const order = Int32Array.from({ length: projected.count }, (_, i) => i).sort((a, b) => d[b * SEGMENT_FLOATS + 6]! - d[a * SEGMENT_FLOATS + 6]!);
        drawSegments(target, d, order, BlendMode.None, (s, at, c) => { const v = s[at + 6]!; c.set([v, v, v, 1]); }, [1, 1, 1, 1]);
        const depth = await readTarget(module, target);
        // Coverage adds up: each strand adds its share of the texel (One, One), and a texel crossed by enough of them is covered.
        drawSegments(target, d, order, BlendMode.PmaAdditive, (s, at, c) => { const v = s[at + 5]!; c.set([v, v, v, 1]); }, [0, 0, 0, 1]);
        const coverage = await readTarget(module, target);
        drawSegments(target, d, order, BlendMode.None, (s, at, c) => c.set([s[at + 7]! * 0.5 + 0.5, s[at + 8]! * 0.5 + 0.5, s[at + 9]! * 0.5 + 0.5, 1]), [0.5, 0.5, 1, 1]);
        const tangent = await readTarget(module, target);
        drawSegments(target, d, order, BlendMode.None, (s, at, c) => c.set([s[at + 10]!, s[at + 11]!, s[at + 12]!, s[at + 13]!]), [0, 0, 0, 0]);
        const attribute = await readTarget(module, target);
        return { depth, coverage, tangent, attribute };
    } finally {
        RenderTexture.release(target);
    }
}

/** One groom of a follicle mask: its root UVs, and the channel (0 R .. 3 A) it is written to. */
export interface FollicleGroom { curves: GroomCurves; channel: 0 | 1 | 2 | 3; groups?: number[] }

/**
 * The follicle mask: round every root, at its root UV, a distance field `rootRadius` texels across (1 at the root, 0 at the rim),
 * each groom in its channel; where roots crowd, the nearest one counts. Drawn on the GPU at `resolution` (a power of two).
 */
export async function bakeFollicleMask(module: ESEngineModule, grooms: FollicleGroom[], resolution: number, rootRadius: number): Promise<BakedTexture> {
    const size = pow2(resolution);
    const target = RenderTexture.create({ width: size, height: size, depth: false, filter: 'nearest' });
    if (!target._handle) throw new Error('the engine could not make a render target to bake into');
    const r = Math.max(0.5, rootRadius) / size;
    const SIDES = 8, RINGS = 4;
    const enc = asVertexColour();
    try {
        // Alpha is a channel like the others where a groom is written to it; where none is, it is opaque, so the mask shows as a picture.
        openDataPass(target, [0, 0, 0, grooms.some((g) => g.channel === 3) ? 0 : 1]);
        Draw.begin(UV_SPACE);
        Renderer.setViewport(0, 0, size, size);
        // The brightest wins per channel (max): a root's field is not added to its neighbour's.
        Draw.setBlendMode(BlendMode.Lighten);
        for (const groom of grooms) {
            const roots: number[] = [];
            for (const set of strandsOf(groom.curves, groom.groups)) {
                if (!set.rootUV) throw new Error('a groom of the follicle mask has no root UVs: its curves carry none');
                for (let c = 0; c < set.counts.length; c++) roots.push(set.rootUV[c * 2]!, set.rootUV[c * 2 + 1]!);
            }
            const ch = groom.channel;
            for (let from = 0; from < roots.length / 2; from += BATCH) {
                const n = Math.min(BATCH, roots.length / 2 - from);
                // A centre and RINGS rings of SIDES points, each ring at its own value: the field falls evenly from the root to the rim
                // whatever the colour space does between two vertices.
                const verts = 1 + RINGS * SIDES;
                const positions = new Float32Array(n * verts * 2), colors = new Float32Array(n * verts * 4), indices = new Uint32Array(n * SIDES * (2 * RINGS - 1) * 3);
                let ix = 0;
                for (let i = 0; i < n; i++) {
                    const u = roots[(from + i) * 2]!, v = roots[(from + i) * 2 + 1]!;
                    const b = i * verts;
                    positions[b * 2] = u; positions[b * 2 + 1] = v;
                    colors[b * 4 + ch] = enc(1);
                    for (let ring = 1; ring <= RINGS; ring++) {
                        const f = ring / RINGS;
                        for (let k = 0; k < SIDES; k++) {
                            const a = (k / SIDES) * Math.PI * 2, at = b + 1 + (ring - 1) * SIDES + k;
                            positions[at * 2] = u + Math.cos(a) * r * f;
                            positions[at * 2 + 1] = v + Math.sin(a) * r * f;
                            colors[at * 4 + ch] = enc(1 - f);
                        }
                    }
                    for (let k = 0; k < SIDES; k++) {
                        const k1 = (k + 1) % SIDES;
                        indices[ix++] = b; indices[ix++] = b + 1 + k; indices[ix++] = b + 1 + k1;
                        for (let ring = 1; ring < RINGS; ring++) {
                            const inner = b + 1 + (ring - 1) * SIDES, outer = inner + SIDES;
                            indices[ix++] = inner + k; indices[ix++] = outer + k; indices[ix++] = outer + k1;
                            indices[ix++] = inner + k; indices[ix++] = outer + k1; indices[ix++] = inner + k1;
                        }
                    }
                }
                Draw.triangles({ positions, colors, indices });
            }
        }
        Draw.end();
        RenderTexture.end();
        return await readTarget(module, target);
    } finally {
        RenderTexture.release(target);
    }
}
