// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorIK.ts
 * @brief   Bending the posed skeleton to reach something the clips did not know about.
 *
 * @details Three decisions shape this.
 *
 *          IK belongs to the CONTROLLER, not to a layer. A layer answers "who is
 *          speaking"; IK is the constraint reality puts on what was said — a foot
 *          belongs on the ground whichever layer decided how the leg swings — so
 *          it runs once, on the stack's answer, rather than once per layer.
 *
 *          It solves in the RIG's own space, reading the pose this frame just
 *          stated. `Transform.worldPosition` is last frame's, computed before the
 *          animator wrote anything, so a solver reading it plants the foot against
 *          a character that has already moved on.
 *
 *          The chain is derived from the tip. A two-bone solve is BY DEFINITION
 *          the tip and the two joints above it, so naming three would be three
 *          chances to name them inconsistently.
 */

import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { Parent, Transform, type TransformData } from '../ecs/component';
import { resolveChildEntity } from '../ecs/childPath';
import type { JointResolver } from './animatorAvatar';
import { q } from '../math/quat';
import { leanQuat } from './quatMix';
import type { Pose } from './pose';
import type { MotionParams } from './motion';

/** What an IK constraint does to the joint it names. */
export type AnimatorIKKind = 'two-bone' | 'look-at';

export interface AnimatorIK {
    kind: AnimatorIKKind;
    /** The joint the chain ends at, by the childPath a clip names it with. */
    tip: string;
    /** What it should reach, or look at, named the same way. */
    target: string;
    /** 0 leaves the pose alone, 1 puts the tip on the target. */
    weight?: number;
    /** A float parameter scaling `weight` — how a game fades a constraint in. */
    parameter?: string;
    /** two-bone: a joint the middle one bends towards. Absent keeps its own bend. */
    pole?: string;
    /** look-at: the tip's own axis that ends up pointing at the target. */
    axis?: 'x' | 'y' | 'z';
}

interface Vec3 { x: number; y: number; z: number }
interface Quat { w: number; x: number; y: number; z: number }

/** A joint placed in the rig's space, with the parent rotation that put it there. */
interface Placed {
    position: Vec3;
    rotation: Quat;
    parentRotation: Quat;
}

const AXIS: Record<'x' | 'y' | 'z', Vec3> = {
    x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 },
};

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function axisAngle(axis: Vec3, radians: number): Quat {
    const l = len(axis);
    if (l < 1e-9 || !Number.isFinite(radians)) return { w: 1, x: 0, y: 0, z: 0 };
    const h = radians / 2;
    const s = Math.sin(h) / l;
    return { w: Math.cos(h), x: axis.x * s, y: axis.y * s, z: axis.z * s };
}

/** Any direction perpendicular to `v`. Seeded off the component `v` leans on
 *  LEAST, so the cross never collapses. */
function perpendicular(v: Vec3): Vec3 {
    const seed = Math.abs(v.x) < Math.abs(v.y) && Math.abs(v.x) < Math.abs(v.z)
        ? AXIS.x
        : (Math.abs(v.y) < Math.abs(v.z) ? AXIS.y : AXIS.z);
    return cross(v, seed);
}

/**
 * The first candidate that can actually bend `bone`. A hinge PARALLEL to the bone
 * turns it not at all, so a straight limb — where the bend plane is undefined and
 * every axis derived from the reach can land along the bone — needs the check,
 * not just a non-zero vector.
 */
function pickAxis(bone: Vec3, candidates: (Vec3 | null)[]): Vec3 {
    for (const c of candidates) {
        if (!c || len(c) < 1e-6) continue;
        if (len(cross(c, bone)) < 1e-6) continue;
        return c;
    }
    return perpendicular(bone);
}

/** The angle between two vectors, clamped out of the range acos rejects. */
function angleBetween(a: Vec3, b: Vec3): number {
    const d = len(a) * len(b);
    if (d < 1e-9) return 0;
    return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / d)));
}

/**
 * A joint's local transform THIS frame: what the pose stated, or what the world
 * holds where no motion touched it. Reading the world alone would use values the
 * layers have already replaced.
 */
function localOf(world: World, pose: Pose, entity: Entity): TransformData | null {
    for (const track of pose.tracks) {
        if (track.entity === entity && track.def === Transform) {
            return track.data as unknown as TransformData;
        }
    }
    return world.has(entity, Transform) ? world.get(entity, Transform) as TransformData : null;
}

/** The joints from `rigRoot` down to `joint`, `rigRoot` excluded. Null when the
 *  joint is not under the rig at all. */
