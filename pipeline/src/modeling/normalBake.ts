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
import { MeshChannel, MeshChannelType, type MeshData } from '../../../sdk/src/asset/meshFormat';
import { cornerNormals, type BakedModel } from './modelBake';
import { TriangleTree } from './triangleTree';
import { triangulateFace } from './triangulate';
import { boundsOf, selectFaces, type PolyMesh, type Vec3 } from './polyMesh';
import { texelStain, type StainParams } from './stain';

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
    emissiveRgba?: Uint8Array;
    /** How much sky each texel sees, with `normalBake.occlusion`, grey. Smaller than the others: what it holds has no fine detail, and each texel costs dozens of rays. */
    occlusion?: { size: number; rgba: Uint8Array };
    report: NormalBakeReport;
    warnings: string[];
}

function texelWeights(UV: Float32Array, size: number, a: number, b: number, c: number, texel: number, out: Float64Array): boolean {
    const ax = UV[a * 2]! * size, ay = (1 - UV[a * 2 + 1]!) * size;
    const bx = UV[b * 2]! * size, by = (1 - UV[b * 2 + 1]!) * size;
    const cx = UV[c * 2]! * size, cy = (1 - UV[c * 2 + 1]!) * size;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return false;
    const px = texel % size + 0.5, py = Math.floor(texel / size) + 0.5;
    const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
    const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) return false;
    out[0] = w0; out[1] = w1; out[2] = w2;
    return true;
}

function rasterTexels(
    indices: ArrayLike<number>, UV: Float32Array, size: number,
    visit: (texel: number, a: number, b: number, c: number, w0: number, w1: number, w2: number, t: number) => void,
): void {
    const w = new Float64Array(3);
    for (let t = 0; t + 2 < indices.length; t += 3) {
        const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
        const ax = UV[a * 2]! * size, ay = (1 - UV[a * 2 + 1]!) * size;
        const bx = UV[b * 2]! * size, by = (1 - UV[b * 2 + 1]!) * size;
        const cx = UV[c * 2]! * size, cy = (1 - UV[c * 2 + 1]!) * size;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (texelWeights(UV, size, a, b, c, y * size + x, w)) visit(y * size + x, a, b, c, w[0]!, w[1]!, w[2]!, t);
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
function denseSurface(high: PolyMesh, smoothAngle: number, fallback: { roughness: number; metallic: number }): { corners: Float64Array; normals: Float64Array; colors: Uint8Array; surfaces: Uint8Array; faceOf: Int32Array; glows: Uint8Array | null } {
    const normalsOf = cornerNormals(high, smoothAngle);
    let count = 0;
    for (const face of high.faces) count += Math.max(0, face.v.length - 2);
    const corners = new Float64Array(count * 9), normals = new Float64Array(count * 9);
    const colors = new Uint8Array(count * 4);
    const surfaces = new Uint8Array(count * 2);
    const faceOf = new Int32Array(count);
    const glows = high.faces.some((face) => face.glow) ? new Uint8Array(count) : null;
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
            faceOf[t] = f;
            if (glows) glows[t] = Math.round(Math.max(0, Math.min(1, face.glow ?? 0)) * 255);
            t++;
        }
    });
    return { corners: t === count ? corners : corners.subarray(0, t * 9), normals, colors, surfaces, faceOf, glows };
}

export const RELIEF_RINGS = [[1, 16], [0.6, 10], [0.3, 6]] as const;
const DEFAULT_RELIEF_REACH = 0.01;
export const RELIEF_FLAT = 0.02;

export const RELIEF_SPOKES = RELIEF_RINGS.flatMap(([share, spokes]) => Array.from({ length: spokes }, (_, j) => {
    const phi = ((j + 0.5) / spokes) * 2 * Math.PI;
    return { share, cos: Math.cos(phi), sin: Math.sin(phi) };
}));
const RELIEF_NEIGHBOURS = 768;
const RELIEF_CELLS = 8;
const RELIEF_MARGIN = 1e-6;
const SPOKES_BY_CELL = Array.from({ length: RELIEF_CELLS * RELIEF_CELLS }, (_, cell) => {
    const [column, row] = [cell % RELIEF_CELLS, Math.floor(cell / RELIEF_CELLS)];
    const inside = (at: number, i: number): boolean => Math.min(RELIEF_CELLS - 1, Math.floor((at + 1) * RELIEF_CELLS / 2)) === i;
    return RELIEF_SPOKES.flatMap((spoke, j) => (inside(spoke.share * spoke.cos, column) && inside(spoke.share * spoke.sin, row) ? [j] : []));
});

