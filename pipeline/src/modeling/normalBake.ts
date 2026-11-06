// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  normalBake.ts — the detail of a dense surface, as a normal map on a light one.
 *
 *        From each texel's point on the light surface a line runs along its normal, both
 *        ways, to the nearest place on the dense surface facing the same way; the dense
 *        surface's normal there is written in the frame the mesh carries. That frame is
 *        the one MESH_TANGENTS reads the map in (perturbNormal in ShaderParser.cpp): the
 *        tangent made square to the interpolated normal, and the bitangent as
 *        cross(N, T) * w. The two must stay the same arithmetic, or the map bends light
 *        the wrong way with nothing to say so.
 *
 *        A separate call from bakeModel because it costs seconds, and only a write wants it.
 */
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { cornerNormals, type BakedModel } from './modelBake';
import { triangulateFace } from './triangulate';
import { boundsOf, type PolyMesh } from './polyMesh';

/** How far the line runs when the source does not say, as a share of the model's diagonal. */
const DEFAULT_DISTANCE = 0.05;
/** Texels past each chart's edge that take its values: what bilinear reads and the small mips average there. */
const GUTTER = 16;
const LEAF = 4;
/** Above this share of texels finding no surface, the map is probably missing what it was made for. */
const MISSED_WARNING = 0.05;
/** Degrees of mean bend past which a map is mostly slopes too steep to shade. */
const STEEP_BEND = 25;
/** Share of the image below which the surface broke into so many pieces that the map's resolution is mostly gone. */
const SPARSE_COVERAGE = 0.1;

export interface NormalBakeReport {
    size: number;
    /** Triangles on the dense surface and on the light one. */
    from: number;
    to: number;
    /** Share of the image the mesh's charts cover. */
    coverage: number;
    /** Share of those texels that found no surface within `distance`, and were left flat. */
    missed: number;
    /** How far the line ran. */
    distance: number;
    /** Mean bend the map adds, in degrees: near 0 means it says nothing. */
    meanBend: number;
}

export interface NormalMap {
    size: number;
    /** RGBA, row by row from the top: what a PNG holds. Data, not colour: it must be read without sRGB decoding. */
    rgba: Uint8Array;
    report: NormalBakeReport;
    warnings: string[];
}

/** A bounding-volume hierarchy over triangles, in flat arrays: a dense model is several hundred thousand of them. */
class TriangleTree {
    private readonly order: Int32Array;
    private readonly boxes: Float64Array;
    /** Per node: a leaf's first triangle in `order` and its count, or the right child and 0. */
    private readonly links: Int32Array;
    private nodes = 0;
    private readonly stack = new Int32Array(128);

    constructor(private readonly corners: Float64Array) {
        const count = corners.length / 9;
        this.order = Int32Array.from({ length: count }, (_, i) => i);
        this.boxes = new Float64Array(count * 2 * 6 + 6);
        this.links = new Int32Array(count * 2 * 2 + 2);
        const centers = new Float64Array(count * 3);
        for (let t = 0; t < count; t++) {
            for (let k = 0; k < 3; k++) centers[t * 3 + k] = (corners[t * 9 + k]! + corners[t * 9 + 3 + k]! + corners[t * 9 + 6 + k]!) / 3;
        }
        this.build(0, count, centers);
    }

