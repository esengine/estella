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
import { TriangleTree } from './triangleTree';
import { triangulateFace } from './triangulate';
import { boundsOf, type PolyMesh } from './polyMesh';

/** How far the line runs when the source does not say, as a share of the model's diagonal. */
const DEFAULT_DISTANCE = 0.05;
/** Texels past each chart's edge that take its values: what bilinear reads and the small mips average there. */
const GUTTER = 16;
/** Above this share of texels finding no surface, the map is probably missing what it was made for. */
const MISSED_WARNING = 0.05;
/** Degrees of mean bend past which a map is mostly slopes too steep to shade. */
const STEEP_BEND = 25;
const MIN_OCCLUSION_SIZE = 128;
const MAX_OCCLUSION_SIZE = 512;
/** How far a ray looks, as a share of the model's diagonal. */
const DEFAULT_OCCLUSION_REACH = 0.06;
const DEFAULT_OCCLUSION_SAMPLES = 25;
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
    /**
     * The dense surface's paint, with `normalBake.color`, laid out the same. Linear, as a vertex colour is, and so also
     * read without sRGB decoding: a vertex colour reaches the shader unconverted in a gamma project and a linear one
     * alike, so this reaches it as the same number in both.
     */
    colorRgba?: Uint8Array;
    /** The dense surface's roughness in green and metal in blue, with `normalBake.surface`: glTF's packing, which u_metallicRoughnessMap reads. */
    surfaceRgba?: Uint8Array;
    /** How much sky each texel sees, with `normalBake.occlusion`, grey. Smaller than the others: what it holds has no fine detail, and each texel costs dozens of rays. */
    occlusion?: { size: number; rgba: Uint8Array };
    report: NormalBakeReport;
    warnings: string[];
}

/** Every texel centre inside a triangle of the mesh, with the triangle's corners and how much of each it is. */
function rasterTexels(
    indices: ArrayLike<number>, UV: Float32Array, size: number,
    visit: (texel: number, a: number, b: number, c: number, w0: number, w1: number, w2: number) => void,
): void {
    for (let t = 0; t + 2 < indices.length; t += 3) {
        const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
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
                const px = x + 0.5, py = y + 0.5;
                const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
                const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                visit(y * size + x, a, b, c, w0, w1, w2);
            }
        }
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
function denseSurface(high: PolyMesh, smoothAngle: number, fallback: { roughness: number; metallic: number }): { corners: Float64Array; normals: Float64Array; colors: Uint8Array; surfaces: Uint8Array } {
    const normalsOf = cornerNormals(high, smoothAngle);
    let count = 0;
    for (const face of high.faces) count += Math.max(0, face.v.length - 2);
    const corners = new Float64Array(count * 9), normals = new Float64Array(count * 9);
    const colors = new Uint8Array(count * 4);
    const surfaces = new Uint8Array(count * 2);
    let t = 0;
    high.faces.forEach((face, f) => {
        const color = face.color ?? [1, 1, 1, 1];
        const bytes = [0, 1, 2, 3].map((k) => Math.round(Math.max(0, Math.min(1, color[k]!)) * 255));
        for (const tri of triangulateFace(high, face)) {
            tri.forEach((v, c) => {
                const [p, n] = [high.positions[v]!, normalsOf[f]![face.v.indexOf(v)]!];
                for (let k = 0; k < 3; k++) { corners[t * 9 + c * 3 + k] = p[k]!; normals[t * 9 + c * 3 + k] = n[k]!; }
            });
            colors.set(bytes, t * 4);
            surfaces[t * 2] = Math.round((face.roughness ?? fallback.roughness) * 255);
            surfaces[t * 2 + 1] = Math.round((face.metallic ?? fallback.metallic) * 255);
            t++;
        }
    });
    return { corners: t === count ? corners : corners.subarray(0, t * 9), normals, colors, surfaces };
}