export interface ReliefScratch {
    near: Int32Array;
    hit: Float64Array;
    origin: Float64Array;
    spoke: Float64Array;
    best: Float64Array;
    found: Int32Array;
    place: Float64Array;
}

export function reliefScratch(neighbours = RELIEF_NEIGHBOURS): ReliefScratch {
    const count = RELIEF_SPOKES.length;
    return { near: new Int32Array(neighbours), hit: new Float64Array(2), origin: new Float64Array(count * 3), spoke: new Float64Array(count * 3), best: new Float64Array(count), found: new Int32Array(count), place: new Float64Array(count * 2) };
}

export function reliefAt(tree: TriangleTree, corners: Float64Array, px: number, py: number, pz: number, nx: number, ny: number, nz: number, reach: number, scratch: ReliefScratch): number {
    let ux = Math.abs(nx) < 0.9 ? 0 : -nz, uy = Math.abs(nx) < 0.9 ? -nz : 0, uz = Math.abs(nx) < 0.9 ? ny : nx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const bias = reach * 0.02;
    const { near, hit: where, origin, spoke, best, found, place } = scratch;
    for (let j = 0; j < RELIEF_SPOKES.length; j++) {
        const { share, cos, sin } = RELIEF_SPOKES[j]!;
        const radius = reach * share;
        const dx = ux * cos + vx * sin, dy = uy * cos + vy * sin, dz = uz * cos + vz * sin;
        spoke[j * 3] = dx; spoke[j * 3 + 1] = dy; spoke[j * 3 + 2] = dz;
        origin[j * 3] = px + dx * radius; origin[j * 3 + 1] = py + dy * radius; origin[j * 3 + 2] = pz + dz * radius;
    }
    const wide = reach * 1.001;
    const ex = wide * (Math.sqrt(Math.max(0, 1 - nx * nx)) + Math.abs(nx)), ey = wide * (Math.sqrt(Math.max(0, 1 - ny * ny)) + Math.abs(ny)), ez = wide * (Math.sqrt(Math.max(0, 1 - nz * nz)) + Math.abs(nz));
    const count = tree.gather(px - ex, py - ey, pz - ez, px + ex, py + ey, pz + ez, near);
    if (count < 0) {
        for (let j = 0; j < RELIEF_SPOKES.length; j++) {
            found[j] = tree.nearest(origin[j * 3]!, origin[j * 3 + 1]!, origin[j * 3 + 2]!, nx, ny, nz, reach, where);
            place[j * 2] = where[0]!;
            place[j * 2 + 1] = where[1]!;
        }
    } else {
        best.fill(reach);
        found.fill(-1);
        const toCell = RELIEF_CELLS / 2 / reach;
        for (let i = 0; i < count; i++) {
            const t = near[i]!, p = t * 9;
            const ax = corners[p]!, ay = corners[p + 1]!, az = corners[p + 2]!;
            const bx = corners[p + 3]!, by = corners[p + 4]!, bz = corners[p + 5]!;
            const cx = corners[p + 6]!, cy = corners[p + 7]!, cz = corners[p + 8]!;
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
            const qx = ny * e2z - nz * e2y, qy = nz * e2x - nx * e2z, qz = nx * e2y - ny * e2x;
            const det = e1x * qx + e1y * qy + e1z * qz;
            if (det > -1e-14) continue;
            const a0 = (ax - px) * ux + (ay - py) * uy + (az - pz) * uz, a1 = (bx - px) * ux + (by - py) * uy + (bz - pz) * uz, a2 = (cx - px) * ux + (cy - py) * uy + (cz - pz) * uz;
            const b0 = (ax - px) * vx + (ay - py) * vy + (az - pz) * vz, b1 = (bx - px) * vx + (by - py) * vy + (bz - pz) * vz, b2 = (cx - px) * vx + (cy - py) * vy + (cz - pz) * vz;
            const column0 = Math.max(0, Math.floor((Math.min(a0, a1, a2) + reach) * toCell - RELIEF_MARGIN)), column1 = Math.min(RELIEF_CELLS - 1, Math.floor((Math.max(a0, a1, a2) + reach) * toCell + RELIEF_MARGIN));
            const row0 = Math.max(0, Math.floor((Math.min(b0, b1, b2) + reach) * toCell - RELIEF_MARGIN)), row1 = Math.min(RELIEF_CELLS - 1, Math.floor((Math.max(b0, b1, b2) + reach) * toCell + RELIEF_MARGIN));
            if (column0 > column1 || row0 > row1) continue;
            const inv = 1 / det;
            for (let row = row0; row <= row1; row++) {
                for (let column = column0; column <= column1; column++) {
                    for (const j of SPOKES_BY_CELL[row * RELIEF_CELLS + column]!) {
                        const sx = origin[j * 3]! - ax, sy = origin[j * 3 + 1]! - ay, sz = origin[j * 3 + 2]! - az;
                        const u = (sx * qx + sy * qy + sz * qz) * inv;
                        if (u < 0 || u > 1) continue;
                        const rx = sy * e1z - sz * e1y, ry = sz * e1x - sx * e1z, rz = sx * e1y - sy * e1x;
                        const v = (nx * rx + ny * ry + nz * rz) * inv;
                        if (v < 0 || u + v > 1) continue;
                        const along = (e2x * rx + e2y * ry + e2z * rz) * inv;
                        if (Math.abs(along) < best[j]!) {
                            best[j] = Math.abs(along);
                            found[j] = t;
                            place[j * 2] = u;
                            place[j * 2 + 1] = v;
                        }
                    }
                }
            }
        }
    }
    let sum = 0, tried = 0, flat = true, j = 0;
    for (const [share, spokes] of RELIEF_RINGS) {
        const radius = reach * share;
        for (let k = 0; k < spokes; k++, j++) {
            const hit = found[j]!;
            const ox = origin[j * 3]!, oy = origin[j * 3 + 1]!, oz = origin[j * 3 + 2]!;
            tried++;
            let h: number;
            if (hit < 0) {
                h = tree.blocked(px + nx * bias, py + ny * bias, pz + nz * bias, spoke[j * 3]!, spoke[j * 3 + 1]!, spoke[j * 3 + 2]!, radius) ? reach : -reach;
            } else {
                const hv = place[j * 2]!, hw = place[j * 2 + 1]!, hu = 1 - hv - hw, at = hit * 9;
                h = (hu * corners[at]! + hv * corners[at + 3]! + hw * corners[at + 6]! - ox) * nx
                    + (hu * corners[at + 1]! + hv * corners[at + 4]! + hw * corners[at + 7]! - oy) * ny
                    + (hu * corners[at + 2]! + hv * corners[at + 5]! + hw * corners[at + 8]! - oz) * nz;
            }
            if (Math.abs(h) > reach * RELIEF_FLAT) flat = false;
            sum += h;
        }
        if (flat) return 0;
    }
    return Math.max(-1, Math.min(1, sum / tried / (reach * 0.5)));
}

