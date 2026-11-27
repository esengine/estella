// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  procMesh.ts — what a rules graph lays out, packed into a few meshes.
 *
 *        A city of forty thousand parts is forty thousand entities if each part is one, which no scene opens quickly.
 *        Packed, it is a mesh per cell of ground: every part's shape put where it stands, in its own colour (the
 *        vertex colour, which the built-in look multiplies by the renderer's tint), and cast-shadow parts kept apart
 *        from the rest so ground tiles and water do not darken what is under them. Positions are relative to the
 *        cell's centre, which is where its entity stands, so a big world keeps its precision.
 *
 *        A sphere here is a low one (a crown of leaves seen from a street does not need eight hundred vertices);
 *        every other shape is the engine's own builtin, so a packed part looks as the unpacked one does.
 */
import { builtinMeshTemplate } from '../../../sdk/src/asset/builtinMeshes';
import { MeshChannel, type MeshData } from '../../../sdk/src/asset/meshFormat';
import { mergeMeshes, worldMatrix } from '../../../sdk/src/render/staticBatch';
import type { Part, ProcResult } from './procEval';

export interface ProcCell {
    /** A name for the cell's file and entity: its column and row, whether it casts shadows, and its surface. */
    key: string;
    /** What the parts in it are made of ('' for nothing in particular): the source's `surfaces` say how it is drawn. */
    surface: string;
    /** Where its entity stands, in the scene's units. */
    at: [number, number, number];
    shadows: boolean;
    parts: number;
    mesh: MeshData;
}

/** Most vertices one packed mesh holds before the cell is split into another. */
const VERTEX_LIMIT = 250_000;

/** A UV sphere of 10 by 6, laid out as the builtins are (position, uv, colour, normal): 100 units across. */
function lowSphere(): MeshData {
    const cube = builtinMeshTemplate('builtin:cube')!.build();
    const seg = 10, rings = 6, r = 50;
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= rings; j++) {
        const v = j / rings, phi = v * Math.PI;
        for (let i = 0; i <= seg; i++) {
            const u = i / seg, th = u * Math.PI * 2;
            const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
            pos.push(n[0]! * r, n[1]! * r, n[2]! * r); nrm.push(...n); uv.push(u, v);
        }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + seg + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const stride = cube.vertexStride, count = pos.length / 3;
    const at = (s: number): number => cube.channels.find((c) => c.semantic === s)!.offset;
    const vertices = new Uint8Array(count * stride), dv = new DataView(vertices.buffer);
    for (let k = 0; k < count; k++) {
        const o = k * stride;
        for (let c = 0; c < 3; c++) { dv.setFloat32(o + at(MeshChannel.Position) + c * 4, pos[k * 3 + c]!, true); dv.setFloat32(o + at(MeshChannel.Normal) + c * 4, nrm[k * 3 + c]!, true); }
        dv.setFloat32(o + at(MeshChannel.TexCoord0), uv[k * 2]!, true); dv.setFloat32(o + at(MeshChannel.TexCoord0) + 4, uv[k * 2 + 1]!, true);
        dv.setUint32(o + at(MeshChannel.Color), 0xffffffff, true);
    }
    return { channels: cube.channels, vertexStride: stride, vertexCount: count, vertices, indices: new Uint32Array(idx), aabbMin: [-r, -r, -r], aabbMax: [r, r, r] };
}

const shapes = new Map<string, MeshData>();
function shapeOf(name: Part['mesh']): MeshData {
    let m = shapes.get(name);
    if (!m) {
        m = name === 'sphere' ? lowSphere() : builtinMeshTemplate(`builtin:${name}`)!.build();
        shapes.set(name, m);
    }
    return m;
}

/**
 * The part's shape in its colour, with its texture laid on at its real size: the vertex colour carries the part's colour
 * into the packed mesh, and each face's UV is where it lies on the part in the source's units over `tile`, taken in the
 * part's own frame, so the rows of a roof run down its slope and the grain of a column runs up it whichever way they turn.
 */
function painted(part: Part, tile: number): MeshData {
    const base = shapeOf(part.mesh);
    const color = part.color;
    const vertices = base.vertices.slice(), dv = new DataView(vertices.buffer);
    const off = base.channels.find((c) => c.semantic === MeshChannel.Color)!.offset;
    const po = base.channels.find((c) => c.semantic === MeshChannel.Position)!.offset;
    const no = base.channels.find((c) => c.semantic === MeshChannel.Normal)!.offset;
    const uo = base.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!.offset;
    // a builtin shape is 100 units across: its position over 100 is a share of the part's size
    const size = [part.sx / 100, part.sy / 100, part.sz / 100];
    for (let k = 0; k < base.vertexCount; k++) {
        const at = k * base.vertexStride;
        const lx = dv.getFloat32(at + po, true) * size[0]!, ly = dv.getFloat32(at + po + 4, true) * size[1]!, lz = dv.getFloat32(at + po + 8, true) * size[2]!;
        const nx = Math.abs(dv.getFloat32(at + no, true)), ny = Math.abs(dv.getFloat32(at + no + 4, true)), nz = Math.abs(dv.getFloat32(at + no + 8, true));
        // the face is laid on the plane it faces: a top on x and z, a side on its run and its height
        const [u, v] = ny >= nx && ny >= nz ? [lx, lz] : nx >= nz ? [lz, -ly] : [lx, -ly];
        dv.setFloat32(at + uo, u / tile, true);
        dv.setFloat32(at + uo + 4, v / tile, true);
    }
    const byte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
    const rgba = byte(color[0]) | (byte(color[1]) << 8) | (byte(color[2]) << 16) | (255 << 24);
    for (let k = 0; k < base.vertexCount; k++) dv.setUint32(k * base.vertexStride + off, rgba >>> 0, true);
    return { ...base, vertices };
}

