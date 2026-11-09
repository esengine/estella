// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builder.ts
 * @brief   Where plants stand, and the geometry of a patch of them.
 *
 * @details A field of grass is tens of thousands of blades and a forest is thousands of trees, which no engine draws one entity at a time. The
 *          ground is cut into cells and every cell is ONE mesh with all its plants in it, so a field is a few hundred draws that
 *          culling can drop whole. Each cell is built at the detail its distance deserves — fewer, broader blades; a tree
 *          reduced to two crossed cards — and the engine's own level-of-detail picks among them.
 *
 *          What the wind needs is painted into the vertices, because a plant is not a thing the vertex stage can see once it is
 *          merged: the colour's red is how far up the plant the vertex is (the tip moves and the root does not), green is a
 *          phase of the plant's own so a meadow does not sway as one, and blue is how much light reaches it (the base of a
 *          clump is darker). The Foliage material reads them; a mesh drawn without it shows them as colour, so a field with
 *          no material is painted in its own colours instead.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';

/** One plant, in the space of the cell that holds it. */
export interface Plant {
    x: number;
    y: number;
    z: number;
    /** Turn about the vertical, radians. */
    yaw: number;
    scale: number;
    /** 0 to 1: its own phase in the wind, and how dark its roots are. */
    phase: number;
    shade: number;
    /** The ground's normal it leans with (a stone on a slope), after its turn; upright when absent. */
    up?: readonly [number, number, number];
    /** Who it is, within what grew it: what became of it is kept against this. Only a kind that can be touched has one. */
    key?: string;
    /** How far it leans, sideways per unit of height along x and z: a shear, so any material bends with it. */
    shear?: readonly [number, number];
}

/** What a place is, as the ground answers: how high it is and how much it faces up. */
export type Ground = (x: number, z: number) => { y: number; up: number } | null;

export interface ScatterParams {
    /** The cell: its centre and its side, in the space the ground answers in. */
    centerX: number;
    centerZ: number;
    size: number;
    count: number;
    seed: number;
    /** An integer naming the cell, so two cells never roll the same dice. */
    cellKey: number;
    minScale: number;
    maxScale: number;
    /** The least a place may face up (the normal's y) and still grow something. */
    minUp: number;
    heightMin: number;
    heightMax: number;
}

/** A deterministic 32-bit generator: the same seed grows the same field on every host. */
export function rng(seed: number): () => number {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The plants of one cell: `count` tries at random places, each kept only where the ground is gentle enough and in the height band.
 * Positions come back relative to the cell's centre, with the ground's height already in them.
 */
export function scatterCell(p: ScatterParams, ground: Ground): Plant[] {
    const random = rng(Math.imul(p.seed | 0, 73856093) ^ Math.imul(p.cellKey | 0, 19349663) ^ 0x9e3779b9);
    const out: Plant[] = [];
    for (let i = 0; i < p.count; i++) {
        const x = p.centerX + (random() - 0.5) * p.size;
        const z = p.centerZ + (random() - 0.5) * p.size;
        const yaw = random() * Math.PI * 2;
        const scale = p.minScale + (p.maxScale - p.minScale) * random();
        const phase = random();
        const shade = 0.7 + 0.3 * random();
        const g = ground(x, z);
        if (!g || g.up < p.minUp || g.y < p.heightMin || g.y > p.heightMax) continue;
        out.push({ x: x - p.centerX, y: g.y, z: z - p.centerZ, yaw, scale, phase, shade });
    }
    return out;
}

/** The vertices a patch is made of, before they are packed. */
interface Builder {
    pos: number[];
    uv: number[];
    color: number[];
    nrm: number[];
    idx: number[];
}

const newBuilder = (): Builder => ({ pos: [], uv: [], color: [], nrm: [], idx: [] });

function vertex(b: Builder, x: number, y: number, z: number, u: number, v: number,
                r: number, g: number, bl: number, nx: number, ny: number, nz: number): number {
    b.pos.push(x, y, z);
    b.uv.push(u, v);
    b.color.push(r, g, bl, 1);
    b.nrm.push(nx, ny, nz);
    return b.pos.length / 3 - 1;
}

function pack(b: Builder): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertexCount = b.pos.length / 3;
    const vertices = new Uint8Array(Math.max(1, vertexCount) * vertexStride);
    const view = new DataView(vertices.buffer);
    const posAt = channels[0]!.offset, uvAt = channels[1]!.offset, colorAt = channels[2]!.offset, normalAt = channels[3]!.offset;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
        const at = i * vertexStride;
        for (let k = 0; k < 3; k++) {
            const value = b.pos[i * 3 + k]!;
            view.setFloat32(at + posAt + k * 4, value, true);
            view.setFloat32(at + normalAt + k * 4, b.nrm[i * 3 + k]!, true);
            if (value < min[k]!) min[k] = value;
            if (value > max[k]!) max[k] = value;
        }
        view.setFloat32(at + uvAt, b.uv[i * 2]!, true);
        view.setFloat32(at + uvAt + 4, b.uv[i * 2 + 1]!, true);
        for (let k = 0; k < 4; k++) view.setUint8(at + colorAt + k, Math.round(Math.min(Math.max(b.color[i * 4 + k]!, 0), 1) * 255));
    }
    if (vertexCount === 0) { min.fill(0); max.fill(0); }
    return { channels, vertexStride, vertexCount, vertices, indices: new Uint32Array(b.idx), aabbMin: min, aabbMax: max };
}