function chainTo(world: World, rigRoot: Entity, joint: Entity): Entity[] | null {
    const up: Entity[] = [];
    let at = joint;
    for (let guard = 0; guard < 64; guard++) {
        if (at === rigRoot) return up.reverse();
        up.push(at);
        const parent = parentOf(world, at);
        if (parent === null) return null;
        at = parent;
    }
    return null;
}

function parentOf(world: World, entity: Entity): Entity | null {
    const data = world.tryGet(entity, Parent) as { entity?: number } | null;
    return data && typeof data.entity === 'number' ? data.entity as Entity : null;
}

/**
 * Place `joint` in the rig's space by composing the pose down the chain. Rotation
 * only — a rig scaled per joint is a different problem, and silently folding a
 * scale in here would answer it wrongly rather than not at all.
 */
function place(world: World, pose: Pose, rigRoot: Entity, joint: Entity): Placed | null {
    const chain = chainTo(world, rigRoot, joint);
    if (!chain) return null;
    let position: Vec3 = { x: 0, y: 0, z: 0 };
    let rotation: Quat = { w: 1, x: 0, y: 0, z: 0 };
    let parentRotation: Quat = rotation;
    for (const link of chain) {
        const local = localOf(world, pose, link);
        if (!local) return null;
        parentRotation = rotation;
        position = add(position, q.rotate(rotation, local.position));
        rotation = q.normalize(q.mul(rotation, local.rotation));
    }
    return { position, rotation, parentRotation };
}

/** Write `worldRotation` back as the local rotation it implies under `parent`. */
function setLocalRotation(
    world: World, pose: Pose, entity: Entity, parentRotation: Quat, rotation: Quat,
): void {
    const track = pose.track(world, entity, Transform);
    if (!track) return;
    const local = q.normalize(q.mul(q.conjugate(parentRotation), rotation));
    track.data.rotation = { w: local.w, x: local.x, y: local.y, z: local.z };
    track.touched.add('rotation');
}

/** How much of this constraint applies, the parameter scaling what was authored. */
function weightOf(ik: AnimatorIK, params: MotionParams): number {
    const authored = ik.weight ?? 1;
    const scale = ik.parameter ? Number(params[ik.parameter] ?? 0) : 1;
    return Math.min(1, Math.max(0, authored * scale));
}

/**
 * Move `joint`'s LOCAL rotation `weight` of the way to what the solve wants. The
 * weight is a share of the answer, exactly as a layer's is — not a share of a
 * correction applied joint by joint, which compounds down a chain and leaves a
 * half-weight limb in a pose no solve ever produced.
 */
function leanJoint(
    world: World, pose: Pose, joint: Entity,
    parentRotation: Quat, wanted: Quat, weight: number,
): Quat {
    const local = q.normalize(q.mul(q.conjugate(parentRotation), wanted));
    const current = localOf(world, pose, joint)?.rotation ?? { w: 1, x: 0, y: 0, z: 0 };
    const blended = { w: current.w, x: current.x, y: current.y, z: current.z };
    if (weight >= 1) { blended.w = local.w; blended.x = local.x; blended.y = local.y; blended.z = local.z; }
    else leanQuat(blended, local, weight);

    const track = pose.track(world, joint, Transform);
    if (track) {
        track.data.rotation = { w: blended.w, x: blended.x, y: blended.y, z: blended.z };
        track.touched.add('rotation');
    }
    return q.normalize(q.mul(parentRotation, blended));
}

/** `v` with everything along `axis` taken out — the part of it that is a
 *  direction the limb can actually bend towards. */
function orthogonal(v: Vec3, axis: Vec3): Vec3 {
    const k = dot(v, axis);
    return { x: v.x - axis.x * k, y: v.y - axis.y * k, z: v.z - axis.z * k };
}

const normalized = (v: Vec3): Vec3 => {
    const l = len(v);
    return l < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l };
};

const scale = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

/**
 * Two-bone IK — the tip and the two joints above it — CONSTRUCTED, not corrected.
 * The elbow lies on a circle about the root-to-target line; the law of cosines
 * fixes where along it and how far off, and the pole picks the point. Nudging by
 * angle differences cannot reach the circle's far side: the axis lies along a bone.
 */