export interface ReliefProbe {
    reach: number;
    values: Float64Array;
    todo: Int32Array;
}

export interface OcclusionProbe {
    reach: number;
    samples: number;
    bias: number;
    texels: Int32Array;
    triangles: Int32Array;
    places: Float64Array;
    values: Float32Array;
    todo: Int32Array;
}

export interface BakeProbes {
    corners: Float64Array;
    normals: Float64Array;
    triangles: Int32Array;
    places: Float32Array;
    reliefs: ReliefProbe[];
    occlusion?: OcclusionProbe;
}

export interface StainWork {
    stains: StainParams[];
    chosen: Uint8Array[];
    reliefOf: number[];
    faceOf: Int32Array;
    slots: Int32Array;
    fallback: { roughness: number; metallic: number };
    colorRgba?: Uint8Array;
    surfaceRgba?: Uint8Array;
    glow?: Uint8Array;
    painted: boolean;
}

export interface NormalBakePlan {
    probes: BakeProbes;
    stains: StainWork | null;
    tree: TriangleTree;
    finish(): NormalMap;
}

function stainLayers(high: PolyMesh, stains: readonly StainParams[], diagonal: number): { chosen: Uint8Array[]; reliefOf: number[]; reaches: number[] } {
    const reaches: number[] = [];
    const chosen = stains.map((p) => {
        const mask = new Uint8Array(high.faces.length);
        for (const f of selectFaces(high, p.faces ?? 'all')) mask[f] = 1;
        return mask;
    });
    const reliefOf = stains.map((p) => {
        if (!p.where) return -1;
        const reach = p.reach ?? diagonal * DEFAULT_RELIEF_REACH;
        if (!reaches.includes(reach)) reaches.push(reach);
        return reaches.indexOf(reach);
    });
    return { chosen, reliefOf, reaches };
}