/** How blades are drawn. */
export interface BladeParams {
    height: number;
    width: number;
    /** Segments up a blade; the more, the smoother its bend. */
    segments: number;
    /** Every n-th plant only, drawn broader to make up for the ones left out. */
    thin: number;
    /** Paint a colour the plain material shows, instead of the wind's weights. */
    paint?: { base: [number, number, number]; tip: [number, number, number] } | null;
}

/**
 * A patch of grass: a tapered, slightly bent blade for each plant, facing where its yaw says. The normal leans toward the ground's up
 * so a meadow is lit as one surface and not as ten thousand knives.
 */
export function buildGrassMesh(plants: readonly Plant[], blade: BladeParams): MeshData {
    const b = newBuilder();
    const segments = Math.max(1, Math.floor(blade.segments));
    const thin = Math.max(1, Math.floor(blade.thin));
    const widen = Math.sqrt(thin);
    for (let i = 0; i < plants.length; i += thin) {
        const p = plants[i]!;
        const h = blade.height * p.scale * (widen > 1 ? 1.1 : 1);
        const w = blade.width * p.scale * widen * 0.5;
        const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
        // The blade's width runs along (cos, 0, -sin) and it faces (sin, 0, cos).
        const fx = sin, fz = cos;
        const base = b.pos.length / 3;
        const ring: number[] = [];
        for (let s = 0; s <= segments; s++) {
            const t = s / segments;
            const half = s === segments ? 0 : w * (1 - t * 0.85);
            const lean = t * t * h * 0.12;
            const y = p.y + t * h;
            const cx = p.x + fx * lean, cz = p.z + fz * lean;
            const color = blade.paint ? paintColor(blade.paint, t, p.shade) : [t, p.phase, p.shade * (0.55 + 0.45 * t)] as const;
            const ny = 0.65;
            const nx = fx * 0.75, nz = fz * 0.75;
            const left = vertex(b, cx - cos * half, y, cz + sin * half, 0, t, color[0], color[1], color[2], nx, ny, nz);
            if (s === segments) { ring.push(left, left); continue; }
            const right = vertex(b, cx + cos * half, y, cz - sin * half, 1, t, color[0], color[1], color[2], nx, ny, nz);
            ring.push(left, right);
        }
        void base;
        for (let s = 0; s < segments; s++) {
            const l0 = ring[s * 2]!, r0 = ring[s * 2 + 1]!, l1 = ring[s * 2 + 2]!, r1 = ring[s * 2 + 3]!;
            b.idx.push(l0, r0, l1);
            if (r1 !== l1) b.idx.push(r0, r1, l1);
        }
    }
    return pack(b);
}

