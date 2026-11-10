// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gripContact.ts
 * @brief   What a held object is to the fingers: simple shapes they close onto, and stop at.
 *
 * @details A mesh is too much to ask of every finger every frame, and the part of an object a hand closes around is nearly always a
 *          handle, a barrel, a ball or a block. So the object says so: a `GripSurface` on it, or on anything under it, is a cylinder,
 *          a capsule, a sphere or a box, sized in its own units as a collider is. Fingers close joint by joint until a bone meets one,
 *          and the thumb's reach is moved out of them. Nothing here needs physics: it is a distance from a point to a shape.
 */
import { defineComponent, Children, Transform, type ComponentDef, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import { q } from '../math/quat';
import type { Entity } from '../types';

interface Vec3 { x: number; y: number; z: number }
interface Quat { w: number; x: number; y: number; z: number }

/** The shape a grip surface is. @experimental */
export const GripSurfaceShape = { Cylinder: 0, Capsule: 1, Sphere: 2, Box: 3 } as const;

/** The fields of the `GripSurface` component. @experimental */
export interface GripSurfaceData {
    shape: number;
    /** The axis a cylinder or capsule runs along, of the entity's own: 0 X, 1 Y, 2 Z. */
    direction: number;
    /** Its middle, in the entity's own units. */
    center: Vec3;
    /** A cylinder's, capsule's or sphere's radius. */
    radius: number;
    /** A cylinder's or capsule's whole length, ends included. */
    height: number;
    /** A box's size. */
    size: Vec3;
}

/**
 * A shape on a held object that fingers close onto and stop at: a handle, a barrel, a mug's body. Goes on the object or anything under it;
 * a `GripProfile` with `wrap` on closes each hand's fingers onto every one there.
 *
 * @experimental
 */
export const GripSurface: ComponentDef<GripSurfaceData> = /* @__PURE__ */ defineComponent<GripSurfaceData>('GripSurface', {
    shape: GripSurfaceShape.Cylinder, direction: 1, center: { x: 0, y: 0, z: 0 }, radius: 0.5, height: 1, size: { x: 1, y: 1, z: 1 },
}, {
    fields: {
        shape: { enum: [{ label: 'Cylinder', value: 0 }, { label: 'Capsule', value: 1 }, { label: 'Sphere', value: 2 }, { label: 'Box', value: 3 }], tooltip: 'What the fingers close onto.' },
        direction: { enum: [{ label: 'X', value: 0 }, { label: 'Y', value: 1 }, { label: 'Z', value: 2 }], tooltip: 'The axis a cylinder or capsule runs along.' },
        center: { tooltip: 'Its middle, in this entity\'s own units.' },
        radius: { min: 0, step: 0.001, tooltip: 'A cylinder\'s, capsule\'s or sphere\'s radius.' },
        height: { min: 0, step: 0.001, tooltip: 'A cylinder\'s or capsule\'s whole length.' },
        size: { tooltip: 'A box\'s size.' },
    },
});

/** A surface as this frame has it, in world units: a shape about `center`, turned by `turn`. @internal */
export interface PlacedSurface {
    shape: number;
    center: Vec3;
    turn: Quat;
    /** For a cylinder or capsule, the axis; the other numbers by shape: radius, half its length (a capsule's between its ends' centres), a box's half sizes. */
    axis: number;
    radius: number;
    half: number;
    halves: Vec3;
}

const childrenOf = (world: World, e: Entity): Entity[] => (world.tryGet(e, Children) as { entities?: Entity[] } | null)?.entities ?? [];
const pick = (v: Vec3, axis: number): number => (axis === 0 ? v.x : axis === 2 ? v.z : v.y);

/** Every grip surface on `root` and under it, placed where its transform now is. Transforms must be composed. @internal */
export function surfacesUnder(world: World, root: Entity): PlacedSurface[] {
    const out: PlacedSurface[] = [];
    const queue: Entity[] = [root];
    for (let i = 0; i < queue.length && i < 256; i++) {
        const at = queue[i]!;
        if (world.has(at, GripSurface) && world.has(at, Transform)) {
            const s = world.get(at, GripSurface) as GripSurfaceData;
            const t = world.get(at, Transform) as TransformData;
            const k = { x: Math.abs(t.worldScale.x), y: Math.abs(t.worldScale.y), z: Math.abs(t.worldScale.z) };
            const turn = q.normalize(t.worldRotation);
            const c = s.center ?? { x: 0, y: 0, z: 0 };
            const center = { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z };
            const off = q.rotate(turn, { x: c.x * k.x, y: c.y * k.y, z: c.z * k.z });
            center.x += off.x; center.y += off.y; center.z += off.z;
            const axis = s.direction === 0 || s.direction === 2 ? s.direction : 1;
            // Round across, so its radius takes the larger of the two scales square to it.
            const across = axis === 0 ? Math.max(k.y, k.z) : axis === 2 ? Math.max(k.x, k.y) : Math.max(k.x, k.z);
            const radius = Math.max(0, s.radius) * (s.shape === GripSurfaceShape.Sphere ? Math.max(k.x, k.y, k.z) : across);
            const length = Math.max(0, s.height) * pick(k, axis);
            const half = s.shape === GripSurfaceShape.Capsule ? Math.max(0, length / 2 - radius) : length / 2;
            const size = s.size ?? { x: 1, y: 1, z: 1 };
            out.push({ shape: s.shape, center, turn, axis, radius, half, halves: { x: Math.abs(size.x) * k.x / 2, y: Math.abs(size.y) * k.y / 2, z: Math.abs(size.z) * k.z / 2 } });
        }
        queue.push(...childrenOf(world, at));
    }
    return out;
}

/**
 * Every grip surface on `object` and under it as lines in the world, where the fingers meet them: what an editor draws. Transforms must be
 * composed.
 * @experimental
 */
export function gripSurfaceLines(world: World, object: Entity): { x: number; y: number; z: number }[][] {
    const out: Vec3[][] = [];
    const N = 24;
    for (const s of surfacesUnder(world, object)) {
        const place = (v: Vec3): Vec3 => { const w = q.rotate(s.turn, v); return { x: s.center.x + w.x, y: s.center.y + w.y, z: s.center.z + w.z }; };
        // A local point with `a` along the shape's axis and (u, v) round it.
        const onAxis = (a: number, u: number, v: number): Vec3 => (s.axis === 0 ? { x: a, y: u, z: v } : s.axis === 2 ? { x: u, y: v, z: a } : { x: u, y: a, z: v });
        const ring = (a: number, r: number, from = 0, to = Math.PI * 2, n = N): Vec3[] => Array.from({ length: n + 1 }, (_, i) => {
            const t = from + ((to - from) * i) / n;
            return place(onAxis(a, Math.cos(t) * r, Math.sin(t) * r));
        });
        if (s.shape === GripSurfaceShape.Box) {
            const h = s.halves;
            const c = (x: number, y: number, z: number): Vec3 => place({ x: x * h.x, y: y * h.y, z: z * h.z });
            out.push([c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), c(-1, -1, -1)], [c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1), c(-1, 1, -1)]);
            for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) out.push([c(x, -1, z), c(x, 1, z)]);
        } else if (s.shape === GripSurfaceShape.Sphere) {
            const r = s.radius;
            const circle = (f: (t: number) => Vec3): Vec3[] => Array.from({ length: N + 1 }, (_, i) => place(f((Math.PI * 2 * i) / N)));
            out.push(circle((t) => ({ x: Math.cos(t) * r, y: Math.sin(t) * r, z: 0 })), circle((t) => ({ x: Math.cos(t) * r, y: 0, z: Math.sin(t) * r })), circle((t) => ({ x: 0, y: Math.cos(t) * r, z: Math.sin(t) * r })));
        } else {
            out.push(ring(s.half, s.radius), ring(-s.half, s.radius));
            for (let k = 0; k < 4; k++) {
                const t = (k * Math.PI) / 2, u = Math.cos(t) * s.radius, v = Math.sin(t) * s.radius;
                out.push([place(onAxis(-s.half, u, v)), place(onAxis(s.half, u, v))]);
            }
            if (s.shape === GripSurfaceShape.Capsule) {
                // The two ends' half circles, across both ways.
                for (const end of [1, -1]) {
                    for (const side of [0, 1]) {
                        out.push(Array.from({ length: N / 2 + 1 }, (_, i) => {
                            const t = (Math.PI * i) / (N / 2), a = end * (s.half + Math.sin(t) * s.radius), r = Math.cos(t) * s.radius;
                            return place(side ? onAxis(a, 0, r) : onAxis(a, r, 0));
                        }));
                    }
                }
            }
        }
    }
    return out;
}