function reliefProbes(chosen: readonly Uint8Array[], reliefOf: readonly number[], reaches: readonly number[], faceOf: Int32Array, triangles: Int32Array): ReliefProbe[] {
    return reaches.map((reach, index) => {
        const wanted = chosen.filter((_, layer) => reliefOf[layer] === index);
        const todo: number[] = [];
        for (let slot = 0; slot < triangles.length; slot++) {
            const face = faceOf[triangles[slot]!]!;
            if (wanted.some((mask) => mask[face])) todo.push(slot);
        }
        return { reach, values: new Float64Array(triangles.length).fill(NaN), todo: Int32Array.from(todo) };
    });
}

export function probeRelief(probes: BakeProbes, tree: TriangleTree, index: number, from: number, to: number): void {
    const { corners, normals, triangles, places } = probes;
    const { reach, values, todo } = probes.reliefs[index]!;
    const scratch = reliefScratch();
    const at: [number, number, number] = [0, 0, 0], n: [number, number, number] = [0, 0, 0];
    for (let i = from; i < to; i++) {
        const slot = todo[i]!;
        const hv = places[slot * 2]!, hw = places[slot * 2 + 1]!, hu = 1 - hv - hw, c = triangles[slot]! * 9;
        for (let k = 0; k < 3; k++) {
            at[k] = hu * corners[c + k]! + hv * corners[c + 3 + k]! + hw * corners[c + 6 + k]!;
            n[k] = hu * normals[c + k]! + hv * normals[c + 3 + k]! + hw * normals[c + 6 + k]!;
        }
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        values[slot] = reliefAt(tree, corners, at[0], at[1], at[2], n[0] / nl, n[1] / nl, n[2] / nl, reach, scratch);
    }
}

export function probeOcclusion(probes: BakeProbes, tree: TriangleTree, from: number, to: number): void {
    const { corners, normals } = probes;
    const { reach, samples, bias, texels, triangles, places, values, todo } = probes.occlusion!;
    const side = Math.ceil(Math.sqrt(samples));
    for (let step = from; step < to; step++) {
        const i = todo[step]!;
        const hv = places[i * 2]!, hw = places[i * 2 + 1]!;
        const hu = 1 - hv - hw;
        const at = triangles[i]! * 9;
        const px = hu * corners[at]! + hv * corners[at + 3]! + hw * corners[at + 6]!;
        const py = hu * corners[at + 1]! + hv * corners[at + 4]! + hw * corners[at + 7]!;
        const pz = hu * corners[at + 2]! + hv * corners[at + 5]! + hw * corners[at + 8]!;
        let sx = hu * normals[at]! + hv * normals[at + 3]! + hw * normals[at + 6]!;
        let sy = hu * normals[at + 1]! + hv * normals[at + 4]! + hw * normals[at + 7]!;
        let sz = hu * normals[at + 2]! + hv * normals[at + 5]! + hw * normals[at + 8]!;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        let ux = Math.abs(sx) < 0.9 ? 0 : -sz, uy = Math.abs(sx) < 0.9 ? -sz : 0, uz = Math.abs(sx) < 0.9 ? sy : sx;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const vx = sy * uz - sz * uy, vy = sz * ux - sx * uz, vz = sx * uy - sy * ux;
        const turn = (texels[i]! * 0.61803398875) % 1;
        const [ox, oy, oz] = [px + sx * bias, py + sy * bias, pz + sz * bias];
        let open = 0, total = 0;
        for (let a = 0; a < side; a++) {
            for (let b = 0; b < side; b++) {
                const r = Math.sqrt((a + 0.5) / side);
                const phi = ((b + 0.5) / side + turn) * 2 * Math.PI;
                const [du, dv] = [r * Math.cos(phi), r * Math.sin(phi)];
                const dn = Math.sqrt(Math.max(0, 1 - r * r));
                total++;
                if (!tree.blocked(ox, oy, oz, ux * du + vx * dv + sx * dn, uy * du + vy * dv + sy * dn, uz * du + vz * dv + sz * dn, reach)) open++;
            }
        }
        values[i] = open / total;
    }
}

export function runProbes(probes: BakeProbes, tree: TriangleTree): void {
    probes.reliefs.forEach((relief, index) => probeRelief(probes, tree, index, 0, relief.todo.length));
    if (probes.occlusion) probeOcclusion(probes, tree, 0, probes.occlusion.todo.length);
}