/**
 * Packs the parts of @p result into meshes, one or more per `cell` of ground (the source's units) and per whether they
 * cast shadows. `unit` is world units to one of the source's, as the source says.
 */
export function packProcParts(result: ProcResult, options: { unit: number; cell?: number; tiles?: Record<string, number> }): ProcCell[] {
    const unit = options.unit, cell = options.cell ?? 300, k = unit / 100;
    const tileOf = (surface: string): number => options.tiles?.[surface] ?? 2;
    const buckets = new Map<string, { cx: number; cz: number; shadows: boolean; surface: string; parts: Part[] }>();
    for (const g of result.groups) for (const p of g.parts) {
        // A plant is not a shape to merge: it is drawn shared, with its own detail by distance (procPlants).
        if (p.plant || p.model) continue;
        const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
        const surface = p.surface ?? '';
        const key = `${cx}_${cz}_${p.shadows ? 's' : 'n'}${surface ? `_${surface}` : ''}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { cx, cz, shadows: p.shadows, surface, parts: [] }));
        b.parts.push(p);
    }
    const cells: ProcCell[] = [];
    for (const [key, b] of [...buckets].sort(([a], [c]) => (a < c ? -1 : 1))) {
        const centre: [number, number, number] = [(b.cx + 0.5) * cell * unit, 0, (b.cz + 0.5) * cell * unit];
        let chunk: Part[] = [], verts = 0, n = 0;
        const flush = (): void => {
            if (chunk.length === 0) return;
            const mesh = mergeMeshes(chunk.map((p) => ({
                mesh: painted(p, tileOf(b.surface)),
                world: worldMatrix({ x: p.x * unit - centre[0], y: p.y * unit, z: p.z * unit - centre[2] }, { x: p.q[0], y: p.q[1], z: p.q[2], w: p.q[3] }, { x: p.sx * k, y: p.sy * k, z: p.sz * k }),
            })));
            cells.push({ key: n === 0 ? key : `${key}_${n}`, surface: b.surface, at: centre, shadows: b.shadows, parts: chunk.length, mesh });
            n++; chunk = []; verts = 0;
        };
        for (const p of b.parts) {
            const v = shapeOf(p.mesh).vertexCount;
            if (verts + v > VERTEX_LIMIT) flush();
            chunk.push(p); verts += v;
        }
        flush();
    }
    return cells;
}

/** The plants of a run, in world units: the names of the kinds in the order a record counts them, and six numbers a plant (kind, x, y, z, turn about the vertical in radians, scale), as a PlacedFoliage reads them. */
export interface ProcPlants { kinds: string[]; records: number[]; min: [number, number]; max: [number, number] }

/** Where the plant nodes of a run stand, ready for a PlacedFoliage; null where it stood none. */
export function procPlants(result: ProcResult, unit: number): ProcPlants | null {
    const kinds: string[] = [], records: number[] = [];
    const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
    for (const g of result.groups) for (const p of g.parts) {
        if (!p.plant) continue;
        let kind = kinds.indexOf(p.plant);
        if (kind < 0) kind = kinds.push(p.plant) - 1;
        // A plant only turns about the vertical: its yaw is read back from the quaternion it was given.
        const turn = 2 * Math.atan2(p.q[1], p.q[3]);
        const x = p.x * unit, z = p.z * unit;
        records.push(kind, +x.toFixed(1), +(p.y * unit).toFixed(1), +z.toFixed(1), +turn.toFixed(3), +p.sy.toFixed(3));
        min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], z); max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], z);
    }
    return kinds.length > 0 ? { kinds, records, min, max } : null;
}

/** One model a run stands, in world units: where, turned how, and at what scale on each axis. */
export interface ProcModelPlace { kind: string; name: string; at: [number, number, number]; q: [number, number, number, number]; scale: [number, number, number]; shadows: boolean }

/** The model nodes of a run, each to be its own entity. */
export function procModels(result: ProcResult, unit: number): ProcModelPlace[] {
    const out: ProcModelPlace[] = [];
    for (const g of result.groups) for (const p of g.parts) {
        if (!p.model) continue;
        out.push({ kind: p.model, name: p.name, at: [p.x * unit, p.y * unit, p.z * unit], q: [p.q[0], p.q[1], p.q[2], p.q[3]], scale: [p.sx, p.sy, p.sz], shadows: p.shadows });
    }
    return out;
}