function paintColor(paint: NonNullable<BladeParams['paint']>, t: number, shade: number): [number, number, number] {
    const light = shade * (0.55 + 0.45 * t);
    return [
        (paint.base[0] + (paint.tip[0] - paint.base[0]) * t) * light,
        (paint.base[1] + (paint.tip[1] - paint.base[1]) * t) * light,
        (paint.base[2] + (paint.tip[2] - paint.base[2]) * t) * light,
    ];
}

/** Reads a channel of a source mesh as floats. */
function reader(mesh: MeshData, semantic: number, components: number): ((v: number, out: number[]) => boolean) {
    const channel = mesh.channels.find((c) => c.semantic === semantic);
    if (!channel || channel.type !== MeshChannelType.Float32 || channel.components < components) return () => false;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    return (v, out) => {
        for (let k = 0; k < components; k++) out[k] = view.getFloat32(v * mesh.vertexStride + channel.offset + k * 4, true);
        return true;
    };
}

/**
 * Copies of a mesh, one per plant, as one mesh: placed, turned about the vertical and scaled, with the wind's weights painted by how
 * high each vertex stands on its own copy (a tree's trunk hardly moves, its crown does).
 */
export function buildInstancedMesh(source: MeshData, plants: readonly Plant[], paint?: BladeParams['paint']): MeshData {
    const b = newBuilder();
    const readPosition = reader(source, MeshChannel.Position, 3);
    const readNormal = reader(source, MeshChannel.Normal, 3);
    const readUv = reader(source, MeshChannel.TexCoord0, 2);
    const minY = source.aabbMin[1], span = Math.max(1e-6, source.aabbMax[1] - source.aabbMin[1]);
    const p3 = [0, 0, 0], n3 = [0, 1, 0], uv2 = [0, 0];
    for (const plant of plants) {
        const base = b.pos.length / 3;
        const cos = Math.cos(plant.yaw), sin = Math.sin(plant.yaw);
        const lean = plant.up ? leanTo(plant.up) : null;
        const q = [0, 0, 0], m = [0, 0, 0];
        for (let v = 0; v < source.vertexCount; v++) {
            readPosition(v, p3);
            if (!readNormal(v, n3)) { n3[0] = 0; n3[1] = 1; n3[2] = 0; }
            if (!readUv(v, uv2)) { uv2[0] = 0; uv2[1] = 0; }
            const t = Math.min(Math.max((p3[1]! - minY) / span, 0), 1);
            const x = p3[0]! * plant.scale, y = p3[1]! * plant.scale, z = p3[2]! * plant.scale;
            const color = paint ? paintColor(paint, t, plant.shade) : [t, plant.phase, plant.shade * (0.6 + 0.4 * t)] as const;
            q[0] = x * cos + z * sin; q[1] = y; q[2] = -x * sin + z * cos;
            m[0] = n3[0]! * cos + n3[2]! * sin; m[1] = n3[1]!; m[2] = -n3[0]! * sin + n3[2]! * cos;
            if (lean) { lean(q); lean(m); }
            vertex(b, plant.x + q[0]!, plant.y + q[1]!, plant.z + q[2]!, uv2[0]!, uv2[1]!, color[0], color[1], color[2], m[0]!, m[1]!, m[2]!);
        }
        for (const i of source.indices) b.idx.push(base + i);
    }
    return pack(b);
}

/**
 * Copies of an authored mesh, one per plant, as one mesh, with every channel of the source kept: the colour, the second uv and the tangent that a
 * normal map reads are what the artist made, and the wind's painted weights do not replace them (see buildInstancedMesh for a mesh that is painted).
 * Each copy is turned about the vertical, scaled, leaned with the ground where it has an `up`, and placed; positions, normals and tangents are carried, other channels are copied as they are.
 */