export function probeIdentity(): string {
    return [RELIEF_RINGS, RELIEF_FLAT, RELIEF_NEIGHBOURS, RELIEF_CELLS, RELIEF_MARGIN, reliefAt, TriangleTree.prototype.gather, probeRelief, probeOcclusion, TriangleTree.prototype.nearest, TriangleTree.prototype.blocked].map((part) => typeof part === 'function' ? String(part) : JSON.stringify(part)).join('\n');
}

export function stainPainter(work: StainWork, probes: BakeProbes): (from: number, to: number) => void {
    const { corners, normals, triangles, places, reliefs } = probes;
    const { slots, faceOf, fallback, colorRgba, surfaceRgba, glow } = work;
    const layers = work.stains.map((p, layer) => ({ p, chosen: work.chosen[layer]!, weigh: texelStain(p), relief: work.reliefOf[layer]! }));
    const at: [number, number, number] = [0, 0, 0], n: [number, number, number] = [0, 0, 0];
    return (from, to) => {
        for (let slot = from; slot < to; slot++) {
            const texel = slots[slot]!;
            const hit = triangles[slot]!;
            const face = faceOf[hit]!;
            const hv = places[slot * 2]!, hw = places[slot * 2 + 1]!, hu = 1 - hv - hw, c = hit * 9;
            for (let k = 0; k < 3; k++) {
                at[k] = hu * corners[c + k]! + hv * corners[c + 3 + k]! + hw * corners[c + 6 + k]!;
                n[k] = hu * normals[c + k]! + hv * normals[c + 3 + k]! + hw * normals[c + 6 + k]!;
            }
            const nl = Math.hypot(n[0], n[1], n[2]) || 1;
            n[0] /= nl; n[1] /= nl; n[2] /= nl;
            let red = 0, green = 0, blue = 0, alpha = 0, rough = fallback.roughness, metal = fallback.metallic;
            if (colorRgba) { red = colorRgba[texel * 4]! / 255; green = colorRgba[texel * 4 + 1]! / 255; blue = colorRgba[texel * 4 + 2]! / 255; alpha = colorRgba[texel * 4 + 3]! / 255; }
            if (surfaceRgba) { rough = surfaceRgba[texel * 4 + 1]! / 255; metal = surfaceRgba[texel * 4 + 2]! / 255; }
            let lit = glow ? glow[texel]! / 255 : 0;
            let touched = false;
            for (const layer of layers) {
                if (!layer.chosen[face]) continue;
                const relief = layer.relief >= 0 ? reliefs[layer.relief]!.values[slot]! : 0;
                if (Number.isNaN(relief)) throw new Error(`the relief at texel ${texel} was never probed`);
                const m = layer.weigh(at as unknown as Vec3, n as unknown as Vec3, relief);
                if (m <= 0) continue;
                touched = true;
                const { p } = layer;
                if (p.color) { red += (p.color[0]! - red) * m; green += (p.color[1]! - green) * m; blue += (p.color[2]! - blue) * m; }
                if (p.alpha !== undefined) alpha += (p.alpha - alpha) * m;
                if (p.roughness !== undefined) rough += (p.roughness - rough) * m;
                if (p.metallic !== undefined) metal += (p.metallic - metal) * m;
                if (p.glow !== undefined) lit += (p.glow - lit) * m;
            }
            if (!touched) continue;
            const byte = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
            if (colorRgba) { colorRgba[texel * 4] = byte(red); colorRgba[texel * 4 + 1] = byte(green); colorRgba[texel * 4 + 2] = byte(blue); colorRgba[texel * 4 + 3] = byte(alpha); }
            if (surfaceRgba) { surfaceRgba[texel * 4 + 1] = byte(rough); surfaceRgba[texel * 4 + 2] = byte(metal); }
            if (glow) glow[texel] = byte(lit);
        }
    };
}

export function bakeNormalMap(model: BakedModel): NormalMap {
    const plan = planNormalBake(model);
    runProbes(plan.probes, plan.tree);
    return plan.finish();
}

export const SHADE_CHUNK = 16384;

