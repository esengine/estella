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
 */

export interface SenseResult {
    /** Target is within range, inside the cone, and not occluded. */
    visible: boolean;
    /** Distance to the target (always set, even when not visible). */
    distance: number;
    /** Unit direction observer→target, or (0,0) when not visible. */
    dirX: number;
    dirY: number;
}

/** 2D facing angle (radians) from a Transform quaternion's z/w (rotation about Z). */
export function facingFromQuat(z: number, w: number): number {
    return 2 * Math.atan2(z, w);
}

/** Wrap an angle to (-π, π]. */
export function normalizeAngle(a: number): number {
    const twoPi = Math.PI * 2;
    a %= twoPi;
    if (a > Math.PI) a -= twoPi;
    else if (a <= -Math.PI) a += twoPi;
    return a;
}

/**
 * Sense `target` from `observer`. `halfFov` is half the field-of-view in radians
 * (≥ π means omnidirectional). `isBlocked(ox,oy,tx,ty)` returns true when the
 * line of sight is occluded. An observer standing on the target is visible.
 */
export function senseTarget(
    ox: number, oy: number, facing: number,
    tx: number, ty: number,
    range: number, halfFov: number,
    isBlocked?: (ox: number, oy: number, tx: number, ty: number) => boolean,
): SenseResult {
    const dx = tx - ox;
    const dy = ty - oy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return { visible: true, distance: 0, dirX: 0, dirY: 0 };

    const miss: SenseResult = { visible: false, distance: dist, dirX: 0, dirY: 0 };
    if (dist > range) return miss;
    if (halfFov < Math.PI) {
        const delta = Math.abs(normalizeAngle(Math.atan2(dy, dx) - facing));
        if (delta > halfFov) return miss;
    }
    if (isBlocked?.(ox, oy, tx, ty)) return miss;
    return { visible: true, distance: dist, dirX: dx / dist, dirY: dy / dist };
}
