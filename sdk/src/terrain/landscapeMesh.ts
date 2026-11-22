// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Vec3 } from '../types';
import { MeshChannel, MeshChannelType, type MeshData } from '../asset/meshFormat';
import { landscapeFrame, landscapeDirection, type LandscapeSpan, type LandscapeMesh, type LandscapePoint } from './landscapeSpline';

type Axis = 0 | 1 | 2;
type Triple = [number, number, number];
const axes = { X: 0, Y: 1, Z: 2 } as const;
const keys = ['x', 'y', 'z'] as const;
function dims(m: MeshData, entry: LandscapeMesh) {
    const f = axes[entry.forward],
        u = axes[entry.up];
    if (f === u) return null;
    const r = (3 - f - u) as Axis;
    return { f, u, r, sign: (f + 1) % 3 === u ? 1 : -1, length: m.aabbMax[f] - m.aabbMin[f], width: m.aabbMax[r] - m.aabbMin[r] };
}

interface Frame {
    origin: Vec3;
    basis: [Vec3, Vec3, Vec3];
    scale: Triple;
    local: Triple;
}
/** Rewrites only geometric channels. Colours, UVs and triangle material boundaries stay on their source vertices. */
function mapMesh(source: MeshData, frame: (p: Triple) => Frame): MeshData | null {
    const pos = source.channels.find((c) => c.semantic === MeshChannel.Position);
    if (!pos || pos.type !== MeshChannelType.Float32 || !source.vertexCount) return null;
    const dirs = source.channels.filter(
        (c) => (c.semantic === MeshChannel.Normal || c.semantic === MeshChannel.Tangent) && c.type === MeshChannelType.Float32,
    );
    const vertices = new Uint8Array(source.vertices),
        view = new DataView(vertices.buffer);
    const min: Triple = [Infinity, Infinity, Infinity],
        max: Triple = [-Infinity, -Infinity, -Infinity];
    const indices = source.indices.slice();
    let negative = false;
    for (let i = 0; i < source.vertexCount; i++) {
        const off = i * source.vertexStride,
            start = off + pos.offset;
        const p = [view.getFloat32(start, true), view.getFloat32(start + 4, true), view.getFloat32(start + 8, true)] as Triple;
        const { origin, basis, scale, local } = frame(p);
        negative = scale[0] * scale[1] * scale[2] < 0;
        for (const [k, key] of keys.entries()) {
            const n = origin[key] + basis[0][key] * local[0] + basis[1][key] * local[1] + basis[2][key] * local[2];
            view.setFloat32(start + 4 * k, n, true);
            min[k] = Math.min(min[k]!, n);
            max[k] = Math.max(max[k]!, n);
        }
        for (const c of dirs) {
            const v = keys.map(
                (_, k) =>
                    view.getFloat32(off + c.offset + 4 * k, true) *
                    (c.semantic === MeshChannel.Normal ? 1 / (scale[k] || 1e-8) : scale[k]!),
            );
            const result = keys.map((key) => basis[0][key] * v[0]! + basis[1][key] * v[1]! + basis[2][key] * v[2]!);
            const len = Math.hypot(...result) || 1;
            result.forEach((n, k) => view.setFloat32(off + c.offset + 4 * k, n / len, true));
            if (negative && c.semantic === MeshChannel.Tangent && c.components === 4)
                view.setFloat32(off + c.offset + 12, -view.getFloat32(off + c.offset + 12, true), true);
        }
    }
    if (negative)
        for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    return {
        channels: source.channels,
        indices,
        vertexCount: source.vertexCount,
        vertexStride: source.vertexStride,
        vertices,
        aabbMin: min,
        aabbMax: max,
    };
}
export function landscapePointMesh(m: MeshData, p: LandscapePoint): MeshData | null {
    const basis = landscapeFrame(landscapeDirection(p.rotation), p.rotation.z);
    return mapMesh(m, (local) => ({ origin: p, basis, scale: [1, 1, 1], local }));
}
export interface LandscapePiece {
    entry: LandscapeMesh;
    source: MeshData;
    start: number;
    end: number;
}
/** Fit whole instances to the curve, retaining the same seeded order on every reload. */
export function landscapePieces(span: LandscapeSpan, sources: ReadonlyMap<string, MeshData>): LandscapePiece[] {
    const options = span.segment.meshes.filter((entry) => {
        const mesh = sources.get(entry.mesh),
            axes = mesh && dims(mesh, entry);
        return axes && axes.length > 0 && entry.scale[keys[axes.f]] !== 0 && (!entry.scaleToWidth || axes.width > 0);
    });
    if (!options.length || span.curve.length < 1e-6) return [];
    let seed = span.segment.seed >>> 0,
        total = 0;
    const pieces: LandscapePiece[] = [];
    while (total < span.curve.length) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const entry = options[Math.floor((seed / 4294967296) * options.length)]!,
            source = sources.get(entry.mesh)!,
            d = dims(source, entry)!;
        const factor = entry.scaleToWidth ? span.curve.width(total) / Math.max(d.width, 1e-6) : 1;
        // Bound pathological zero-size source assets without losing the end of a valid span.
        const length = Math.max(span.curve.length / 4096, Math.abs(entry.scale[keys[d.f]] * d.length * factor));
        pieces.push({ entry, source, start: total, end: total + length });
        total += length;
    }
    const fit = span.curve.length / total;
    for (const p of pieces) {
        p.start *= fit;
        p.end *= fit;
    }
    return pieces;
}
/** Keep a straight edge within one percent of the road width of the curve it represents. */
function longitudinalSlices(span: LandscapeSpan, start: number, end: number): number {
    const curve = span.curve;
    const tolerance = Math.max(0.0001, Math.min(curve.width(start), curve.width(end)) * 0.01);
    const bank = Math.abs(span.b.rotation.z - span.a.rotation.z) / curve.length;
    const count = (from: number, to: number, level: number): number => {
        if (level === 5) return 1;
        const a = curve.position(from),
            b = curve.position(to);
        const bends = [0.25, 0.5, 0.75].some((t) => {
            const at = curve.position(from + (to - from) * t);
            return Math.hypot(...at.map((v, i) => v - (a[i]! + (b[i]! - a[i]!) * t))) > tolerance;
        });
        if (!bends && (to - from) * bank <= 15) return 1;
        const mid = (from + to) / 2;
        return 2 * Math.max(count(from, mid, level + 1), count(mid, to, level + 1));
    };
    return count(start, end, 0);
}