    private build(first: number, count: number, centers: Float64Array): number {
        const node = this.nodes++;
        const [boxes, order, corners] = [this.boxes, this.order, this.corners];
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        const cLo = [Infinity, Infinity, Infinity], cHi = [-Infinity, -Infinity, -Infinity];
        for (let i = first; i < first + count; i++) {
            const t = order[i]!;
            for (let k = 0; k < 3; k++) {
                for (let c = 0; c < 3; c++) {
                    const x = corners[t * 9 + c * 3 + k]!;
                    if (x < lo[k]!) lo[k] = x;
                    if (x > hi[k]!) hi[k] = x;
                }
                const m = centers[t * 3 + k]!;
                if (m < cLo[k]!) cLo[k] = m;
                if (m > cHi[k]!) cHi[k] = m;
            }
        }
        for (let k = 0; k < 3; k++) { boxes[node * 6 + k] = lo[k]!; boxes[node * 6 + 3 + k] = hi[k]!; }
        const axis = cHi[0]! - cLo[0]! >= cHi[1]! - cLo[1]! && cHi[0]! - cLo[0]! >= cHi[2]! - cLo[2]! ? 0 : cHi[1]! - cLo[1]! >= cHi[2]! - cLo[2]! ? 1 : 2;
        if (count <= LEAF || cHi[axis]! - cLo[axis]! <= 0) {
            this.links[node * 2] = first;
            this.links[node * 2 + 1] = count;
            return node;
        }
        const half = (cLo[axis]! + cHi[axis]!) / 2;
        let split = first;
        for (let i = first; i < first + count; i++) {
            if (centers[order[i]! * 3 + axis]! < half) {
                const swap = order[i]!;
                order[i] = order[split]!;
                order[split] = swap;
                split++;
            }
        }
        this.build(first, split - first, centers);
        this.links[node * 2] = this.build(split, first + count - split, centers);
        this.links[node * 2 + 1] = 0;
        return node;
    }

    /**
     * The hit on the line through @p o along @p d nearest to @p o, within @p reach either way, on a triangle
     * facing along @p d. Answers its triangle, or -1; the place on it goes in @p out as [u, v] for its 2nd and 3rd corners.
     */
    nearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, out: Float64Array): number {
        const [boxes, links, order, c, stack] = [this.boxes, this.links, this.order, this.corners, this.stack];
        let best = reach, found = -1, top = 0;
        stack[top++] = 0;
        while (top > 0) {
            const node = stack[--top]!;
            const at = node * 6;
            let near = -best, far = best;
            let inside = true;
            for (let k = 0; k < 3 && inside; k++) {
                const d = k === 0 ? dx : k === 1 ? dy : dz, o = k === 0 ? ox : k === 1 ? oy : oz;
                const lo = boxes[at + k]!, hi = boxes[at + 3 + k]!;
                if (d === 0) { inside = o >= lo && o <= hi; continue; }
                let t0 = (lo - o) / d, t1 = (hi - o) / d;
                if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
                if (t0 > near) near = t0;
                if (t1 < far) far = t1;
                inside = near <= far;
            }
            if (!inside) continue;
            const count = links[node * 2 + 1]!;
            if (count === 0) {
                stack[top++] = links[node * 2]!;
                stack[top++] = node + 1;
                continue;
            }
            const first = links[node * 2]!;
            for (let i = first; i < first + count; i++) {
                const t = order[i]!, p = t * 9;
                const ax = c[p]!, ay = c[p + 1]!, az = c[p + 2]!;
                const e1x = c[p + 3]! - ax, e1y = c[p + 4]! - ay, e1z = c[p + 5]! - az;
                const e2x = c[p + 6]! - ax, e2y = c[p + 7]! - ay, e2z = c[p + 8]! - az;
                const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                const det = e1x * px + e1y * py + e1z * pz;
                // Negative is the line running along the triangle's outward normal: the inner wall of a thin part is not this surface.
                if (det > -1e-14) continue;
                const inv = 1 / det;
                const sx = ox - ax, sy = oy - ay, sz = oz - az;
                const u = (sx * px + sy * py + sz * pz) * inv;
                if (u < 0 || u > 1) continue;
                const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
                const v = (dx * qx + dy * qy + dz * qz) * inv;
                if (v < 0 || u + v > 1) continue;
                const along = (e2x * qx + e2y * qy + e2z * qz) * inv;
                if (Math.abs(along) < best) {
                    best = Math.abs(along);
                    found = t;
                    out[0] = u;
                    out[1] = v;
                }
            }
        }
        return found;
    }
}

/** Reads the channels the bake needs off the baked mesh, wherever the layout put them. */
function readFloats(mesh: MeshData, semantic: number, components: number): Float32Array {
    const channel = mesh.channels.find((c) => c.semantic === semantic && c.type === MeshChannelType.Float32);
    if (!channel) throw new Error(`the mesh has no float channel ${semantic}`);
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const out = new Float32Array(mesh.vertexCount * components);
    for (let v = 0; v < mesh.vertexCount; v++) {
        for (let k = 0; k < components; k++) out[v * components + k] = view.getFloat32(v * mesh.vertexStride + channel.offset + k * 4, true);
    }
    return out;
}