/** How far a point in the world is from the surface, outside positive, inside negative. */
function distanceTo(s: PlacedSurface, p: Vec3): number {
    const l = q.rotate(q.conjugate(s.turn), { x: p.x - s.center.x, y: p.y - s.center.y, z: p.z - s.center.z });
    if (s.shape === GripSurfaceShape.Sphere) return Math.hypot(l.x, l.y, l.z) - s.radius;
    if (s.shape === GripSurfaceShape.Box) {
        const dx = Math.abs(l.x) - s.halves.x, dy = Math.abs(l.y) - s.halves.y, dz = Math.abs(l.z) - s.halves.z;
        return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
    }
    const along = pick(l, s.axis);
    const round = s.axis === 0 ? Math.hypot(l.y, l.z) : s.axis === 2 ? Math.hypot(l.x, l.y) : Math.hypot(l.x, l.z);
    if (s.shape === GripSurfaceShape.Capsule) {
        const past = Math.abs(along) - s.half;
        return Math.hypot(round, Math.max(past, 0)) - s.radius;
    }
    const a = round - s.radius, b = Math.abs(along) - s.half;
    return Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0));
}

/** How far a point is from the nearest of the surfaces. Infinite with none. @internal */
export function surfaceDistance(surfaces: readonly PlacedSurface[], p: Vec3): number {
    let d = Infinity;
    for (const s of surfaces) { const v = distanceTo(s, p); if (v < d) d = v; }
    return d;
}

