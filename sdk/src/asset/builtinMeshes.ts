// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  builtinMeshes.ts — stock geometry a project references without owning a file.
 *        A `builtin:<id>` mesh ref names one of these; it is built here, not fetched.
 */

import { BUILTIN_REF_PREFIX, builtinRefId } from './documentRef';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from './meshFormat';

/**
 * The size every primitive is built at, matching `ShapeRenderer.size` — the other
 * renderable born from a menu rather than an asset. A cube is 100 units on a side,
 * so one dropped into a default scene is visible without being scaled first.
 */
const UNIT = 100;

const SECTORS = 32;
const STACKS = 16;

export interface BuiltinMeshTemplate {
    id: string;
    /** The ref an authored field carries. */
    ref: string;
    /** Menu / picker label. */
    label: string;
    description: string;
    /**
     * Whether the surface encloses a volume. A closed one is drawn opaque and
     * back-face culled — it can hide what is behind it and has an inside nobody
     * sees; a flat one stays two-sided, or a ground plane disappears from below.
     */
    closed: boolean;
    build(): MeshData;
}

interface Builder {
    pos: number[];
    uv: number[];
    nrm: number[];
    idx: number[];
}

/** One lathe ring: a circle at `y`, and the normal its vertices carry. */
interface Ring {
    y: number;
    radius: number;
    /** Radial component of the surface normal. */
    nr: number;
    /** Axial component of the surface normal. */
    ny: number;
    v: number;
}

const newBuilder = (): Builder => ({ pos: [], uv: [], nrm: [], idx: [] });

function vertex(b: Builder, p: readonly number[], u: number, v: number, n: readonly number[]): number {
    const at = b.pos.length / 3;
    b.pos.push(p[0]!, p[1]!, p[2]!);
    b.uv.push(u, v);
    b.nrm.push(n[0]!, n[1]!, n[2]!);
    return at;
}

function tri(b: Builder, a: number, c: number, d: number): void {
    b.idx.push(a, c, d);
}

/** A flat quad from four corners wound counter-clockwise seen from `n`. */
function quadFace(b: Builder, corners: readonly (readonly number[])[], n: readonly number[]): void {
    const a = vertex(b, corners[0]!, 0, 0, n);
    const c = vertex(b, corners[1]!, 1, 0, n);
    const d = vertex(b, corners[2]!, 1, 1, n);
    const e = vertex(b, corners[3]!, 0, 1, n);
    tri(b, a, c, d);
    tri(b, a, d, e);
}

/**
 * Revolve `rings` around the Y axis and connect consecutive ones. Every curved
 * surface here is this: a sphere is rings of shrinking radius, a cylinder is two
 * of equal radius, a cone is one of radius zero above one that is not.
 */
function lathe(b: Builder, rings: readonly Ring[], sectors: number): void {
    const base = b.pos.length / 3;
    for (const ring of rings) {
        for (let j = 0; j <= sectors; j++) {
            const theta = (j / sectors) * Math.PI * 2;
            const s = Math.sin(theta);
            const c = Math.cos(theta);
            const nx = s * ring.nr;
            const nz = c * ring.nr;
            const len = Math.hypot(nx, ring.ny, nz) || 1;
            vertex(b, [s * ring.radius, ring.y, c * ring.radius], j / sectors, ring.v,
                   [nx / len, ring.ny / len, nz / len]);
        }
    }
    const row = sectors + 1;
    for (let i = 0; i < rings.length - 1; i++) {
        const upper = rings[i]!;
        const lower = rings[i + 1]!;
        for (let j = 0; j < sectors; j++) {
            const a = base + i * row + j;
            const d = a + row;
            if (upper.radius > 0) tri(b, a, d, a + 1);
            if (lower.radius > 0) tri(b, a + 1, d, d + 1);
        }
    }
}

/** A flat disc at `y` facing `sign * Y`. */
function disc(b: Builder, y: number, radius: number, sign: number, sectors: number): void {
    const n = [0, sign, 0];
    const center = vertex(b, [0, y, 0], 0.5, 0.5, n);
    const rim: number[] = [];
    for (let j = 0; j <= sectors; j++) {
        const theta = (j / sectors) * Math.PI * 2;
        const s = Math.sin(theta);
        const c = Math.cos(theta);
        rim.push(vertex(b, [s * radius, y, c * radius], 0.5 + s * 0.5, 0.5 + c * 0.5, n));
    }
    for (let j = 0; j < sectors; j++) {
        if (sign > 0) tri(b, center, rim[j]!, rim[j + 1]!);
        else tri(b, center, rim[j + 1]!, rim[j]!);
    }
}

/** Rings tracing a hemisphere from `phiFrom` to `phiTo`, centred at `centerY`. */
function capRings(centerY: number, radius: number, phiFrom: number, phiTo: number,
                  stacks: number, vFrom: number, vTo: number): Ring[] {
    const out: Ring[] = [];
    for (let i = 0; i <= stacks; i++) {
        const t = i / stacks;
        const phi = phiFrom + (phiTo - phiFrom) * t;
        out.push({
            y: centerY + Math.cos(phi) * radius,
            radius: Math.sin(phi) * radius,
            nr: Math.sin(phi),
            ny: Math.cos(phi),
            v: vFrom + (vTo - vFrom) * t,
        });
    }
    return out;
}