export function buildPlacedMesh(source: MeshData, plants: readonly Plant[]): MeshData {
    const stride = source.vertexStride, count = source.vertexCount;
    const vertices = new Uint8Array(Math.max(1, count * plants.length) * stride);
    const indices = new Uint32Array(source.indices.length * plants.length);
    const at = (semantic: number) => source.channels.find((c) => c.semantic === semantic && c.type === MeshChannelType.Float32 && c.components >= 3)?.offset ?? -1;
    const posAt = at(MeshChannel.Position), normalAt = at(MeshChannel.Normal), tangentAt = at(MeshChannel.Tangent);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    // The vertices are read and written as 32-bit words: a vertex is `stride / 4` of them and a channel starts at a whole word, which the packed
    // format guarantees. This is the hot loop of growing a cell (a cell of grass is a hundred thousand vertices), so no DataView, no calls in it.
    const words = stride >> 2, p = posAt >> 2, nr = normalAt >> 2, tg = tangentAt >> 2;
    const f32 = new Float32Array(vertices.buffer), raw = new Uint32Array(vertices.buffer);
    // The source once, as aligned words: read as floats for the channels that move, copied whole for the rest.
    const own = new Uint8Array(count * stride);
    own.set(source.vertices.subarray(0, count * stride));
    const base = new Float32Array(own.buffer), rawBase = new Uint32Array(own.buffer);
    const hasNormal = normalAt >= 0, hasTangent = tangentAt >= 0;
    plants.forEach((plant, n) => {
        const cos = Math.cos(plant.yaw), sin = Math.sin(plant.yaw), scale = plant.scale;
        // A plant on a slope that leans with it (a stone), turned after its yaw about the vertical; most stand upright, and skip it.
        const lean = plant.up ? leanTo(plant.up) : null;
        const first = n * count * words;
        // Every channel copied as it is; the three that move are then rewritten.
        raw.set(rawBase, first);
        for (let v = 0, o = first; v < count; v++, o += words) {
            if (posAt >= 0) {
                const x = base[v * words + p]! * scale, y = base[v * words + p + 1]! * scale, z = base[v * words + p + 2]! * scale;
                let wx = x * cos + z * sin, wy = y, wz = -x * sin + z * cos;
                if (lean) { const q = [wx, wy, wz]; lean(q); wx = q[0]!; wy = q[1]!; wz = q[2]!; }
                wx += plant.x; wy += plant.y; wz += plant.z;
                f32[o + p] = wx; f32[o + p + 1] = wy; f32[o + p + 2] = wz;
                if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
                if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
                if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
            }
            if (hasNormal) {
                const x = base[v * words + nr]!, y = base[v * words + nr + 1]!, z = base[v * words + nr + 2]!;
                f32[o + nr] = x * cos + z * sin; f32[o + nr + 2] = -x * sin + z * cos;
                if (lean) { const q = [f32[o + nr]!, y, f32[o + nr + 2]!]; lean(q); f32[o + nr] = q[0]!; f32[o + nr + 1] = q[1]!; f32[o + nr + 2] = q[2]!; }
            }
            if (hasTangent) {
                const x = base[v * words + tg]!, y = base[v * words + tg + 1]!, z = base[v * words + tg + 2]!;
                f32[o + tg] = x * cos + z * sin; f32[o + tg + 2] = -x * sin + z * cos;
                if (lean) { const q = [f32[o + tg]!, y, f32[o + tg + 2]!]; lean(q); f32[o + tg] = q[0]!; f32[o + tg + 1] = q[1]!; f32[o + tg + 2] = q[2]!; }
            }
        }
        const firstIndex = n * source.indices.length, shift = n * count;
        for (let i = 0; i < source.indices.length; i++) indices[firstIndex + i] = source.indices[i]! + shift;
    });
    if (plants.length === 0) { min.fill(0); max.fill(0); }
    return { channels: source.channels, vertexStride: stride, vertexCount: count * plants.length, vertices, indices, aabbMin: min, aabbMax: max };
}

