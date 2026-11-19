// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    placedSpline.ts
 * @brief   A Spline entity's curve where its Transform puts it, measured in world units: what everything that moves along one reads.
 *
 * @details A curve is built from the component's points once and kept until they change, one cache per world. Distances along it are
 *          in world units, the curve's own length times its entity's mean scale, so a speed or a camera's place on a rail means the same
 *          on a scaled spline. A PathFollower and a CameraDolly read the same curve through here.
 */
import { Transform, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import { SplineCurve } from './curve';
import { Spline, type SplineData } from './splineComponent';

type Vec3 = [number, number, number];
type Quat = { x: number; y: number; z: number; w: number };

/** A spline's curve and where it is. */
export interface PlacedSpline {
    curve: SplineCurve;
    /** The spline entity's Transform. */
    at: TransformData;
    /** World units per unit of the curve's own space. */
    unit: number;
    /** The curve's length in world units. */
    length: number;
}

const caches = new WeakMap<World, Map<number, { key: string; curve: SplineCurve }>>();

function turn(q: Quat, vx: number, vy: number, vz: number): Vec3 {
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

/** The curve of the Spline on `entity`, or null where there is none to follow (no entity, no Spline, fewer than two points). */
export function placedSpline(world: World, entity: number): PlacedSpline | null {
    if (entity <= 0 || !world.valid(entity as never)) return null;
    const spline = world.tryGet(entity as never, Spline) as SplineData | null;
    if (!spline || spline.points.length < 2) return null;
    const at = world.tryGet(entity as never, Transform) as TransformData | null;
    if (!at) return null;
    let cache = caches.get(world);
    if (!cache) caches.set(world, cache = new Map());
    const key = JSON.stringify([spline.points, spline.closed]);
    let held = cache.get(entity);
    if (!held || held.key !== key) {
        held = { key, curve: new SplineCurve(spline.points, spline.closed) };
        cache.set(entity, held);
    }
    const s = at.worldScale;
    // Speed is in world units and the curve's length is in its own: a scaled spline is longer in the world.
    const unit = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
    return { curve: held.curve, at, unit, length: held.curve.length * unit };
}

/** The world point `s` world units along the curve. */
export function splinePoint(placed: PlacedSpline, s: number): Vec3 {
    const { at } = placed;
    const local = placed.curve.position(s / placed.unit);
    const r = turn(at.worldRotation, local[0] * at.worldScale.x, local[1] * at.worldScale.y, local[2] * at.worldScale.z);
    return [r[0] + at.worldPosition.x, r[1] + at.worldPosition.y, r[2] + at.worldPosition.z];
}

/** The world direction of travel `s` world units along the curve, not normalised (a scaled spline stretches it). */
export function splineHeading(placed: PlacedSpline, s: number): Vec3 {
    const { at } = placed;
    const tan = placed.curve.tangent(s / placed.unit);
    return turn(at.worldRotation, tan[0] * at.worldScale.x, tan[1] * at.worldScale.y, tan[2] * at.worldScale.z);
}

/** How far along the curve, in world units, its point nearest the world point (x, y, z) is. */
export function splineNearest(placed: PlacedSpline, x: number, y: number, z: number): number {
    const { at } = placed;
    const q = at.worldRotation;
    const local = turn({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x - at.worldPosition.x, y - at.worldPosition.y, z - at.worldPosition.z);
    const sx = at.worldScale.x || 1, sy = at.worldScale.y || 1, sz = at.worldScale.z || 1;
    return placed.curve.nearestDistance(local[0] / sx, local[1] / sy, local[2] / sz) * placed.unit;
}

/** Lets go of the curves of entities that are gone. */
export function releaseGoneSplines(world: World): void {
    const cache = caches.get(world);
    if (!cache) return;
    for (const entity of [...cache.keys()]) if (!world.valid(entity as never)) cache.delete(entity);
}