/** Split only triangles with long forward edges. Neighbours share their new vertex; duplicated UV seams keep their own. */
function subdivideRoad(source: MeshData, axis: Axis, slices: number): MeshData {
    const position = source.channels.find((c) => c.semantic === MeshChannel.Position);
    if (slices <= 1 || position?.type !== MeshChannelType.Float32) return source;
    const stride = source.vertexStride,
        component = position.offset + 4 * axis;
    const step = (source.aabbMax[axis] - source.aabbMin[axis]) / slices;
    let vertices = source.vertices,
        count = source.vertexCount;
    let view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const coordinate = (i: number) => view.getFloat32(i * stride + component, true);
    const splits = new Map<string, number>(),
        triangles: number[] = [];
    const midpoint = (a: number, b: number): number => {
        const key = Math.min(a, b) + ':' + Math.max(a, b),
            existing = splits.get(key);
        if (existing !== undefined) return existing;
        if (vertices === source.vertices || (count + 1) * stride > vertices.length) {
            const larger = new Uint8Array(Math.max(vertices.length * 2, (count + 1) * stride));
            larger.set(vertices);
            vertices = larger;
            view = new DataView(larger.buffer);
        }
        const index = count++,
            offset = index * stride;
        vertices.copyWithin(offset, a * stride, (a + 1) * stride);
        for (const c of source.channels) {
            if (c.semantic === MeshChannel.Joints) continue;
            for (let k = 0; k < c.components; k++) {
                if (c.semantic === MeshChannel.Tangent && k === 3) continue;
                if (c.type === MeshChannelType.Float32) {
                    const d = c.offset + 4 * k;
                    view.setFloat32(
                        offset + d,
                        (view.getFloat32(a * stride + d, true) + view.getFloat32(b * stride + d, true)) / 2,
                        true,
                    );
                } else if (c.type === MeshChannelType.UNorm16 || c.type === MeshChannelType.UInt16) {
                    const d = c.offset + 2 * k;
                    view.setUint16(
                        offset + d,
                        Math.round((view.getUint16(a * stride + d, true) + view.getUint16(b * stride + d, true)) / 2),
                        true,
                    );
                } else {
                    const d = c.offset + k;
                    vertices[offset + d] = Math.round((vertices[a * stride + d]! + vertices[b * stride + d]!) / 2);
                }
            }
        }
        splits.set(key, index);
        return index;
    };
    const split = (a: number, b: number, c: number): void => {
        const x = coordinate(a),
            y = coordinate(b),
            z = coordinate(c);
        const ab = Math.abs(x - y),
            bc = Math.abs(y - z),
            ca = Math.abs(z - x),
            longest = Math.max(ab, bc, ca);
        if (longest <= step * 1.00001) {
            triangles.push(a, b, c);
            return;
        }
        if (bc === longest) [a, b, c] = [b, c, a];
        else if (ca === longest) [a, b, c] = [c, a, b];
        const mid = midpoint(a, b);
        // At large local coordinates adjacent floats may already have no representable midpoint.
        if (coordinate(mid) === coordinate(a) || coordinate(mid) === coordinate(b)) {
            triangles.push(a, b, c);
            return;
        }
        split(a, mid, c);
        split(mid, b, c);
    };
    for (let i = 0; i + 2 < source.indices.length; i += 3) split(source.indices[i]!, source.indices[i + 1]!, source.indices[i + 2]!);
    return count === source.vertexCount
        ? source
        : { ...source, vertices: vertices.subarray(0, count * stride), vertexCount: count, indices: Uint32Array.from(triangles) };
}

