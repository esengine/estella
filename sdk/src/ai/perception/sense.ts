// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sense.ts
 * @brief   Line-of-sight / field-of-view sensing — pure geometry, unit-testable.
 *
 * `senseTarget` combines a range check, a cone (field-of-view) check, and an
 * optional occlusion callback (`isBlocked`, backed by a physics raycast in the
 * engine, a fake in tests) so the core stays free of any physics/wasm type. The
 * engine's perception system writes the result to a `Perception` component that
 * FSM conditions / BT leaves read via `ctx.get(Perception)`.
 *
 * Three-dimensional, with the flat case as its degenerate: a cone measured in
 * x and y sees through floors, and a scene the renderer and the solver both
 * treat as spatial has floors.
 */
import type { Quat, Vec3 } from '../../types';
import { q } from '../../math/quat';

export interface SenseResult {
    /** Target is within range, inside the cone, and not occluded. */
    visible: boolean;
    /** Distance to the target (always set, even when not visible). */
    distance: number;
    /** Unit direction observer→target, or zero when not visible. */
    dir: Vec3;
}

/**
 * Which of an entity's own axes its sensing cone points down. `x` is where a flat
 * scene's characters face (unrotated = screen-right); `-z` is where an imported
 * model faces, the convention the camera and lights use. Two conventions in one
 * engine, neither derivable from the other — the entity says which it means.
 */
export type FacingAxis = 'x' | '-z';

/** The world direction an entity with rotation `rot` faces along `axis`. */
export function facingFromRotation(rot: Quat, axis: FacingAxis = 'x'): Vec3 {
    return q.rotate(rot, axis === 'x' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: -1 });
}

/** Wrap an angle to (-π, π]. */
export function normalizeAngle(a: number): number {
    const twoPi = Math.PI * 2;
    a %= twoPi;
    if (a > Math.PI) a -= twoPi;
    else if (a <= -Math.PI) a += twoPi;
    return a;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Sense `target` from `observer`, which faces along `facing` (need not be unit).
 * `halfFov` is half the field-of-view in radians (≥ π means omnidirectional).
 * `isBlocked(from, to)` returns true when the line of sight is occluded. An
 * observer standing on the target is visible.
 */
export function senseTarget(
    observer: Vec3, facing: Vec3,
    target: Vec3,
    range: number, halfFov: number,
    isBlocked?: (from: Vec3, to: Vec3) => boolean,
): SenseResult {
    const dx = target.x - observer.x;
    const dy = target.y - observer.y;
    const dz = target.z - observer.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist === 0) return { visible: true, distance: 0, dir: ZERO };

    const miss: SenseResult = { visible: false, distance: dist, dir: ZERO };
    if (dist > range) return miss;
    if (halfFov < Math.PI) {
        // The cone as a dot product rather than an angle difference: the same
        // test where both lie in a plane, and the only one that survives leaving it.
        const fl = Math.sqrt(facing.x * facing.x + facing.y * facing.y + facing.z * facing.z);
        if (fl === 0) return miss; // a cone with no axis points nowhere
        const cos = (dx * facing.x + dy * facing.y + dz * facing.z) / (dist * fl);
        if (cos < Math.cos(halfFov)) return miss;
    }
    if (isBlocked?.(observer, target)) return miss;
    return { visible: true, distance: dist, dir: { x: dx / dist, y: dy / dist, z: dz / dist } };
}