function solveTwoBone(
    world: World, pose: Pose, rigRoot: Entity, ik: AnimatorIK, weight: number,
    resolveJoint: JointResolver,
): boolean {
    const tip = resolveJoint(rigRoot, ik.tip);
    const target = resolveJoint(rigRoot, ik.target);
    if (tip === null || target === null) return false;
    const mid = parentOf(world, tip);
    const root = mid === null ? null : parentOf(world, mid);
    if (mid === null || root === null) return false;

    const pTip = place(world, pose, rigRoot, tip);
    const pMid = place(world, pose, rigRoot, mid);
    const pRoot = place(world, pose, rigRoot, root);
    const pTarget = place(world, pose, rigRoot, target);
    if (!pTip || !pMid || !pRoot || !pTarget) return false;

    const upper = sub(pMid.position, pRoot.position);
    const lower = sub(pTip.position, pMid.position);
    const reach = sub(pTarget.position, pRoot.position);
    const a = len(upper);
    const b = len(lower);
    if (a < 1e-6 || b < 1e-6 || len(reach) < 1e-6) return false;
    const c = Math.min(Math.max(len(reach), Math.abs(a - b) + 1e-5), a + b - 1e-5);
    const along = normalized(reach);

    // Which way the elbow leaves the line. A pole names it; without one the limb
    // keeps the bend it already has; and a limb that is dead straight has no bend
    // to keep, so any direction off the line will do.
    const pole = ik.pole ? resolveJoint(rigRoot, ik.pole) : null;
    const poleAt = pole === null ? null : place(world, pose, rigRoot, pole);
    const bendTowards = pickBend(along, [
        poleAt ? orthogonal(sub(poleAt.position, pRoot.position), along) : null,
        orthogonal(upper, along),
    ]);

    // The triangle: how far along the line the elbow sits, and how far off it.
    const cosRoot = Math.min(1, Math.max(-1, (a * a + c * c - b * b) / (2 * a * c)));
    const newMid = add(pRoot.position,
                       add(scale(along, a * cosRoot),
                           scale(bendTowards, a * Math.sqrt(Math.max(0, 1 - cosRoot * cosRoot)))));
    const newTip = add(pRoot.position, scale(along, c));

    const rootWanted = q.normalize(q.mul(
        q.rotationTo(upper, sub(newMid, pRoot.position)), pRoot.rotation));
    // The lower bone as the root's new orientation leaves it, before the elbow
    // turns: measured in the frame the mid joint will actually be in.
    const carried = q.normalize(q.mul(rootWanted, q.conjugate(pRoot.rotation)));
    const midWanted = q.normalize(q.mul(
        q.rotationTo(q.rotate(carried, lower), sub(newTip, newMid)),
        q.mul(carried, pMid.rotation)));

    const rootActual = leanJoint(world, pose, root, pRoot.parentRotation, rootWanted, weight);
    leanJoint(world, pose, mid, rootActual, midWanted, weight);
    return true;
}

/** The first direction that leaves the line; any will do for a straight limb. */
function pickBend(along: Vec3, candidates: (Vec3 | null)[]): Vec3 {
    for (const c of candidates) {
        if (c && len(c) > 1e-6) return normalized(c);
    }
    return normalized(perpendicular(along));
}

/** Look-at: the tip turns so its own `axis` points at the target. */
function solveLookAt(
    world: World, pose: Pose, rigRoot: Entity, ik: AnimatorIK, weight: number,
    resolveJoint: JointResolver,
): boolean {
    const tip = resolveJoint(rigRoot, ik.tip);
    const target = resolveJoint(rigRoot, ik.target);
    if (tip === null || target === null) return false;
    const pTip = place(world, pose, rigRoot, tip);
    const pTarget = place(world, pose, rigRoot, target);
    if (!pTip || !pTarget) return false;

    const facing = q.rotate(pTip.rotation, AXIS[ik.axis ?? 'z']);
    const toward = sub(pTarget.position, pTip.position);
    if (len(toward) < 1e-6) return false;
    const wanted = q.normalize(q.mul(q.rotationTo(facing, toward), pTip.rotation));
    leanJoint(world, pose, tip, pTip.parentRotation, wanted, weight);
    return true;
}

/**
 * Apply every constraint to the stack's answer, in the order they are declared:
 * one can move a joint another then reads, and an author who wrote them in an
 * order meant it.
 */
export function solveAnimatorIK(
    world: World, rigRoot: Entity, pose: Pose,
    constraints: readonly AnimatorIK[], params: MotionParams,
    resolveJoint: JointResolver = (root, path) => resolveChildEntity(world, root, path),
): void {
    for (const ik of constraints) {
        const weight = weightOf(ik, params);
        if (weight <= 0) continue;
        if (ik.kind === 'look-at') solveLookAt(world, pose, rigRoot, ik, weight, resolveJoint);
        else solveTwoBone(world, pose, rigRoot, ik, weight, resolveJoint);
    }
}