/** Floats a placement takes in the engine's `MeshInstances`: three rows of a model matrix (translation last), then a tint. */
export const PLACEMENT_FLOATS = 16;

/**
 * Where each plant stands, as the placements of a `MeshInstances`: the same turn about the vertical, scale, lean with the ground and position that
 * buildPlacedMesh bakes into vertices, left as a matrix for the engine to apply to the one mesh every plant of the kind shares. `tint` is
 * multiplied into the renderer's colour per plant.
 */
export function buildPlacements(plants: readonly Plant[]): Float32Array {
    const out = new Float32Array(plants.length * PLACEMENT_FLOATS);
    const column = [0, 0, 0];
    plants.forEach((plant, n) => {
        const cos = Math.cos(plant.yaw), sin = Math.sin(plant.yaw), scale = plant.scale;
        const lean = plant.up ? leanTo(plant.up) : null;
        const at = n * PLACEMENT_FLOATS;
        // The columns of the turn about the vertical, (cos, 0, -sin), (0, 1, 0) and (sin, 0, cos), each leant and scaled; the rows are written across them.
        for (let c = 0; c < 3; c++) {
            column[0] = c === 0 ? cos : c === 2 ? sin : 0;
            column[1] = c === 1 ? 1 : 0;
            column[2] = c === 0 ? -sin : c === 2 ? cos : 0;
            if (lean) lean(column);
            for (let row = 0; row < 3; row++) out[at + row * 4 + c] = column[row]! * scale;
        }
        if (plant.shear) {
            out[at + 1] = out[at + 1]! + plant.shear[0] * scale;
            out[at + 9] = out[at + 9]! + plant.shear[1] * scale;
        }
        out[at + 3] = plant.x;
        out[at + 7] = plant.y;
        out[at + 11] = plant.z;
        out[at + 12] = out[at + 13] = out[at + 14] = out[at + 15] = 1;
    });
    return out;
}

/**
 * The mesh with its normals turned toward up by `amount` (0 leaves them, 1 makes them all up): a card that stands for a crown lit as a rounded thing
 * rather than as the flat it is. A copy; the source is shared by every plant of the kind.
 */
export function softenNormals(source: MeshData, amount: number): MeshData {
    const normal = source.channels.find((c) => c.semantic === MeshChannel.Normal && c.type === MeshChannelType.Float32 && c.components >= 3);
    const a = Math.min(Math.max(amount, 0), 1);
    if (!normal || a <= 0) return source;
    const vertices = new Uint8Array(source.vertices.subarray(0, source.vertexCount * source.vertexStride));
    const f32 = new Float32Array(vertices.buffer), words = source.vertexStride >> 2, at = normal.offset >> 2;
    for (let v = 0; v < source.vertexCount; v++) {
        const o = v * words + at;
        const x = f32[o]! * (1 - a), y = f32[o + 1]! * (1 - a) + a, z = f32[o + 2]! * (1 - a);
        const len = Math.hypot(x, y, z) || 1;
        f32[o] = x / len; f32[o + 1] = y / len; f32[o + 2] = z / len;
    }
    return { ...source, vertices };
}

/**
 * The plants a far version draws, when it draws a share `keep` of them (above 0 to 1): every n-th, n the nearest whole number to 1 / keep, each grown by the
 * square root of n (to a most of twice) so the ground they cover is what it was. The same plants every time: what is kept is a matter of order.
 * `already` is how many times thinner the plants were planned than they would be (a far plan with sparser spacing): the n-th is then every n / `already`-th.
 */
export function thinPlants(plants: readonly Plant[], keep: number, already = 1): readonly Plant[] {
    const n = Math.max(1, Math.round(1 / Math.min(Math.max(keep, 1e-3), 1)));
    if (n === 1) return plants;
    const grow = Math.min(Math.sqrt(n), 2), every = Math.max(1, Math.round(n / Math.max(already, 1)));
    const out: Plant[] = [];
    for (let i = 0; i < plants.length; i += every) out.push({ ...plants[i]!, scale: plants[i]!.scale * grow });
    return out;
}