/** The dense surface as flat triangles, and the shading normal at each of their corners. */
function denseSurface(high: PolyMesh, smoothAngle: number): { corners: Float64Array; normals: Float64Array } {
    const normalsOf = cornerNormals(high, smoothAngle);
    const positions: number[] = [], normals: number[] = [];
    high.faces.forEach((face, f) => {
        for (const tri of triangulateFace(high, face)) {
            for (const v of tri) {
                positions.push(...high.positions[v]!);
                normals.push(...normalsOf[f]![face.v.indexOf(v)]!);
            }
        }
    });
    return { corners: Float64Array.from(positions), normals: Float64Array.from(normals) };
}

/** Bakes @p model's `normalBake`. Throws if it has none. */
export function bakeNormalMap(model: BakedModel): NormalMap {
    const detail = model.detail;
    if (!detail) throw new Error('this model has no normalBake');
    const { size, high, smoothAngle } = detail;
    const { min, max } = boundsOf(high);
    const distance = detail.distance ?? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * DEFAULT_DISTANCE;
    const { corners, normals } = denseSurface(high, smoothAngle);
    const tree = new TriangleTree(corners);

    const mesh = model.data;
    const P = readFloats(mesh, MeshChannel.Position, 3);
    const N = readFloats(mesh, MeshChannel.Normal, 3);
    const T = readFloats(mesh, MeshChannel.Tangent, 4);
    const UV = readFloats(mesh, MeshChannel.TexCoord0, 2);

    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) { rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
    const covered = new Uint8Array(size * size);
    const place = new Float64Array(2);
    let hits = 0, missed = 0, bend = 0;

    for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
        const [a, b, c] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
        // A texture's rows run down from the top and the engine's v runs up from the bottom.
        const ax = UV[a * 2]! * size, ay = (1 - UV[a * 2 + 1]!) * size;
        const bx = UV[b * 2]! * size, by = (1 - UV[b * 2 + 1]!) * size;
        const cx = UV[c * 2]! * size, cy = (1 - UV[c * 2 + 1]!) * size;
        const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        if (Math.abs(area) < 1e-12) continue;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const texel = y * size + x;
                if (covered[texel]) continue;
                const px = x + 0.5, py = y + 0.5;
                const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
                const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                covered[texel] = 1;

                let nx = w0 * N[a * 3]! + w1 * N[b * 3]! + w2 * N[c * 3]!;
                let ny = w0 * N[a * 3 + 1]! + w1 * N[b * 3 + 1]! + w2 * N[c * 3 + 1]!;
                let nz = w0 * N[a * 3 + 2]! + w1 * N[b * 3 + 2]! + w2 * N[c * 3 + 2]!;
                const nl = Math.hypot(nx, ny, nz) || 1;
                nx /= nl; ny /= nl; nz /= nl;
                const hit = tree.nearest(
                    w0 * P[a * 3]! + w1 * P[b * 3]! + w2 * P[c * 3]!,
                    w0 * P[a * 3 + 1]! + w1 * P[b * 3 + 1]! + w2 * P[c * 3 + 1]!,
                    w0 * P[a * 3 + 2]! + w1 * P[b * 3 + 2]! + w2 * P[c * 3 + 2]!,
                    nx, ny, nz, distance, place,
                );
                if (hit < 0) { missed++; continue; }
                hits++;

                const [hv, hw] = [place[0]!, place[1]!];
                const hu = 1 - hv - hw;
                const at = hit * 9;
                let sx = hu * normals[at]! + hv * normals[at + 3]! + hw * normals[at + 6]!;
                let sy = hu * normals[at + 1]! + hv * normals[at + 4]! + hw * normals[at + 7]!;
                let sz = hu * normals[at + 2]! + hv * normals[at + 5]! + hw * normals[at + 8]!;
                const sl = Math.hypot(sx, sy, sz) || 1;
                sx /= sl; sy /= sl; sz /= sl;

                // The frame the shader builds, in the order it builds it.
                const tx = w0 * T[a * 4]! + w1 * T[b * 4]! + w2 * T[c * 4]!;
                const ty = w0 * T[a * 4 + 1]! + w1 * T[b * 4 + 1]! + w2 * T[c * 4 + 1]!;
                const tz = w0 * T[a * 4 + 2]! + w1 * T[b * 4 + 2]! + w2 * T[c * 4 + 2]!;
                const handed = w0 * T[a * 4 + 3]! + w1 * T[b * 4 + 3]! + w2 * T[c * 4 + 3]!;
                const lean = tx * nx + ty * ny + tz * nz;
                let gx = tx - nx * lean, gy = ty - ny * lean, gz = tz - nz * lean;
                const gl = Math.hypot(gx, gy, gz) || 1;
                gx /= gl; gy /= gl; gz /= gl;
                const ex = (ny * gz - nz * gy) * handed, ey = (nz * gx - nx * gz) * handed, ez = (nx * gy - ny * gx) * handed;

                const u = sx * gx + sy * gy + sz * gz;
                const v = sx * ex + sy * ey + sz * ez;
                const w = sx * nx + sy * ny + sz * nz;
                bend += Math.acos(Math.max(-1, Math.min(1, w)));
                rgba[texel * 4] = Math.round((u * 0.5 + 0.5) * 255);
                rgba[texel * 4 + 1] = Math.round((v * 0.5 + 0.5) * 255);
                rgba[texel * 4 + 2] = Math.round((Math.max(w, 0) * 0.5 + 0.5) * 255);
            }
        }
    }
    const inside = hits + missed;
    dilate(rgba, covered, size);

    const from = corners.length / 9, to = mesh.indices.length / 3;
    const warnings: string[] = [];
    const missedShare = inside ? missed / inside : 1;
    if (missedShare > MISSED_WARNING) warnings.push(`${Math.round(missedShare * 100)}% of the normal map found no surface within ${distance.toPrecision(3)} and is flat: raise normalBake.distance, or decimate less`);
    if (hits && (bend / hits) * 180 / Math.PI > STEEP_BEND) warnings.push(`the map bends light by ${Math.round((bend / hits) * 180 / Math.PI)} degrees on average, steeper than a normal map draws well: dark bands and lost shape. Lower the amplitude of a displace against its scale`);
    if (inside / (size * size) < SPARSE_COVERAGE) warnings.push(`the surface broke into so many pieces that they fill only ${Math.round((inside / (size * size)) * 100)}% of the map, so most of its resolution is lost: lower the amplitude before the decimate, or keep more triangles`);
    if (from <= to) warnings.push(`the surface baked from has ${from} triangles and this one ${to}: there is no detail to carry. normalBake.from should name a step before the decimate`);
    return {
        size, rgba, warnings,
        report: {
            size, from, to,
            coverage: Math.round((inside / (size * size)) * 1000) / 1000,
            missed: Math.round(missedShare * 1000) / 1000,
            distance: Number(distance.toPrecision(4)),
            meanBend: hits ? Math.round(((bend / hits) * 180 / Math.PI) * 100) / 100 : 0,
        },
    };
}

/** Spreads each chart's edge outward, nearest first. */
function dilate(rgba: Uint8Array, covered: Uint8Array, size: number): void {
    let edge: number[] = [];
    for (let i = 0; i < covered.length; i++) if (covered[i]) edge.push(i);
    for (let pass = 0; pass < GUTTER && edge.length > 0; pass++) {
        const next: number[] = [];
        for (const i of edge) {
            const x = i % size, y = (i - x) / size;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const [qx, qy] = [x + dx, y + dy];
                    if (qx < 0 || qy < 0 || qx >= size || qy >= size) continue;
                    const q = qy * size + qx;
                    if (covered[q]) continue;
                    covered[q] = 1;
                    rgba[q * 4] = rgba[i * 4]!;
                    rgba[q * 4 + 1] = rgba[i * 4 + 1]!;
                    rgba[q * 4 + 2] = rgba[i * 4 + 2]!;
                    next.push(q);
                }
            }
        }
        edge = next;
    }
}