export interface ShadeWork {
    size: number;
    distance: number;
    indices: Uint32Array;
    P: Float32Array;
    N: Float32Array;
    T: Float32Array;
    UV: Float32Array;
    cover: Int32Array;
    corners: Float64Array;
    normals: Float64Array;
    colors: Uint8Array;
    surfaces: Uint8Array;
    glows: Uint8Array | null;
    lowColors?: Uint8Array;
    rgba: Uint8Array;
    colorRgba?: Uint8Array;
    surfaceRgba?: Uint8Array;
    glow?: Uint8Array;
    hitTriangle: Int32Array | null;
    hitPlace: Float32Array | null;
    stats: Float64Array;
}

export interface NormalBakeStart {
    shading: ShadeWork;
    tree: TriangleTree;
    plan(): NormalBakePlan;
}

export function shadeTexels(work: ShadeWork, tree: TriangleTree, from: number, to: number, known?: { triangle: Int32Array; place: Float32Array }): void {
    const { size, distance, indices, P, N, T, UV, cover, normals, colors, surfaces, glows, lowColors, rgba, colorRgba, surfaceRgba, glow, hitTriangle, hitPlace, stats } = work;
    const place = new Float64Array(2), weights = new Float64Array(3);
    for (let chunk = from; chunk < to; chunk++) {
        let hits = 0, missed = 0, bend = 0;
        const end = Math.min(size * size, (chunk + 1) * SHADE_CHUNK);
        for (let texel = chunk * SHADE_CHUNK; texel < end; texel++) {
            const t = cover[texel]!;
            if (t < 0) continue;
            const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
            if (!texelWeights(UV, size, a, b, c, texel, weights)) throw new Error(`texel ${texel} is not in the triangle that covers it`);
            const w0 = weights[0]!, w1 = weights[1]!, w2 = weights[2]!;

            let nx = w0 * N[a * 3]! + w1 * N[b * 3]! + w2 * N[c * 3]!;
            let ny = w0 * N[a * 3 + 1]! + w1 * N[b * 3 + 1]! + w2 * N[c * 3 + 1]!;
            let nz = w0 * N[a * 3 + 2]! + w1 * N[b * 3 + 2]! + w2 * N[c * 3 + 2]!;
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl; ny /= nl; nz /= nl;
            let hit: number;
            if (known) {
                hit = known.triangle[texel]!;
                place[0] = known.place[texel * 2]!;
                place[1] = known.place[texel * 2 + 1]!;
            } else {
                hit = tree.nearest(
                    w0 * P[a * 3]! + w1 * P[b * 3]! + w2 * P[c * 3]!,
                    w0 * P[a * 3 + 1]! + w1 * P[b * 3 + 1]! + w2 * P[c * 3 + 1]!,
                    w0 * P[a * 3 + 2]! + w1 * P[b * 3 + 2]! + w2 * P[c * 3 + 2]!,
                    nx, ny, nz, distance, place,
                );
            }
            if (hit < 0) {
                missed++;
                if (colorRgba) for (let k = 0; k < 4; k++) colorRgba[texel * 4 + k] = Math.round(w0 * lowColors![a * 4 + k]! + w1 * lowColors![b * 4 + k]! + w2 * lowColors![c * 4 + k]!);
                continue;
            }
            hits++;
            if (colorRgba) colorRgba.set(colors.subarray(hit * 4, hit * 4 + 4), texel * 4);
            if (glow && glows) glow[texel] = glows[hit]!;
            if (surfaceRgba) { surfaceRgba[texel * 4 + 1] = surfaces[hit * 2]!; surfaceRgba[texel * 4 + 2] = surfaces[hit * 2 + 1]!; }

            const [hv, hw] = [place[0]!, place[1]!];
            if (hitTriangle && hitPlace) { hitTriangle[texel] = hit; hitPlace[texel * 2] = hv; hitPlace[texel * 2 + 1] = hw; }
            const hu = 1 - hv - hw;
            const at = hit * 9;
            let sx = hu * normals[at]! + hv * normals[at + 3]! + hw * normals[at + 6]!;
            let sy = hu * normals[at + 1]! + hv * normals[at + 4]! + hw * normals[at + 7]!;
            let sz = hu * normals[at + 2]! + hv * normals[at + 5]! + hw * normals[at + 8]!;
            const sl = Math.hypot(sx, sy, sz) || 1;
            sx /= sl; sy /= sl; sz /= sl;

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
        stats[chunk * 3] = hits;
        stats[chunk * 3 + 1] = missed;
        stats[chunk * 3 + 2] = bend;
    }
}

export function planNormalBake(model: BakedModel): NormalBakePlan {
    const start = startNormalBake(model);
    shadeTexels(start.shading, start.tree, 0, start.shading.stats.length / 3);
    return start.plan();
}

export function startNormalBake(model: BakedModel): NormalBakeStart {
    const detail = model.detail;
    if (!detail) throw new Error('this model has no normalBake');
    const { size, high, smoothAngle } = detail;
    const { min, max } = boundsOf(high);
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const distance = detail.distance ?? diagonal * DEFAULT_DISTANCE;
    const fallback = detail.surface ?? { roughness: 1, metallic: 0 };
    const { corners, normals, colors, surfaces, faceOf, glows } = denseSurface(high, smoothAngle, fallback);
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
    const glowing = colorRgba && (glows || (detail.stains ?? []).some((stain) => stain.glow !== undefined));
    const glow = glowing ? new Uint8Array(size * size) : undefined;
    if (surfaceRgba) {
        for (let i = 0; i < size * size; i++) {
            surfaceRgba[i * 4] = 255;
            surfaceRgba[i * 4 + 1] = Math.round(fallback.roughness * 255);
            surfaceRgba[i * 4 + 2] = Math.round(fallback.metallic * 255);
            surfaceRgba[i * 4 + 3] = 255;
        }
    }
    const covered = new Uint8Array(size * size);
    const cover = new Int32Array(size * size).fill(-1);
    rasterTexels(mesh.indices, UV, size, (texel, _a, _b, _c, _w0, _w1, _w2, t) => {
        if (covered[texel]) return;
        covered[texel] = 1;
        cover[texel] = t;
    });
    const stains = detail.stains ?? [];
    const shading: ShadeWork = {
        size, distance, indices: mesh.indices, P, N, T, UV, cover, corners, normals, colors, surfaces, glows, rgba,
        ...(lowColors ? { lowColors } : {}), ...(colorRgba ? { colorRgba } : {}), ...(surfaceRgba ? { surfaceRgba } : {}), ...(glow ? { glow } : {}),
        hitTriangle: stains.length ? new Int32Array(size * size).fill(-1) : null,
        hitPlace: stains.length ? new Float32Array(size * size * 2) : null,
        stats: new Float64Array(Math.ceil(size * size / SHADE_CHUNK) * 3).fill(NaN),
    };
    const plan = (): NormalBakePlan => {
        let hits = 0, missed = 0, bend = 0;
        for (let chunk = 0; chunk * 3 < shading.stats.length; chunk++) {
            if (Number.isNaN(shading.stats[chunk * 3]!)) throw new Error(`the texels from ${chunk * SHADE_CHUNK} on were never shaded`);
            hits += shading.stats[chunk * 3]!;
            missed += shading.stats[chunk * 3 + 1]!;
            bend += shading.stats[chunk * 3 + 2]!;
        }
        let { hitTriangle, hitPlace } = shading;
        let count = 0;
        if (hitTriangle) for (let texel = 0; texel < size * size; texel++) if (hitTriangle[texel]! >= 0) count++;
        const slots = new Int32Array(count), triangles = new Int32Array(count), places = new Float32Array(count * 2);
        if (hitTriangle && hitPlace) {
            for (let texel = 0, slot = 0; texel < size * size; texel++) {
                if (hitTriangle[texel]! < 0) continue;
                slots[slot] = texel;
                triangles[slot] = hitTriangle[texel]!;
                places[slot * 2] = hitPlace[texel * 2]!;
                places[slot * 2 + 1] = hitPlace[texel * 2 + 1]!;
                slot++;
            }
        }
        const { chosen, reliefOf, reaches } = stainLayers(high, stains, diagonal);
        const shade = detail.occlusion ? planOcclusion(tree, mesh.indices, P, N, UV, size, distance, detail.occlusion, diagonal) : null;
        const probes: BakeProbes = { corners, normals, triangles, places, reliefs: reliefProbes(chosen, reliefOf, reaches, faceOf, triangles), ...(shade ? { occlusion: shade.probe } : {}) };
        const work: StainWork | null = stains.length
            ? { stains: [...stains], chosen, reliefOf, faceOf, slots, fallback, ...(colorRgba ? { colorRgba } : {}), ...(surfaceRgba ? { surfaceRgba } : {}), ...(glow ? { glow } : {}), painted: false }
            : null;
        hitTriangle = null;
        hitPlace = null;
        shading.hitTriangle = null;
        shading.hitPlace = null;
        const finish = (): NormalMap => {
            if (work && !work.painted) {
                stainPainter(work, probes)(0, slots.length);
                work.painted = true;
            }
            const occlusion = shade ? finishOcclusion(shade) : undefined;
            const inside = hits + missed;
            let emissiveRgba: Uint8Array | undefined;
            if (glow && colorRgba) {
                emissiveRgba = new Uint8Array(size * size * 4);
                for (let i = 0; i < size * size; i++) {
                    for (let k = 0; k < 3; k++) emissiveRgba[i * 4 + k] = Math.round(colorRgba[i * 4 + k]! * glow[i]! / 255);
                    emissiveRgba[i * 4 + 3] = 255;
                }
            }
            dilate([rgba, ...(colorRgba ? [colorRgba] : []), ...(surfaceRgba ? [surfaceRgba] : []), ...(emissiveRgba ? [emissiveRgba] : [])], covered, size);

            const from = corners.length / 9, to = mesh.indices.length / 3;
            const warnings: string[] = [];
            const missedShare = inside ? missed / inside : 1;
            if (missedShare > MISSED_WARNING) warnings.push(`${Math.round(missedShare * 100)}% of the normal map found no surface within ${distance.toPrecision(3)} and is flat: raise normalBake.distance, or decimate less`);
            if (hits && (bend / hits) * 180 / Math.PI > STEEP_BEND) warnings.push(`the map bends light by ${Math.round((bend / hits) * 180 / Math.PI)} degrees on average, steeper than a normal map draws well: dark bands and lost shape. Lower the amplitude of a displace against its scale`);
            if (inside / (size * size) < SPARSE_COVERAGE) warnings.push(`the surface broke into so many pieces that they fill only ${Math.round((inside / (size * size)) * 100)}% of the map, so most of its resolution is lost: lower the amplitude before the decimate, or keep more triangles`);
            if (from <= to) warnings.push(`the surface baked from has ${from} triangles and this one ${to}: there is no detail to carry. normalBake.from should name a step before the decimate`);
            return {
                size, rgba, warnings, ...(colorRgba ? { colorRgba } : {}), ...(surfaceRgba ? { surfaceRgba } : {}), ...(emissiveRgba ? { emissiveRgba } : {}), ...(occlusion ? { occlusion } : {}),
                report: {
                    size, from, to,
                    coverage: Math.round((inside / (size * size)) * 1000) / 1000,
                    missed: Math.round(missedShare * 1000) / 1000,
                    distance: Number(distance.toPrecision(4)),
                    meanBend: hits ? Math.round(((bend / hits) * 180 / Math.PI) * 100) / 100 : 0,
                },
            };
        };
        return { probes, stains: work, tree, finish };
    };
    return { shading, tree, plan };
}

interface OcclusionPlan {
    size: number;
    values: Float32Array;
    probe: OcclusionProbe;
}

function planOcclusion(
    tree: TriangleTree, indices: ArrayLike<number>,
    P: Float32Array, N: Float32Array, UV: Float32Array, mainSize: number, distance: number,
    options: { size?: number; reach?: number; samples?: number }, diagonal: number,
): OcclusionPlan {
    const size = options.size ?? Math.max(MIN_OCCLUSION_SIZE, Math.min(MAX_OCCLUSION_SIZE, mainSize >> 2));
    const reach = options.reach ?? diagonal * DEFAULT_OCCLUSION_REACH;
    const samples = options.samples ?? DEFAULT_OCCLUSION_SAMPLES;
    const bias = diagonal * 2e-4;
    const values = new Float32Array(size * size).fill(-1);
    const place = new Float64Array(2);
    const texels: number[] = [], triangles: number[] = [], places: number[] = [];
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
        values[texel] = 1;
        if (hit < 0) return;
        texels.push(texel);
        triangles.push(hit);
        places.push(place[0]!, place[1]!);
    });
    return { size, values, probe: { reach, samples, bias, texels: Int32Array.from(texels), triangles: Int32Array.from(triangles), places: Float64Array.from(places), values: new Float32Array(texels.length).fill(NaN), todo: Int32Array.from(texels, (_, i) => i) } };
}

function finishOcclusion(plan: OcclusionPlan): { size: number; rgba: Uint8Array } {
    const { size, values, probe } = plan;
    for (let i = 0; i < probe.texels.length; i++) {
        if (Number.isNaN(probe.values[i]!)) throw new Error(`the occlusion at texel ${probe.texels[i]} was never probed`);
        values[probe.texels[i]!] = probe.values[i]!;
    }
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