function box(sx: number, sy: number, sz: number): Builder {
    const b = newBuilder();
    const x = sx / 2, y = sy / 2, z = sz / 2;
    quadFace(b, [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1]);
    quadFace(b, [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1]);
    quadFace(b, [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0]);
    quadFace(b, [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0]);
    quadFace(b, [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0]);
    quadFace(b, [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0]);
    return b;
}

function sphere(radius: number): Builder {
    const b = newBuilder();
    lathe(b, capRings(0, radius, 0, Math.PI, STACKS, 0, 1), SECTORS);
    return b;
}

function cylinder(radius: number, height: number): Builder {
    const b = newBuilder();
    const h = height / 2;
    lathe(b, [{ y: h, radius, nr: 1, ny: 0, v: 0 }, { y: -h, radius, nr: 1, ny: 0, v: 1 }], SECTORS);
    disc(b, h, radius, 1, SECTORS);
    disc(b, -h, radius, -1, SECTORS);
    return b;
}

function cone(radius: number, height: number): Builder {
    const b = newBuilder();
    const h = height / 2;
    const slant = Math.hypot(radius, height) || 1;
    const nr = height / slant;
    const ny = radius / slant;
    lathe(b, [{ y: h, radius: 0, nr, ny, v: 0 }, { y: -h, radius, nr, ny, v: 1 }], SECTORS);
    disc(b, -h, radius, -1, SECTORS);
    return b;
}

/** Total height is `2*radius + cylinderHeight`, the shape CapsuleCollider3D describes. */
function capsule(radius: number, cylinderHeight: number): Builder {
    const b = newBuilder();
    const h = cylinderHeight / 2;
    const stacks = Math.max(2, STACKS / 2);
    lathe(b, [
        ...capRings(h, radius, 0, Math.PI / 2, stacks, 0, 0.3),
        ...capRings(-h, radius, Math.PI / 2, Math.PI, stacks, 0.7, 1),
    ], SECTORS);
    return b;
}

function plane(size: number): Builder {
    const b = newBuilder();
    const h = size / 2;
    quadFace(b, [[-h, 0, h], [h, 0, h], [h, 0, -h], [-h, 0, -h]], [0, 1, 0]);
    return b;
}

function quad(size: number): Builder {
    const b = newBuilder();
    const h = size / 2;
    quadFace(b, [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], [0, 0, 1]);
    return b;
}

/**
 * Pack a builder into the channel layout the model import writes, so built-in and
 * imported geometry reach the renderer as the same kind of thing.
 */
function toMeshData(b: Builder): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertexCount = b.pos.length / 3;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const posAt = channels[0]!.offset;
    const uvAt = channels[1]!.offset;
    const colorAt = channels[2]!.offset;
    const normalAt = channels[3]!.offset;
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
        view.setUint32(at + colorAt, 0xffffffff, true);
    }

    return {
        channels, vertexStride, vertexCount, vertices,
        indices: new Uint32Array(b.idx),
        aabbMin: min, aabbMax: max,
    };
}

const template = (
    id: string, label: string, description: string, closed: boolean, build: () => Builder,
): BuiltinMeshTemplate =>
    ({ id, ref: BUILTIN_REF_PREFIX + id, label, description, closed, build: () => toMeshData(build()) });

export const BUILTIN_MESH_TEMPLATES: readonly BuiltinMeshTemplate[] = [
    template('cube', 'Cube', `A ${UNIT}-unit box, one flat normal per face.`, true,
             () => box(UNIT, UNIT, UNIT)),
    template('sphere', 'Sphere', `A ${UNIT}-unit sphere with smooth normals.`, true,
             () => sphere(UNIT / 2)),
    template('capsule', 'Capsule', `A ${UNIT}-unit upright capsule — what CapsuleCollider3D describes.`, true,
             () => capsule(UNIT / 4, UNIT / 2)),
    template('cylinder', 'Cylinder', `A ${UNIT}-unit upright cylinder with flat caps.`, true,
             () => cylinder(UNIT / 2, UNIT)),
    template('cone', 'Cone', `A ${UNIT}-unit cone standing on its base.`, true,
             () => cone(UNIT / 2, UNIT)),
    template('plane', 'Plane', `A ${UNIT}-unit ground square in XZ, facing up.`, false,
             () => plane(UNIT)),
    template('quad', 'Quad', `A ${UNIT}-unit square in XY, facing the camera.`, false,
             () => quad(UNIT)),
];

const byId = new Map(BUILTIN_MESH_TEMPLATES.map((t) => [t.id, t]));

/** The template a ref (or a bare id) names, or undefined for anything else. */
export function builtinMeshTemplate(ref: string): BuiltinMeshTemplate | undefined {
    return byId.get(builtinRefId(ref) ?? ref);
}

/** Whether `ref` names built-in geometry rather than a project file. */
export function isBuiltinMeshRef(ref: string): boolean {
    return builtinRefId(ref) !== null && builtinMeshTemplate(ref) !== undefined;
}
