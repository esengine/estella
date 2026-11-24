// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    inertialize.ts
 * @brief   A transition by inertia: the new motion plays at once, and the difference from where the old one had the
 *          skeleton is let die away.
 *
 * @details A crossfade samples both motions for its whole length and averages them, so for that time the character
 *          is in neither: a walk and a run averaged put a foot down in neither of their places, and it skims the
 *          ground. Inertialization samples only the motion being entered. On the frame it starts, each joint's offset
 *          from where the last frame left it is taken, with how fast that joint was moving, and the offset is carried
 *          down to nothing over the transition along a fifth-order curve that starts at that offset and that speed
 *          and arrives with no speed and no acceleration. The joint keeps the momentum it had and settles into the
 *          new motion, and nothing is ever two poses at once.
 *
 *          The curve is the one in David Bollo's "Inertialization: High-Performance Animation Transitions in Gears of
 *          War" (GDC 2018): an offset that is moving away from zero is treated as still, and the time is shortened
 *          for an offset already heading home fast enough to overshoot.
 */

import type { Entity } from '../types';
import type { Pose } from './pose';
import { Transform } from '../ecs/component';
import { q } from '../math/quat';

interface Vec3 { x: number; y: number; z: number }
interface Quat { w: number; x: number; y: number; z: number }

/** Where a joint stood in the pose a frame ended with. */
interface JointRecord { position: Vec3; rotation: Quat }

/** One joint's offset from the motion entered, and how it is carried away. */
interface JointInertia {
    /** The turn from the entered motion's rotation to where the joint was, as an axis and an angle that dies away. */
    axis: Vec3;
    angle: Curve;
    /** The same for its place. */
    direction: Vec3;
    distance: Curve;
}

/** A quintic from an offset and a speed to rest. */
interface Curve { x0: number; v0: number; a0: number; A: number; B: number; C: number; t1: number }

/** What one animator remembers between frames to inertialize with. */
export interface InertiaState {
    /** The pose the last frame ended with, and the one before it, with the seconds between. */
    last?: Map<Entity, JointRecord>;
    before?: Map<Entity, JointRecord>;
    lastDt: number;
    /** A transition under way. */
    active?: { joints: Map<Entity, JointInertia>; elapsed: number; duration: number };
}

/** The curve from `x0` moving at `v0` to rest within `duration`. */
function curve(x0: number, v0: number, duration: number): Curve {
    // Moving away from zero is treated as not moving: the curve does not chase it.
    const v = Math.min(v0, 0);
    let t1 = duration;
    // Heading home fast enough to cross zero before the end: arrive when it would have.
    if (v < 0) t1 = Math.min(t1, -5 * x0 / v);
    if (t1 <= 1e-6) return { x0: 0, v0: 0, a0: 0, A: 0, B: 0, C: 0, t1: 0 };
    const a0 = Math.max(0, (-8 * v * t1 - 20 * x0) / (t1 * t1));
    const A = -(a0 * t1 * t1 + 6 * v * t1 + 12 * x0) / (2 * t1 ** 5);
    const B = (3 * a0 * t1 * t1 + 16 * v * t1 + 30 * x0) / (2 * t1 ** 4);
    const C = -(3 * a0 * t1 * t1 + 12 * v * t1 + 20 * x0) / (2 * t1 ** 3);
    return { x0, v0: v, a0, A, B, C, t1 };
}

/** Where the curve is at `t`. */
export function inertiaAt(c: Curve, t: number): number {
    if (t >= c.t1) return 0;
    return (((c.A * t + c.B) * t + c.C) * t + c.a0 / 2) * t * t + c.v0 * t + c.x0;
}

