// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    figureSkeleton.ts
 * @brief   The bones of a humanoid and a pose of them: where each joint is and which way it has turned, for a figure layer to draw on.
 *
 * @details The authoring pipeline builds, skins and animates whole models on these same bones (pipeline/src/modeling reads them from
 *          here), so a figure drawn in a picture stands as the model it is a sketch of does. Nothing here knows a surface.
 */

export type Vec3 = readonly [number, number, number];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => {
    const l = length(a);
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

export const MAX_RIG_JOINTS = 256;
const DEG = Math.PI / 180;

// ---- Joints ---------------------------------------------------------------------

export interface RigJointSource {
    name: string;
    at: Vec3;
    parent?: string;
    /** Also exists reflected across this axis: `arm` becomes `arm.L` on the positive side and `arm.R` on the other. */
    mirror?: 'x' | 'y' | 'z';
}

export interface AnimationTrack {
    joint: string;
    /** [time, x, y, z] in degrees, X then Y then Z, from the bind pose. */
    rotate?: readonly (readonly number[])[];
    /** [time, x, y, z] from where the joint rests. */
    move?: readonly (readonly number[])[];
    /**
     * [time, x, y, z] where this joint must be, in the model's own space: the foot of a two-bone limb,
     * whose parent and grandparent turn to put it there. `rotate` on the same track then holds it at
     * that orientation in the model's space, and left out it stays level with the ground.
     */
    reach?: readonly (readonly number[])[];
    /** The way the middle joint of a `reach` bends: forward for a knee, back for an elbow. Default the way it already bends, else +Z. */
    pole?: Vec3;
    /** Straight lines between keys, for a foot sliding along the ground: a curve would dip through it. */
    linear?: boolean;
    /** Shifts the keys by this fraction of the clip: the other leg, half a stride behind. */
    phase?: number;
}

export interface AnimationSource {
    name: string;
    duration: number;
    /** Default true. */
    loop?: boolean;
    tracks?: readonly AnimationTrack[];
    /** Weights of the model's `shapes` over the clip: a blink, a mouth. `value` is [time, weight]. */
    shapes?: readonly { name: string; value: readonly (readonly number[])[]; phase?: number; linear?: boolean }[];
}

export interface RigJoint {
    name: string;
    at: Vec3;
    parent: number;
    children: number[];
}

/** Joints flattened, mirrored ones expanded, parents always before their children. */
export function resolveJoints(rig: { joints: readonly RigJointSource[] }): RigJoint[] {
    const out: { name: string; at: Vec3; parentName: string | undefined }[] = [];
    const mirrored = new Set(rig.joints.filter((j) => j.mirror).map((j) => j.name));
    for (const j of rig.joints) {
        if (!j.mirror) {
            out.push({ name: j.name, at: j.at, parentName: j.parent });
            continue;
        }
        const k = { x: 0, y: 1, z: 2 }[j.mirror];
        const flip = [...j.at] as [number, number, number];
        flip[k] = -flip[k];
        const positive = j.at[k]! >= 0;
        const side = (s: string): string | undefined => (j.parent === undefined ? undefined : mirrored.has(j.parent) ? `${j.parent}.${s}` : j.parent);
        out.push({ name: `${j.name}.L`, at: positive ? j.at : flip, parentName: side('L') });
        out.push({ name: `${j.name}.R`, at: positive ? flip : j.at, parentName: side('R') });
    }
    if (out.length === 0) throw new Error('a rig needs at least one joint');
    if (out.length > MAX_RIG_JOINTS) throw new Error(`this rig has ${out.length} joints; a mesh can be posed by at most ${MAX_RIG_JOINTS}`);
    const index = new Map<string, number>();
    out.forEach((j, i) => {
        if (index.has(j.name)) throw new Error(`there are two joints called "${j.name}"`);
        index.set(j.name, i);
    });
    const parents = out.map((j) => {
        if (j.parentName === undefined) return -1;
        const p = index.get(j.parentName);
        if (p === undefined) throw new Error(`joint "${j.name}" has parent "${j.parentName}", which is not a joint; there are ${out.map((o) => o.name).join(', ')}`);
        return p;
    });
    if (parents.filter((p) => p < 0).length !== 1) {
        throw new Error(`a rig has one root; these have no parent: ${out.filter((_, i) => parents[i]! < 0).map((j) => j.name).join(', ')}`);
    }
    // Parents first, which also proves there is no loop.
    const order: number[] = [];
    const placed = new Set<number>();
    while (order.length < out.length) {
        const before = order.length;
        out.forEach((_, i) => {
            if (!placed.has(i) && (parents[i]! < 0 || placed.has(parents[i]!))) { order.push(i); placed.add(i); }
        });
        if (order.length === before) throw new Error('the joints\' parents go round in a loop');
    }
    const newIndex = new Map(order.map((old, i) => [old, i]));
    const joints: RigJoint[] = order.map((old) => ({
        name: out[old]!.name, at: out[old]!.at, parent: parents[old]! < 0 ? -1 : newIndex.get(parents[old]!)!, children: [],
    }));
    joints.forEach((j, i) => { if (j.parent >= 0) joints[j.parent]!.children.push(i); });
    return joints;
}

// ---- Motion ---------------------------------------------------------------------

export type Quat = readonly [number, number, number, number];

export const quatMul = (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** X, then Y, then Z. */
export function eulerToQuat(x: number, y: number, z: number): Quat {
    const axis = (i: number, deg: number): Quat => {
        const h = (deg * DEG) / 2;
        const q = [0, 0, 0, Math.cos(h)] as [number, number, number, number];
        q[i] = Math.sin(h);
        return q;
    };
    return quatMul(axis(2, z), quatMul(axis(1, y), axis(0, x)));
}

export function rotateBy(q: Quat, v: Vec3): Vec3 {
    const u: Vec3 = [q[0], q[1], q[2]];
    const t = scale(cross(u, v), 2);
    return add(add(v, scale(t, q[3])), cross(u, t));
}

/** A key track's value at @p time: a smooth line through the keys, passing through each exactly. */
export function sample(keys: readonly (readonly number[])[], time: number, duration: number, loop: boolean, phase: number, linear = false): Vec3 {
    const shifted = keys.map((k) => [k[0]! + phase * duration, k[1]!, k[2]!, k[3]!] as const);
    const wrap = (t: number): number => ((t % duration) + duration) % duration;
    const list = (loop ? shifted.map((k) => [wrap(k[0]), k[1], k[2], k[3]] as const) : shifted).slice().sort((a, b) => a[0] - b[0]);
    const n = list.length;
    if (n === 1) return [list[0]![1], list[0]![2], list[0]![3]];
    if (!loop && time <= list[0]![0]) return [list[0]![1], list[0]![2], list[0]![3]];
    if (!loop && time >= list[n - 1]![0]) return [list[n - 1]![1], list[n - 1]![2], list[n - 1]![3]];
    const at = (i: number): readonly number[] => {
        if (loop) {
            const turns = Math.floor(i / n);
            const k = list[((i % n) + n) % n]!;
            return [k[0] + turns * duration, k[1], k[2], k[3]];
        }
        return list[Math.max(0, Math.min(n - 1, i))]!;
    };
    let i = loop ? -1 : 0;
    const t = loop ? wrap(time) : time;
    while (at(i + 1)[0]! <= t) i++;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const span = p2[0]! - p1[0]!;
    const u = span > 0 ? (t - p1[0]!) / span : 0;
    if (linear) return [1, 2, 3].map((c) => p1[c]! + (p2[c]! - p1[c]!) * u) as unknown as Vec3;
    const [u2, u3] = [u * u, u * u * u];
    const v = [1, 2, 3].map((c) => {
        const [a, b] = [p1[c]!, p2[c]!];
        const m1 = ((b - p0[c]!) / Math.max(p2[0]! - p0[0]!, 1e-6)) * span;
        const m2 = ((p3[c]! - a) / Math.max(p3[0]! - p1[0]!, 1e-6)) * span;
        return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m2;
    });
    return v as unknown as Vec3;
}

export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** The shortest rotation taking direction @p from onto @p to. */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
    const a = normalize(from), b = normalize(to);
    const d = dot(a, b);
    if (d > 1 - 1e-9) return [0, 0, 0, 1];
    if (d < -1 + 1e-9) {
        const side = normalize(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
        return [side[0], side[1], side[2], 0];
    }
    const c = cross(a, b);
    const w = 1 + d;
    const len = Math.hypot(c[0], c[1], c[2], w);
    return [c[0] / len, c[1] / len, c[2] / len, w / len];
}

export interface Pose {
    /** Relative to the parent: what a clip writes. */
    local: { q: Quat; offset: Vec3 }[];
    /** In the model's space: what skinning reads. */
    world: { q: Quat; origin: Vec3 }[];
}

export function toWorld(joints: readonly RigJoint[], local: Pose['local']): Pose['world'] {
    const world: Pose['world'] = [];
    joints.forEach((j, i) => {
        const l = local[i]!;
        if (j.parent < 0) world[i] = { q: l.q, origin: l.offset };
        else {
            const p = world[j.parent]!;
            world[i] = { q: quatMul(p.q, l.q), origin: add(p.origin, rotateBy(p.q, l.offset)) };
        }
    });
    return world;
}

/** Each joint at @p time, with every `reach` solved; the bind pose with no animation. */
export function poseAt(joints: readonly RigJoint[], animation: AnimationSource | null, time: number, solve?: PoseSolve): Pose {
    const loop = animation?.loop !== false;
    const at = (keys: readonly (readonly number[])[], t: AnimationTrack): Vec3 => sample(keys, time, animation!.duration, loop, t.phase ?? 0, t.linear === true);
    const local: Pose['local'] = joints.map((j) => {
        const track = animation?.tracks?.find((t) => t.joint === j.name);
        const euler = track?.rotate && !track.reach ? at(track.rotate, track) : [0, 0, 0] as Vec3;
        const moved = track?.move ? at(track.move, track) : [0, 0, 0] as Vec3;
        const rest = j.parent >= 0 ? sub(j.at, joints[j.parent]!.at) : j.at;
        return { q: eulerToQuat(euler[0], euler[1], euler[2]), offset: add(rest, moved) };
    });
    let world = toWorld(joints, local);
    for (const track of animation?.tracks ?? []) {
        if (!track.reach) continue;
        const foot = joints.findIndex((j) => j.name === track.joint);
        const held = track.rotate ? at(track.rotate, track) : [0, 0, 0] as Vec3;
        world = bendLimb(joints, local, world, foot, at(track.reach, track), track.pole, eulerToQuat(held[0], held[1], held[2]));
    }
    if (solve) world = applyConstraints(joints, local, world, solve);
    return { local, world };
}

/**
 * The two bones above @p foot turned to put it on @p target, leaving `local` changed and answering the world it makes.
 * @p footWorld holds the foot at that orientation; left out it goes on as the clip had it, carried by the turn.
 */
export function bendLimb(joints: readonly RigJoint[], local: Pose['local'], world: Pose['world'], foot: number, target: Vec3, pole: Vec3 | undefined, footWorld?: Quat): Pose['world'] {
    const lower = joints[foot]!.parent, upper = joints[lower]!.parent, above = joints[upper]!.parent;
    const a = world[upper]!.origin, b = world[lower]!.origin, c = world[foot]!.origin;
    const upperLen = length(sub(joints[lower]!.at, joints[upper]!.at)), lowerLen = length(sub(joints[foot]!.at, joints[lower]!.at));
    const toTarget = sub(target, a);
    const near = Math.abs(upperLen - lowerLen) + 1e-4, far = upperLen + lowerLen - 1e-4;
    // Out of reach it stretches straight toward the target; the report cannot say so per frame, the strip shows it.
    const span = Math.max(near, Math.min(far, length(toTarget)));
    const along = normalize(toTarget);
    const bent = sub(b, add(a, scale(along, dot(sub(b, a), along))));
    const hint = pole ?? (length(bent) > upperLen * 0.01 ? bent : [0, 0, 1] as Vec3);
    let side = sub(hint, scale(along, dot(hint, along)));
    if (length(side) < 1e-6) side = sub([1, 0, 0], scale(along, along[0]));
    const toKnee = (upperLen * upperLen - lowerLen * lowerLen + span * span) / (2 * span);
    const out = Math.sqrt(Math.max(0, upperLen * upperLen - toKnee * toKnee));
    const knee = add(add(a, scale(along, toKnee)), scale(normalize(side), out));
    const end = add(a, scale(along, span));
    const turn = rotationBetween(sub(b, a), sub(knee, a));
    const upperWorld = quatMul(turn, world[upper]!.q);
    // Where the foot would now be, carried by the upper bone, is what the lower bone turns from.
    const lowerWorld = quatMul(rotationBetween(rotateBy(turn, sub(c, b)), sub(end, knee)), quatMul(turn, world[lower]!.q));
    const parentWorld = above >= 0 ? world[above]!.q : [0, 0, 0, 1] as Quat;
    const keptFoot = footWorld ?? quatMul(conjugate(world[lower]!.q), world[foot]!.q);
    local[upper] = { ...local[upper]!, q: quatMul(conjugate(parentWorld), upperWorld) };
    local[lower] = { ...local[lower]!, q: quatMul(conjugate(upperWorld), lowerWorld) };
    local[foot] = { ...local[foot]!, q: footWorld ? quatMul(conjugate(lowerWorld), keptFoot) : local[foot]!.q };
    return toWorld(joints, local);
}

/** A flat test ground for a preview: `height` at the rig's origin, rising by `slope` per unit of x and z. */
export interface PreviewGround {
    height?: number;
    slope?: readonly [number, number];
}

export interface RigGoal {
    name: string;
    at: Vec3;
    parent?: string;
}

export interface ControllerIk {
    kind: 'two-bone' | 'look-at' | 'foot-plant';
    /** The joint the chain ends at. */
    tip: string;
    /** A joint or a rig goal it reaches or looks at. A foot-plant has none: the ground is its target. */
    target?: string;
    /** foot-plant: the joint lowered so the leg can reach the lower foot. */
    pelvis?: string;
    /** foot-plant: lay the foot along the slope. Default true. */
    align?: boolean;
    /** foot-plant: how far up and down to look for ground, in the model's units. */
    reach?: number;
    /** foot-plant: seconds to settle on a new height. */
    smooth?: number;
    /** foot-plant: the physics layers that count as ground. */
    layers?: number;
    pole?: string;
    weight?: number;
    /** A float parameter scaling the weight, to fade it in. */
    parameter?: string;
    /** look-at: which of the tip's own axes points at the target. */
    axis?: 'x' | 'y' | 'z';
}

/** What the game does on top of the clips, for a preview: the controller's constraints, and the ground its foot-plants stand on. */
export interface PoseSolve {
    ik: readonly ControllerIk[];
    goals: readonly RigGoal[];
    /** Foot-plants do nothing without one: the game asks physics, and here there is none. */
    ground?: PreviewGround;
}

export const MAX_FOOT_TILT = Math.PI / 4;

/** The engine's constraint pass, on the CPU: foot-plants first and together, the rest in order. Mirrors sdk/src/animation/animatorIK.ts. */
export function applyConstraints(joints: readonly RigJoint[], local: Pose['local'], start: Pose['world'], solve: PoseSolve): Pose['world'] {
    let world = start;
    const index = (name: string | undefined): number => (name === undefined ? -1 : joints.findIndex((j) => j.name === name));
    const placeOf = (name: string | undefined): Vec3 | null => {
        if (name === undefined) return null;
        const j = index(name);
        if (j >= 0) return world[j]!.origin;
        const goal = solve.goals.find((g) => g.name === name);
        if (!goal) return null;
        const parent = index(goal.parent);
        if (parent < 0) return goal.at;
        return add(world[parent]!.origin, rotateBy(world[parent]!.q, sub(goal.at, joints[parent]!.at)));
    };
    if (solve.ground) {
        const height = solve.ground.height ?? 0;
        const [sx, sz] = solve.ground.slope ?? [0, 0];
        const normal = normalize([-sx, 1, -sz]);
        const feet = solve.ik.filter((k) => k.kind === 'foot-plant').map((k) => {
            const foot = index(k.tip);
            const at_ = world[foot]!.origin;
            return { k, foot, at: at_, q: world[foot]!.q, lift: height + sx * at_[0] + sz * at_[2] };
        });
        const drops = new Map<string, number>();
        for (const f of feet) if (f.k.pelvis) drops.set(f.k.pelvis, Math.min(drops.get(f.k.pelvis) ?? 0, f.lift * (f.k.weight ?? 1)));
        for (const [name, drop] of drops) {
            if (drop >= 0) continue;
            const p = index(name);
            const parent = joints[p]!.parent;
            const inParent = parent >= 0 ? rotateBy(conjugate(world[parent]!.q), [0, drop, 0]) : [0, drop, 0] as Vec3;
            local[p] = { ...local[p]!, offset: add(local[p]!.offset, inParent) };
        }
        if (drops.size) world = toWorld(joints, local);
        const tilt = Math.acos(Math.min(1, normal[1]));
        const limited = tilt > MAX_FOOT_TILT ? normalize(add(scale([0, 1, 0], Math.sin(tilt - MAX_FOOT_TILT)), scale(normal, Math.sin(MAX_FOOT_TILT)))) : normal;
        for (const f of feet) {
            const weight = Math.min(1, Math.max(0, f.k.weight ?? 1));
            const goal: Vec3 = [f.at[0], f.at[1] + f.lift * weight, f.at[2]];
            const aligned = f.k.align === false ? undefined : quatMul(rotationBetween([0, 1, 0], limited), f.q);
            world = bendLimb(joints, local, world, f.foot, goal, placeOf(f.k.pole) ?? undefined, aligned);
        }
    }
    for (const k of solve.ik) {
        if (k.kind === 'foot-plant') continue;
        const tip = index(k.tip);
        const target = placeOf(k.target);
        if (tip < 0 || !target) continue;
        if (k.kind === 'two-bone') {
            const pole = placeOf(k.pole);
            world = bendLimb(joints, local, world, tip, target, pole ? sub(pole, world[joints[joints[tip]!.parent]!.parent]!.origin) : undefined);
        } else {
            const axis: Vec3 = k.axis === 'x' ? [1, 0, 0] : k.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
            const facing = rotateBy(world[tip]!.q, axis);
            const wanted = quatMul(rotationBetween(facing, sub(target, world[tip]!.origin)), world[tip]!.q);
            const parent = joints[tip]!.parent;
            local[tip] = { ...local[tip]!, q: quatMul(conjugate(parent >= 0 ? world[parent]!.q : [0, 0, 0, 1]), wanted) };
            world = toWorld(joints, local);
        }
    }
    return world;
}

/** Where each joint is in a pose: for checking a foot landed. */
export function jointPositions(joints: readonly RigJoint[], animation: AnimationSource | null, time: number, solve?: PoseSolve): Record<string, Vec3> {
    const { world } = poseAt(joints, animation, time, solve);
    return Object.fromEntries(joints.map((j, i) => [j.name, world[i]!.origin]));
}

/** Where each joint is in a pose, and which way its own axes have turned from rest. */
export function jointFrames(joints: readonly RigJoint[], animation: AnimationSource | null, time: number, solve?: PoseSolve): Record<string, { at: Vec3; x: Vec3; y: Vec3; z: Vec3 }> {
    const { world } = poseAt(joints, animation, time, solve);
    return Object.fromEntries(joints.map((j, i) => {
        const { origin, q } = world[i]!;
        return [j.name, { at: origin, x: rotateBy(q, [1, 0, 0]), y: rotateBy(q, [0, 1, 0]), z: rotateBy(q, [0, 0, 1]) }];
    }));
}

// ---- A humanoid's bones ---------------------------------------------------------

export interface HumanoidBuild {
    /** From the floor to the crown. Default 1.6. */
    height?: number;
    /** Size of the head against the body. Default 1; above it younger or more stylised. */
    head?: number;
    /** Width of each, against the table. Default 1. */
    shoulders?: number;
    chest?: number;
    waist?: number;
    hips?: number;
    /** Thickness of the arms and legs. Default 1. */
    limbs?: number;
}

export interface Section { y: number; across: number; front: number; back: number; z: number; x?: number }

/** The table is for a body 1.6 tall. */
export const TABLE_HEIGHT = 1.6;

export const TORSO: readonly Section[] = [
    { y: 1.345, across: 0.05, front: 0.05, back: 0.055, z: -0.018 },
    { y: 1.315, across: 0.082, front: 0.058, back: 0.066, z: -0.022 },
    { y: 1.285, across: 0.145, front: 0.068, back: 0.074, z: -0.022 },
    { y: 1.25, across: 0.158, front: 0.08, back: 0.08, z: -0.018 },
    { y: 1.2, across: 0.142, front: 0.094, back: 0.082, z: -0.012 },
    { y: 1.145, across: 0.125, front: 0.098, back: 0.076, z: -0.006 },
    { y: 1.09, across: 0.108, front: 0.08, back: 0.068, z: -0.004 },
    { y: 1.03, across: 0.096, front: 0.066, back: 0.056, z: -0.002 },
    { y: 0.975, across: 0.104, front: 0.068, back: 0.058, z: 0 },
    { y: 0.915, across: 0.122, front: 0.074, back: 0.076, z: -0.004 },
    { y: 0.85, across: 0.14, front: 0.076, back: 0.088, z: -0.006 },
    { y: 0.79, across: 0.132, front: 0.07, back: 0.08, z: -0.004 },
    { y: 0.745, across: 0.08, front: 0.06, back: 0.06, z: -0.004 },
];

export const ARM_DROP = (62 * Math.PI) / 180;

export interface HumanoidFrame {
    k: number;
    shoulder: Vec3; elbow: Vec3; wrist: Vec3; knuckle: Vec3;
    hip: Vec3; knee: Vec3; ankle: Vec3; ball: Vec3; toe: Vec3;
    pelvis: Vec3; waist: Vec3; chest: Vec3; neck: Vec3; head: Vec3; crown: Vec3;
    /** Along the arm, from the shoulder out and down. */
    along: Vec3;
    fingers: readonly { name: string; base: Vec3; length: number; radius: number }[];
    thumb: { base: Vec3; mid: Vec3; tip: Vec3 };
}

/** Where everything is, in the table's own proportions times its height. Also what a skeleton is laid on. */
export function humanoidFrame(b: HumanoidBuild = {}): HumanoidFrame {
    const k = (b.height ?? TABLE_HEIGHT) / TABLE_HEIGHT;
    const s = (x: number, y: number, z: number): Vec3 => [x * k, y * k, z * k];
    const along: Vec3 = [Math.sin(ARM_DROP), -Math.cos(ARM_DROP), 0];
    const shoulderX = 0.158 * (b.shoulders ?? 1);
    const at = (d: number): Vec3 => s(shoulderX + along[0] * d, 1.268 + along[1] * d, -0.018);
    const palmAt = 0.27 + 0.235 + 0.09;
    const fingers = [
        { name: 'index', z: 0.027, length: 0.078, radius: 0.0085 },
        { name: 'middle', z: 0.009, length: 0.086, radius: 0.0088 },
        { name: 'ring', z: -0.009, length: 0.08, radius: 0.0082 },
        { name: 'little', z: -0.026, length: 0.062, radius: 0.0072 },
    ].map((f) => {
        const base = at(palmAt);
        return { name: f.name, base: [base[0], base[1], base[2] + f.z * k] as Vec3, length: f.length * k, radius: f.radius * k };
    });
    const wrist = at(0.27 + 0.235);
    const thumbBase: Vec3 = [wrist[0] + along[0] * 0.022 * k, wrist[1] + along[1] * 0.022 * k - 0.004 * k, wrist[2] + 0.028 * k];
    const thumbMid: Vec3 = [thumbBase[0] + along[0] * 0.038 * k, thumbBase[1] + along[1] * 0.038 * k - 0.006 * k, thumbBase[2] + 0.024 * k];
    const thumbTip: Vec3 = [thumbMid[0] + along[0] * 0.036 * k, thumbMid[1] + along[1] * 0.036 * k - 0.006 * k, thumbMid[2] + 0.01 * k];
    return {
        k, along,
        shoulder: at(0), elbow: at(0.27), wrist, knuckle: at(palmAt),
        hip: s(0.08, 0.81, -0.004), knee: s(0.068, 0.445, 0.006), ankle: s(0.067, 0.078, -0.016), ball: s(0.072, 0.022, 0.09), toe: s(0.072, 0.018, 0.165),
        pelvis: s(0, 0.86, -0.004), waist: s(0, 1.0, 0), chest: s(0, 1.16, -0.008), neck: s(0, 1.32, -0.022), head: s(0, 1.405, -0.01), crown: s(0, TABLE_HEIGHT, -0.012),
        fingers, thumb: { base: thumbBase, mid: thumbMid, tip: thumbTip },
    };
}

/** The bones of a humanoid of this build, named as a clip names them. `.L` is her left, on +x. */
export function humanoidJoints(b: HumanoidBuild = {}): RigJointSource[] {
    const f = humanoidFrame(b);
    const mid = (a: Vec3, c: Vec3, t: number): Vec3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    const clavicle: Vec3 = [0.03 * f.k, 1.29 * f.k, -0.008 * f.k];
    const joints: RigJointSource[] = [
        { name: 'hips', at: f.pelvis },
        { name: 'spine', at: f.waist, parent: 'hips' },
        { name: 'chest', at: f.chest, parent: 'spine' },
        { name: 'neck', at: f.neck, parent: 'chest' },
        { name: 'head', at: f.head, parent: 'neck' },
        { name: 'crown', at: f.crown, parent: 'head' },
        { name: 'clavicle', at: clavicle, parent: 'chest', mirror: 'x' },
        { name: 'upperArm', at: f.shoulder, parent: 'clavicle', mirror: 'x' },
        { name: 'forearm', at: f.elbow, parent: 'upperArm', mirror: 'x' },
        { name: 'hand', at: f.wrist, parent: 'forearm', mirror: 'x' },
        { name: 'thumb1', at: f.thumb.base, parent: 'hand', mirror: 'x' },
        { name: 'thumb2', at: f.thumb.mid, parent: 'thumb1', mirror: 'x' },
        { name: 'thumb3', at: f.thumb.tip, parent: 'thumb2', mirror: 'x' },
        { name: 'thigh', at: f.hip, parent: 'hips', mirror: 'x' },
        { name: 'shin', at: f.knee, parent: 'thigh', mirror: 'x' },
        { name: 'foot', at: f.ankle, parent: 'shin', mirror: 'x' },
        { name: 'toes', at: f.ball, parent: 'foot', mirror: 'x' },
        { name: 'toeTip', at: f.toe, parent: 'toes', mirror: 'x' },
    ];
    for (const finger of f.fingers) {
        let parent = 'hand';
        for (let i = 0; i < 4; i++) {
            const name = `${finger.name}${i + 1}`;
            const t = [0, 0.45, 0.75, 1][i]!;
            joints.push({ name, at: mid(finger.base, [finger.base[0] + f.along[0] * finger.length, finger.base[1] + f.along[1] * finger.length, finger.base[2]], t), parent, mirror: 'x' });
            parent = name;
        }
    }
    return joints;
}

// ---- A pose ---------------------------------------------------------------------

export interface PoseParams {
    /** The bones of a humanoid of this build; true for the default one. */
    humanoid: HumanoidBuild | true;
    /** joint name to [x, y, z] degrees from its rest, X then Y then Z. */
    rotate?: Readonly<Record<string, readonly number[]>>;
    /** joint name to [x, y, z] from where it rests: `hips` lowers a sitting body. */
    move?: Readonly<Record<string, readonly number[]>>;
    /** joint name to where it must be, in the model's own space: a hand on a bow, a foot on the ground. The two bones above it turn to put it there; `pole` is the way the middle one bends. */
    reach?: Readonly<Record<string, { at: readonly number[]; pole?: readonly number[] }>>;
    /** The whole mesh rides on this one joint, whole: hair cards, which have no skin between them for weights to spread over. */
    rigid?: string;
}

/** A pose as the clip that holds it, on the bones it is for. */
export function poseClip(p: PoseParams): { joints: RigJoint[]; animation: AnimationSource } {
    if (p.humanoid === undefined) throw new Error('`humanoid` says whose bones: true, or the build it was given');
    const joints: RigJoint[] = resolveJoints({ joints: humanoidJoints(p.humanoid === true ? {} : p.humanoid) });
    const names = new Set(joints.map((j) => j.name));
    const known = (name: string): void => {
        if (!names.has(name)) throw new Error(`no joint "${name}"; there are ${[...names].join(', ')}`);
    };
    const tracks = new Map<string, { rotate?: number[][]; move?: number[][]; reach?: number[][]; pole?: readonly number[] }>();
    for (const [name, r] of Object.entries(p.rotate ?? {})) {
        known(name);
        if (r.length !== 3) throw new Error(`rotate of "${name}" must be [x, y, z] degrees`);
        tracks.set(name, { rotate: [[0, r[0]!, r[1]!, r[2]!]] });
    }
    for (const [name, m] of Object.entries(p.move ?? {})) {
        known(name);
        if (m.length !== 3) throw new Error(`move of "${name}" must be [x, y, z]`);
        tracks.set(name, { ...tracks.get(name), move: [[0, m[0]!, m[1]!, m[2]!]] });
    }
    for (const [name, r] of Object.entries(p.reach ?? {})) {
        known(name);
        if (r.at?.length !== 3) throw new Error(`reach of "${name}" needs at: [x, y, z]`);
        tracks.set(name, { ...tracks.get(name), reach: [[0, r.at[0]!, r.at[1]!, r.at[2]!]], ...(r.pole ? { pole: r.pole } : {}) });
    }
    return { joints, animation: { name: 'pose', duration: 1, loop: false, tracks: [...tracks].map(([joint, t]) => ({ joint, ...t })) as AnimationTrack[] } };
}

/** Where each joint is in a pose, without the seconds a surface takes. */
export function poseJoints(p: PoseParams): Record<string, Vec3> {
    const { joints, animation } = poseClip(p);
    return jointPositions(joints, animation, 0);
}

/** The same, with which way each joint has turned. */
export function poseFrames(p: PoseParams): ReturnType<typeof jointFrames> {
    const { joints, animation } = poseClip(p);
    return jointFrames(joints, animation, 0);
}