export function deformLandscapeMesh(span: LandscapeSpan, piece: LandscapePiece): MeshData | null {
    const { source, entry, start, end } = piece,
        d = dims(source, entry);
    if (!d || d.length <= 0) return null;
    const axisScale = keys.map((k) => entry.scale[k]) as Triple;
    const offsets = keys.map((k) => entry.offset[k]);
    const surface = subdivideRoad(source, d.f, longitudinalSlices(span, start, end));
    return mapMesh(surface, (p) => {
        const fraction = (p[d.f] - source.aabbMin[d.f]) / d.length;
        const forwardSign = (span.segment.flipped ? -1 : 1) * (axisScale[d.f] < 0 ? -1 : 1);
        const at = start + (end - start) * (forwardSign < 0 ? 1 - fraction : fraction) + offsets[d.f]! * forwardSign;
        const along = Math.max(0, Math.min(span.curve.length, at));
        const center = span.curve.position(along),
            tan = span.curve.tangent(along);
        const ratio = along / span.curve.length;
        const [f, up, right] = landscapeFrame(
            { x: tan[0], y: tan[1], z: tan[2] },
            span.a.rotation.z + (span.b.rotation.z - span.a.rotation.z) * ratio,
        );
        const factor = entry.scaleToWidth ? span.curve.width(along) / Math.max(d.width, 1e-6) : 1;
        const basis = [f, up, right] as [Vec3, Vec3, Vec3];
        basis[d.f] = f;
        basis[d.u] = up;
        basis[d.r] = { x: right.x * d.sign, y: right.y * d.sign, z: right.z * d.sign };
        const scale = axisScale.map((s) => s * factor) as Triple;
        scale[d.f] = (forwardSign * (end - start)) / d.length;
        // Turning the mesh around reverses its side as well as its forward axis.
        scale[d.r] *= forwardSign;
        const local: Triple = [0, 0, 0];
        local[d.r] =
            (p[d.r] - (entry.center ? (source.aabbMax[d.r] + source.aabbMin[d.r]) / 2 : 0)) * scale[d.r] + offsets[d.r]! * forwardSign;
        local[d.u] = p[d.u] * scale[d.u] + offsets[d.u]!;
        local[d.f] = at - along;
        return { origin: { x: center[0], y: center[1], z: center[2] }, basis, scale, local };
    });
}