/** The way out of the nearest surface at a point, by the change of distance across `step`. @internal */
export function surfaceOutward(surfaces: readonly PlacedSurface[], p: Vec3, step: number): Vec3 {
    const at = (x: number, y: number, z: number): number => surfaceDistance(surfaces, { x: p.x + x, y: p.y + y, z: p.z + z });
    const g = { x: at(step, 0, 0) - at(-step, 0, 0), y: at(0, step, 0) - at(0, -step, 0), z: at(0, 0, step) - at(0, 0, -step) };
    const l = Math.hypot(g.x, g.y, g.z);
    return l < 1e-12 ? { x: 0, y: 0, z: 0 } : { x: g.x / l, y: g.y / l, z: g.z / l };
}

/** How near a bone from `a` to `b` comes to any surface, its line measured at a few points along it. @internal */
export function boneDistance(surfaces: readonly PlacedSurface[], a: Vec3, b: Vec3): number {
    let d = Infinity;
    for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const v = surfaceDistance(surfaces, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
        if (v < d) d = v;
    }
    return d;
}

/**
 * A finger closed from `start` toward `limit`, every free joint together, until its bones meet a surface: a bone that touches holds itself
 * and every joint before it where it touched, and those after it go on closing. `touching(bends, from)` answers the first bone from `from` on
 * that touches with these bends, or -1. Answers the bends, and whether any bone touched.
 * @internal
 */
export function closeFinger(start: readonly number[], limit: readonly number[], touching: (bends: readonly number[], from: number) => number): { bends: number[]; touched: boolean } {
    const n = start.length;
    const bends = [...start];
    let free = 0, touched = false;
    const STEPS = 40;
    let t = 0;
    const set = (to: number): void => { for (let j = free; j < n; j++) bends[j] = start[j]! + (limit[j]! - start[j]!) * to; };
    while (free < n && t < 1) {
        const next = Math.min(1, t + 1 / STEPS);
        set(next);
        if (touching(bends, free) < 0) { t = next; continue; }
        // Between the last clear step and this one: halve to where a bone meets it.
        let lo = t, hi = next;
        for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2;
            set(mid);
            if (touching(bends, free) >= 0) hi = mid; else lo = mid;
        }
        set(hi);
        const at = touching(bends, free);
        set(lo);
        touched = true;
        // The bone that touched holds, and so does every joint before it; those after it go on from here.
        free = Math.max(free, at) + 1;
        t = lo;
    }
    return { bends, touched };
}