/** Bakes @p model's `normalBake`. Throws if it has none. */
export function bakeNormalMap(model: BakedModel): NormalMap {
    const detail = model.detail;
    if (!detail) throw new Error('this model has no normalBake');
    const { size, high, smoothAngle } = detail;
    const { min, max } = boundsOf(high);
    const distance = detail.distance ?? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * DEFAULT_DISTANCE;
    const fallback = detail.surface ?? { roughness: 1, metallic: 0 };
    const { corners, normals, colors, surfaces } = denseSurface(high, smoothAngle, fallback);
    const tree = new TriangleTree(corners);

    const mesh = model.data;
    const P = readFloats(mesh, MeshChannel.Position, 3);
    const N = readFloats(mesh, MeshChannel.Normal, 3);
    const T = readFloats(mesh, MeshChannel.Tangent, 4);
    const UV = readFloats(mesh, MeshChannel.TexCoord0, 2);

    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) { rgba[i * 4] = 128; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
    const lowColors = detail.lowColors;
    const colorRgba = lowColors ? new Uint8Array(size * size * 4) : undefined;
    const surfaceRgba = detail.surface ? new Uint8Array(size * size * 4) : undefined;
    if (surfaceRgba) {
        // What the source says everything is, wherever no chart lands or no surface is found.
        for (let i = 0; i < size * size; i++) {
            surfaceRgba[i * 4] = 255;
            surfaceRgba[i * 4 + 1] = Math.round(fallback.roughness * 255);
            surfaceRgba[i * 4 + 2] = Math.round(fallback.metallic * 255);
            surfaceRgba[i * 4 + 3] = 255;
        }
    }
    const covered = new Uint8Array(size * size);
    const place = new Float64Array(2);
    let hits = 0, missed = 0, bend = 0;

    rasterTexels(mesh.indices, UV, size, (texel, a, b, c, w0, w1, w2) => {
            if (covered[texel]) return;
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
            if (hit < 0) {
                missed++;
                // No surface to read: what the thin mesh was painted itself.
                if (colorRgba) for (let k = 0; k < 4; k++) colorRgba[texel * 4 + k] = Math.round(w0 * lowColors![a * 4 + k]! + w1 * lowColors![b * 4 + k]! + w2 * lowColors![c * 4 + k]!);
                return;
            }
            hits++;
            if (colorRgba) colorRgba.set(colors.subarray(hit * 4, hit * 4 + 4), texel * 4);
            if (surfaceRgba) { surfaceRgba[texel * 4 + 1] = surfaces[hit * 2]!; surfaceRgba[texel * 4 + 2] = surfaces[hit * 2 + 1]!; }

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
    });
    const occlusion = detail.occlusion ? bakeOcclusion(tree, corners, normals, mesh.indices, P, N, UV, size, distance, detail.occlusion, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])) : undefined;
    const inside = hits + missed;
    dilate([rgba, ...(colorRgba ? [colorRgba] : []), ...(surfaceRgba ? [surfaceRgba] : [])], covered, size);

    const from = corners.length / 9, to = mesh.indices.length / 3;
    const warnings: string[] = [];
    const missedShare = inside ? missed / inside : 1;
    if (missedShare > MISSED_WARNING) warnings.push(`${Math.round(missedShare * 100)}% of the normal map found no surface within ${distance.toPrecision(3)} and is flat: raise normalBake.distance, or decimate less`);
    if (hits && (bend / hits) * 180 / Math.PI > STEEP_BEND) warnings.push(`the map bends light by ${Math.round((bend / hits) * 180 / Math.PI)} degrees on average, steeper than a normal map draws well: dark bands and lost shape. Lower the amplitude of a displace against its scale`);
    if (inside / (size * size) < SPARSE_COVERAGE) warnings.push(`the surface broke into so many pieces that they fill only ${Math.round((inside / (size * size)) * 100)}% of the map, so most of its resolution is lost: lower the amplitude before the decimate, or keep more triangles`);
    if (from <= to) warnings.push(`the surface baked from has ${from} triangles and this one ${to}: there is no detail to carry. normalBake.from should name a step before the decimate`);
    return {
        size, rgba, warnings, ...(colorRgba ? { colorRgba } : {}), ...(surfaceRgba ? { surfaceRgba } : {}), ...(occlusion ? { occlusion } : {}),
        report: {
            size, from, to,
            coverage: Math.round((inside / (size * size)) * 1000) / 1000,
            missed: Math.round(missedShare * 1000) / 1000,
            distance: Number(distance.toPrecision(4)),
            meanBend: hits ? Math.round(((bend / hits) * 180 / Math.PI) * 100) / 100 : 0,
        },
    };
}

/**
 * Cosine-weighted rays from the dense surface, not the thin one: the thin one has no creases to be shaded by. A short reach
 * keeps it to contact and crevices, which is what a sky's light misses; a long one is what a light does already.
 */