/** The turn that takes up (0, 1, 0) to `n` the shortest way, applied to a vector in place; null when `n` is up. */
function leanTo(n: readonly [number, number, number]): ((v: number[]) => void) | null {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len;
    // The axis is up crossed with n, (nz, 0, -nx); its length the sine of the angle, ny its cosine.
    const s = Math.hypot(nz, nx);
    if (s < 1e-6) return null;
    const ax = nz / s, az = -nx / s, c = ny, k = 1 - c;
    return (v) => {
        const [x, y, z] = v as [number, number, number];
        // Rodrigues: v cos + (axis x v) sin + axis (axis . v)(1 - cos), with the axis in the ground plane.
        const dot = ax * x + az * z;
        v[0] = x * c + (-az * y) * s + ax * dot * k;
        v[1] = y * c + (az * x - ax * z) * s;
        v[2] = z * c + (ax * y) * s + az * dot * k;
    };
}

/** The rectangle of the plant's texture a card shows, in uv. */
export interface CardRect {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
}

/**
 * The far version of a plant: two cards crossed at right angles, as wide and as tall as the plant is, each showing the rectangle of the
 * plant's texture that is its picture. Cheap enough that a forest on the horizon is a few triangles a tree, and seen from any side.
 */
export function buildBillboardMesh(
    plants: readonly Plant[], width: number, height: number, rect: CardRect, paint?: BladeParams['paint'], triangle = false,
): MeshData {
    const b = newBuilder();
    for (const plant of plants) {
        const w = width * plant.scale * 0.5, h = height * plant.scale;
        for (const turn of [0, Math.PI / 2]) {
            const a = plant.yaw + turn;
            const cos = Math.cos(a), sin = Math.sin(a);
            const lower = paint ? paintColor(paint, 0, plant.shade) : [0, plant.phase, plant.shade * 0.6] as const;
            const upper = paint ? paintColor(paint, 1, plant.shade) : [1, plant.phase, plant.shade] as const;
            if (triangle) {
                // A tent: wide at a tenth of the height, where a conifer's needles begin, and a point at the top.
                const foot = h * 0.1, vMid = rect.v0 + (rect.v1 - rect.v0) * 0.1, uMid = (rect.u0 + rect.u1) / 2;
                const t0 = vertex(b, plant.x - cos * w, plant.y + foot, plant.z + sin * w, rect.u0, vMid, lower[0], lower[1], lower[2], 0, 1, 0);
                const t1 = vertex(b, plant.x + cos * w, plant.y + foot, plant.z - sin * w, rect.u1, vMid, lower[0], lower[1], lower[2], 0, 1, 0);
                const t2 = vertex(b, plant.x, plant.y + h, plant.z, uMid, rect.v1, upper[0], upper[1], upper[2], 0, 1, 0);
                b.idx.push(t0, t1, t2);
                continue;
            }
            const v0 = vertex(b, plant.x - cos * w, plant.y, plant.z + sin * w, rect.u0, rect.v0, lower[0], lower[1], lower[2], 0, 1, 0);
            const v1 = vertex(b, plant.x + cos * w, plant.y, plant.z - sin * w, rect.u1, rect.v0, lower[0], lower[1], lower[2], 0, 1, 0);
            const v2 = vertex(b, plant.x + cos * w, plant.y + h, plant.z - sin * w, rect.u1, rect.v1, upper[0], upper[1], upper[2], 0, 1, 0);
            const v3 = vertex(b, plant.x - cos * w, plant.y + h, plant.z + sin * w, rect.u0, rect.v1, upper[0], upper[1], upper[2], 0, 1, 0);
            b.idx.push(v0, v1, v2, v0, v2, v3);
        }
    }
    return pack(b);
}
