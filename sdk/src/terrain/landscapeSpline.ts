// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Vec3 } from '../types';
import { SplineCurve, type SplinePoint } from '../spline/curve';

/** A named terrain layer is stored by slot, so renaming its material keeps the road painted. -1 leaves paint alone. */
export interface LandscapeGrade {
    layer: number;
    raise: boolean;
    lower: boolean;
}
export interface LandscapePoint extends Vec3, LandscapeGrade {
    id: number;
    rotation: Vec3;
    width: number;
    sideFalloff: number;
    endFalloff: number;
    mesh: string;
    material: string;
    sockets?: Array<{ name: string; offset: Vec3 }>;
}
export type LandscapeAxis = 'X' | 'Y' | 'Z';
export interface LandscapeMesh {
    mesh: string;
    material: string;
    center: boolean;
    offset: Vec3;
    scaleToWidth: boolean;
    scale: Vec3;
    forward: LandscapeAxis;
    up: LandscapeAxis;
}
export interface LandscapeEnd {
    point: number;
    tangent: number;
    socket: string;
}
export interface LandscapeSegment extends LandscapeGrade {
    id: number;
    start: LandscapeEnd;
    end: LandscapeEnd;
    meshes: LandscapeMesh[];
    flipped: boolean;
    seed: number;
    castShadow: boolean;
    hidden: boolean;
    drawDistance: number;
    sortPriority: number;
    collisionProfile: string;
    stream: boolean;
}
export interface LandscapeSpline {
    points: LandscapePoint[];
    segments: LandscapeSegment[];
}
export function emptyLandscapeSpline(): LandscapeSpline {
    return { points: [], segments: [] };
}
export function landscapeMesh(): LandscapeMesh {
    return {
        mesh: '',
        material: '',
        center: true,
        offset: { x: 0, y: 0, z: 0 },
        scaleToWidth: true,
        scale: { x: 1, y: 1, z: 1 },
        forward: 'X',
        up: 'Y',
    };
}
const deg = Math.PI / 180;
export function landscapePoint(id: number, at: Vec3, width: number): LandscapePoint {
    return {
        ...at,
        id,
        width,
        rotation: { x: 0, y: 0, z: 0 },
        sideFalloff: width / 2,
        endFalloff: width / 2,
        layer: -1,
        raise: true,
        lower: true,
        mesh: '',
        material: '',
    };
}
/** Rotation is pitch, yaw and bank in degrees. The forward direction at zero rotation is +X. */
export function landscapeDirection(rotation: Vec3): Vec3 {
    const p = rotation.x * deg,
        y = rotation.y * deg;
    return { x: Math.cos(p) * Math.cos(y), y: Math.sin(p), z: Math.cos(p) * Math.sin(y) };
}
export function landscapeRotation(v: Vec3, bank = 0): Vec3 {
    return { x: Math.atan2(v.y, Math.hypot(v.x, v.z)) / deg, y: Math.atan2(v.z, v.x) / deg, z: bank };
}
/** Forward, banked up and right, including vertical stretches. */
export function landscapeFrame(v: Vec3, bank: number): [Vec3, Vec3, Vec3] {
    const n = Math.hypot(v.x, v.y, v.z);
    const f = n > 1e-8 ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 1, y: 0, z: 0 };
    const h = Math.hypot(f.x, f.z);
    const r = h > 1e-8 ? { x: -f.z / h, y: 0, z: f.x / h } : { x: 0, y: 0, z: 1 };
    const up = { x: -r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y };
    const c = Math.cos(bank * deg),
        s = Math.sin(bank * deg);
    return [
        f,
        { x: up.x * c + r.x * s, y: up.y * c + r.y * s, z: up.z * c + r.z * s },
        { x: r.x * c - up.x * s, y: r.y * c - up.y * s, z: r.z * c - up.z * s },
    ];
}
function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
function difference(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scaled(v: Vec3, n: number): Vec3 {
    return { x: v.x * n, y: v.y * n, z: v.z * n };
}
export function connectLandscape(g: LandscapeSpline, a: LandscapePoint, b: LandscapePoint): LandscapeSegment | undefined {
    if (
        a.id === b.id ||
        g.segments.some((s) => (s.start.point === a.id && s.end.point === b.id) || (s.start.point === b.id && s.end.point === a.id))
    )
        return;
    const v = difference(b, a),
        length = Math.hypot(v.x, v.y, v.z);
    const end = (p: LandscapePoint) => ({
        point: p.id,
        tangent: length * (dot(v, landscapeDirection(p.rotation)) < 0 ? -1 : 1),
        socket: '',
    });
    const id = nextLandscapeId(g.segments);
    const segment: LandscapeSegment = {
        id,
        start: end(a),
        end: end(b),
        layer: -1,
        raise: true,
        lower: true,
        meshes: [],
        flipped: false,
        seed: id,
        castShadow: true,
        hidden: false,
        drawDistance: 0,
        sortPriority: 0,
        collisionProfile: 'None',
        stream: true,
    };
    g.segments.push(segment);
    return segment;
}
export function nextLandscapeId(items: readonly { id: number }[]): number {
    return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
export function orientLandscapePoints(g: LandscapeSpline, ids: ReadonlySet<number>): void {
    const points = new Map(g.points.map((p) => [p.id, p]));
    for (const id of ids) {
        const p = points.get(id);
        if (!p) continue;
        const edges = g.segments.filter((s) => s.start.point === id || s.end.point === id);
        if (!edges.length) continue;
        const sum = { x: 0, y: 0, z: 0 };
        for (const s of edges) {
            const a = points.get(s.start.point),
                b = points.get(s.end.point);
            if (!a || !b) continue;
            const v = difference(b, a),
                length = Math.hypot(v.x, v.y, v.z) || 1;
            const k = (dot(sum, v) < 0 ? -1 : 1) / length;
            sum.x += k * v.x;
            sum.y += k * v.y;
            sum.z += k * v.z;
        }
        if (Math.hypot(sum.x, sum.y, sum.z) < 1e-8) continue;
        p.rotation = landscapeRotation(sum, p.rotation.z);
        for (const s of edges) {
            const a = points.get(s.start.point),
                b = points.get(s.end.point);
            if (!a || !b) continue;
            const tip = a.id === id ? s.start : s.end;
            tip.tangent = Math.abs(tip.tangent) * (dot(difference(b, a), sum) < 0 ? -1 : 1);
        }
    }
}
/** One cubic Hermite span, using the same arc-length sampler as roads, rivers and camera rails. */
export class LandscapeSpan {
    readonly curve: SplineCurve;
    readonly from: Vec3;
    readonly into: Vec3;
    constructor(
        readonly a: LandscapePoint,
        readonly b: LandscapePoint,
        readonly segment: LandscapeSegment,
    ) {
        const socketPoint = (p: LandscapePoint, name: string) => {
            const tip = name && p.sockets?.find((s) => s.name === name);
            if (!tip) return p;
            const frame = landscapeFrame(landscapeDirection(p.rotation), p.rotation.z);
            const d = tip.offset;
            return {
                ...p,
                x: p.x + frame[0].x * d.x + frame[1].x * d.y + frame[2].x * d.z,
                y: p.y + frame[0].y * d.x + frame[1].y * d.y + frame[2].y * d.z,
                z: p.z + frame[0].z * d.x + frame[1].z * d.y + frame[2].z * d.z,
            };
        };
        this.a = a = socketPoint(a, segment.start.socket);
        this.b = b = socketPoint(b, segment.end.socket);
        this.from = scaled(landscapeDirection(a.rotation), segment.start.tangent);
        this.into = scaled(landscapeDirection(b.rotation), segment.end.tangent);
        const points: SplinePoint[] = [
            { ...a, type: 'customTangent', leaveTangent: this.from },
            { ...b, type: 'customTangent', arriveTangent: this.into },
        ];
        this.curve = new SplineCurve(points);
    }
    at(t: number): Vec3 {
        const u = 1 - t,
            h = t * t * (3 - 2 * t);
        const axis = (k: keyof Vec3) => this.a[k] * (1 - h) + this.b[k] * h + t * u * (u * this.from[k] - t * this.into[k]);
        return { x: axis('x'), y: axis('y'), z: axis('z') };
    }
    derivative(t: number): Vec3 {
        const axis = (k: keyof Vec3) =>
            6 * t * (1 - t) * (this.b[k] - this.a[k]) + (3 * t * t - 4 * t + 1) * this.from[k] + (3 * t * t - 2 * t) * this.into[k];
        return { x: axis('x'), y: axis('y'), z: axis('z') };
    }
}
export function landscapeSpans(g: LandscapeSpline): LandscapeSpan[] {
    const points = new Map(g.points.map((p) => [p.id, p]));
    const spans: LandscapeSpan[] = [];
    for (const s of g.segments) {
        const a = points.get(s.start.point),
            b = points.get(s.end.point);
        if (a && b) spans.push(new LandscapeSpan(a, b, s));
    }
    return spans;
}
/** Subdivide the cubic at its parameter. Both children's derivatives scale with their parameter interval. */
export function splitLandscape(g: LandscapeSpline, id: number, t: number): LandscapePoint | undefined {
    const span = landscapeSpans(g).find((s) => s.segment.id === id);
    if (!span || t <= 0 || t >= 1) return;
    const { a, b, segment } = span;
    const mix = (x: number, y: number) => x + (y - x) * t;
    const d = span.derivative(t),
        len = Math.hypot(d.x, d.y, d.z);
    const p = landscapePoint(nextLandscapeId(g.points), span.at(t), mix(a.width, b.width));
    Object.assign(p, {
        rotation: landscapeRotation(d, mix(a.rotation.z, b.rotation.z)),
        sideFalloff: mix(a.sideFalloff, b.sideFalloff),
        endFalloff: mix(a.endFalloff, b.endFalloff),
        layer: segment.layer,
        raise: segment.raise,
        lower: segment.lower,
    });
    const tail = structuredClone(segment);
    tail.id = nextLandscapeId(g.segments);
    tail.start = { point: p.id, tangent: len * (1 - t), socket: '' };
    tail.end.tangent *= 1 - t;
    segment.start.tangent *= t;
    segment.end = { point: p.id, tangent: len * t, socket: '' };
    g.points.push(p);
    g.segments.push(tail);
    return p;
}
export function connectedLandscape(
    g: LandscapeSpline,
    points: Iterable<number>,
    segments: Iterable<number>,
): { points: Set<number>; segments: Set<number> } {
    const seen = new Set(points),
        edges = new Set(segments),
        adjacent = new Map<number, LandscapeSegment[]>();
    for (const s of g.segments) {
        if (edges.has(s.id)) {
            seen.add(s.start.point);
            seen.add(s.end.point);
        }
        for (const id of [s.start.point, s.end.point]) {
            if (!adjacent.has(id)) adjacent.set(id, []);
            adjacent.get(id)!.push(s);
        }
    }
    for (const id of seen)
        for (const s of adjacent.get(id) ?? []) {
            edges.add(s.id);
            seen.add(s.start.point);
            seen.add(s.end.point);
        }
    return { points: seen, segments: edges };
}