function bakeOcclusion(
    tree: TriangleTree, corners: Float64Array, normals: Float64Array, indices: ArrayLike<number>,
    P: Float32Array, N: Float32Array, UV: Float32Array, mainSize: number, distance: number,
    options: { size?: number; reach?: number; samples?: number }, diagonal: number,
): { size: number; rgba: Uint8Array } {
    const size = options.size ?? Math.max(MIN_OCCLUSION_SIZE, Math.min(MAX_OCCLUSION_SIZE, mainSize >> 2));
    const reach = options.reach ?? diagonal * DEFAULT_OCCLUSION_REACH;
    const samples = options.samples ?? DEFAULT_OCCLUSION_SAMPLES;
    const bias = diagonal * 2e-4;
    const values = new Float32Array(size * size).fill(-1);
    const place = new Float64Array(2);
    // One set of directions, turned per texel: a pattern the blur below can take out, and a bake that comes out the same every time.
    const side = Math.ceil(Math.sqrt(samples));
    rasterTexels(indices, UV, size, (texel, a, b, c, w0, w1, w2) => {
        if (values[texel]! >= 0) return;
        const nx0 = w0 * N[a * 3]! + w1 * N[b * 3]! + w2 * N[c * 3]!;
        const ny0 = w0 * N[a * 3 + 1]! + w1 * N[b * 3 + 1]! + w2 * N[c * 3 + 1]!;
        const nz0 = w0 * N[a * 3 + 2]! + w1 * N[b * 3 + 2]! + w2 * N[c * 3 + 2]!;
        const nl = Math.hypot(nx0, ny0, nz0) || 1;
        const hit = tree.nearest(
            w0 * P[a * 3]! + w1 * P[b * 3]! + w2 * P[c * 3]!,
            w0 * P[a * 3 + 1]! + w1 * P[b * 3 + 1]! + w2 * P[c * 3 + 1]!,
            w0 * P[a * 3 + 2]! + w1 * P[b * 3 + 2]! + w2 * P[c * 3 + 2]!,
            nx0 / nl, ny0 / nl, nz0 / nl, distance, place,
        );
        if (hit < 0) { values[texel] = 1; return; }
        const [hv, hw] = [place[0]!, place[1]!];
        const hu = 1 - hv - hw;
        const at = hit * 9;
        const px = hu * corners[at]! + hv * corners[at + 3]! + hw * corners[at + 6]!;
        const py = hu * corners[at + 1]! + hv * corners[at + 4]! + hw * corners[at + 7]!;
        const pz = hu * corners[at + 2]! + hv * corners[at + 5]! + hw * corners[at + 8]!;
        let sx = hu * normals[at]! + hv * normals[at + 3]! + hw * normals[at + 6]!;
        let sy = hu * normals[at + 1]! + hv * normals[at + 4]! + hw * normals[at + 7]!;
        let sz = hu * normals[at + 2]! + hv * normals[at + 5]! + hw * normals[at + 8]!;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        // Two axes square to the normal.
        let ux = Math.abs(sx) < 0.9 ? 0 : -sz, uy = Math.abs(sx) < 0.9 ? -sz : 0, uz = Math.abs(sx) < 0.9 ? sy : sx;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const vx = sy * uz - sz * uy, vy = sz * ux - sx * uz, vz = sx * uy - sy * ux;
        const turn = (texel * 0.61803398875) % 1;
        const [ox, oy, oz] = [px + sx * bias, py + sy * bias, pz + sz * bias];
        let open = 0, total = 0;
        for (let i = 0; i < side; i++) {
            for (let j = 0; j < side; j++) {
                const r = Math.sqrt((i + 0.5) / side);
                const phi = ((j + 0.5) / side + turn) * 2 * Math.PI;
                const [du, dv] = [r * Math.cos(phi), r * Math.sin(phi)];
                const dn = Math.sqrt(Math.max(0, 1 - r * r));
                total++;
                if (!tree.blocked(ox, oy, oz, ux * du + vx * dv + sx * dn, uy * du + vy * dv + sy * dn, uz * du + vz * dv + sz * dn, reach)) open++;
            }
        }
        values[texel] = open / total;
    });
    // A little blur, among texels on a surface: it takes out the turned pattern, and what this map holds has no edges to lose.
    const blurred = new Float32Array(size * size).fill(-1);
    const covered = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const texel = y * size + x;
            if (values[texel]! < 0) continue;
            covered[texel] = 1;
            let sum = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const [qx, qy] = [x + dx, y + dy];
                    if (qx < 0 || qy < 0 || qx >= size || qy >= size) continue;
                    const v = values[qy * size + qx]!;
                    if (v >= 0) { sum += v; n++; }
                }
            }
            blurred[texel] = sum / n;
        }
    }
    const rgba = new Uint8Array(size * size * 4).fill(255);
    for (let i = 0; i < size * size; i++) {
        if (blurred[i]! < 0) continue;
        const v = Math.round(blurred[i]! * 255);
        rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v;
    }
    dilate([rgba], covered, size);
    return { size, rgba };
}

/** Spreads each chart's edge outward through every image, nearest first. */
function dilate(images: readonly Uint8Array[], covered: Uint8Array, size: number): void {
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
                    for (const image of images) image.copyWithin(q * 4, i * 4, i * 4 + 4);
                    next.push(q);
                }
            }
        }
        edge = next;
    }
}