/** Exposed for tests: the curve and its value, together. */
export function inertiaCurve(x0: number, v0: number, duration: number, t: number): number {
    return inertiaAt(curve(x0, v0, duration), t);
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

/** A rotation as an axis and an angle, the angle in 0..π. */
function axisAngle(r: Quat): { axis: Vec3; angle: number } {
    const w = r.w < 0 ? { w: -r.w, x: -r.x, y: -r.y, z: -r.z } : r;
    const s = Math.hypot(w.x, w.y, w.z);
    if (s < 1e-9) return { axis: { x: 1, y: 0, z: 0 }, angle: 0 };
    return { axis: { x: w.x / s, y: w.y / s, z: w.z / s }, angle: 2 * Math.atan2(s, w.w) };
}

const aboutAxis = (axis: Vec3, angle: number): Quat => {
    const s = Math.sin(angle / 2);
    return { w: Math.cos(angle / 2), x: axis.x * s, y: axis.y * s, z: axis.z * s };
};

/**
 * Begin a transition by inertia over `duration` seconds, against the pose this frame's motion stated. Joints the last
 * frame did not pose, or this one does not, are left to the new motion.
 */
export function beginInertia(state: InertiaState, pose: Pose, duration: number): void {
    const last = state.last;
    if (!last || duration <= 0) { state.active = undefined; return; }
    const joints = new Map<Entity, JointInertia>();
    const dt = state.lastDt;
    for (const track of pose.tracks) {
        if (track.def !== Transform) continue;
        const was = last.get(track.entity);
        if (!was) continue;
        const before = state.before?.get(track.entity);
        const rotation = track.data.rotation as Quat | undefined;
        const position = track.data.position as Vec3 | undefined;
        const joint: JointInertia = {
            axis: { x: 1, y: 0, z: 0 }, angle: curve(0, 0, duration),
            direction: { x: 1, y: 0, z: 0 }, distance: curve(0, 0, duration),
        };
        if (rotation) {
            const off = axisAngle(q.normalize(q.mul(was.rotation, q.conjugate(rotation))));
            let speed = 0;
            if (before && dt > 0) {
                const moved = axisAngle(q.normalize(q.mul(was.rotation, q.conjugate(before.rotation))));
                // How fast the offset was growing along its own axis: the joint's turn last frame, projected.
                speed = dot(moved.axis, off.axis) * moved.angle / dt;
            }
            joint.axis = off.axis;
            // How fast the offset is changing as the transition starts: the joint carrying on the way it was going.
            joint.angle = curve(off.angle, speed, duration);
        }
        if (position) {
            const off = sub(was.position, position);
            const distance = len(off);
            if (distance > 1e-9) {
                const direction = { x: off.x / distance, y: off.y / distance, z: off.z / distance };
                const speed = before && dt > 0 ? dot(sub(was.position, before.position), direction) / dt : 0;
                joint.direction = direction;
                joint.distance = curve(distance, speed, duration);
            }
        }
        joints.set(track.entity, joint);
    }
    state.active = { joints, elapsed: 0, duration };
}

/**
 * Carry the transition under way on by `dt` and lay what is left of each joint's offset over `pose`. Call every frame
 * after the motion is composed; a frame with no transition under way leaves the pose as it is.
 */
export function applyInertia(state: InertiaState, pose: Pose, dt: number, starting: boolean): void {
    const active = state.active;
    if (!active) return;
    if (!starting) active.elapsed += dt;
    if (active.elapsed >= active.duration) { state.active = undefined; return; }
    const t = active.elapsed;
    for (const track of pose.tracks) {
        if (track.def !== Transform) continue;
        const joint = active.joints.get(track.entity);
        if (!joint) continue;
        const rotation = track.data.rotation as Quat | undefined;
        if (rotation) {
            const angle = inertiaAt(joint.angle, t);
            if (angle !== 0) {
                const r = q.normalize(q.mul(aboutAxis(joint.axis, angle), rotation));
                track.data.rotation = { w: r.w, x: r.x, y: r.y, z: r.z };
                track.touched.add('rotation');
            }
        }
        const position = track.data.position as Vec3 | undefined;
        if (position) {
            const d = inertiaAt(joint.distance, t);
            if (d !== 0) {
                track.data.position = {
                    x: position.x + joint.direction.x * d,
                    y: position.y + joint.direction.y * d,
                    z: position.z + joint.direction.z * d,
                };
                track.touched.add('position');
            }
        }
    }
}

/** Remember the pose this frame ended with, as the last of two, for the next transition to start from. */
export function recordInertia(state: InertiaState, pose: Pose, dt: number): void {
    const next = state.before ?? new Map<Entity, JointRecord>();
    next.clear();
    for (const track of pose.tracks) {
        if (track.def !== Transform) continue;
        const r = track.data.rotation as Quat | undefined;
        const p = track.data.position as Vec3 | undefined;
        if (!r || !p) continue;
        next.set(track.entity, { position: { x: p.x, y: p.y, z: p.z }, rotation: { w: r.w, x: r.x, y: r.y, z: r.z } });
    }
    state.before = state.last;
    state.last = next;
    state.lastDt = dt;
}
