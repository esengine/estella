// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  humanoid.ts — the `humanoid` step: a whole person, standing, seen from every side.
 *
 *        A person made of a few numbers: proportions are measured off a table of a body's cross-sections, so
 *        moving a shoulder is one number, and the skeleton comes from the same table and so fits. It stands in an A-pose
 *        with the arms clear of the waist, facing +z, feet on y = 0: a shape to wear clothes and be posed by bones, and
 *        never one to be drawn in a pose.
 */
import { organic, type OrganicPart } from './organic';
import type { PolyMesh, Vec3 } from './polyMesh';
import type { RigJointSource } from './rig';

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

export interface HumanoidParams extends HumanoidBuild {
    /** Grid cells along the height of the body. Default 240; the face and hands get finer faces anyway. */
    resolution?: number;
    /** `closed` lids the eyes with skin. Default open, with an eyeball of its own colour. */
    eyes?: 'open' | 'closed';
    /** Linear colours. */
    skin?: readonly number[];
    sclera?: readonly number[];
    iris?: readonly number[];
    lips?: readonly number[];
    tag?: string;
}

interface Section { y: number; across: number; front: number; back: number; z: number; x?: number }

/** The table is for a body 1.6 tall. */
const TABLE_HEIGHT = 1.6;

const TORSO: readonly Section[] = [
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

const ARM_DROP = (62 * Math.PI) / 180;

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

/** The tags a humanoid's own skin carries: what it wears is everything else. */
export const HUMANOID_TAGS: readonly string[] = ['torso', 'arm', 'hand', 'leg', 'foot', 'neck', 'face', 'scalp', 'ear', 'lips', 'lid', 'eye', 'iris'];

const SKIN = [0.72, 0.5, 0.42] as const;
const SCLERA = [0.82, 0.82, 0.82] as const;
const IRIS = [0.1, 0.16, 0.26] as const;
const LIPS = [0.56, 0.22, 0.22] as const;

/** The parts of a body. The head is built on its own table and moved into place, so a larger head stays a head. */
export function humanoidParts(p: HumanoidParams = {}): OrganicPart[] {
    const f = humanoidFrame(p);
    const k = f.k;
    const limbs = p.limbs ?? 1;
    const sx = (x: number, y: number, z: number): [number, number, number] => [x * k, y * k, z * k];
    /** A torso section's width by which band it is in. */
    const widen = (s: Section): number => {
        if (s.y > 1.22) return p.shoulders ?? 1;
        if (s.y > 1.11) return p.chest ?? 1;
        if (s.y > 0.95) return p.waist ?? 1;
        return p.hips ?? 1;
    };
    const parts: OrganicPart[] = [];
    parts.push({
        shape: 'limb', tag: 'torso', blend: 0.012 * k, curve: 5, power: 2.35, side: [1, 0, 0],
        sections: TORSO.map((s) => ({ at: sx(0, s.y, s.z), across: s.across * k * widen(s), front: s.front * k, back: s.back * k })),
    });
    // Breasts are the chest wall swelling: a separate ball reads as a ball glued on, at any depth.
    parts.push({ shape: 'ellipsoid', tag: 'torso', radii: [0.058 * k * (p.chest ?? 1), 0.054 * k, 0.05 * k], at: sx(0.058, 1.15, 0.056), rotate: [14, 0, 0], mirror: 'x', blend: 0.045 * k });
    // The shoulder blades and the collar bones, faintly; the buttocks, as a body has them.
    parts.push({ shape: 'ellipsoid', tag: 'torso', radii: [0.068 * k, 0.07 * k, 0.058 * k], at: sx(0.062 * (p.hips ?? 1), 0.815, -0.05), mirror: 'x', blend: 0.05 * k });
    parts.push({ shape: 'chain', tag: 'torso', points: [[0.018 * k, 1.292 * k, 0.038 * k, 0.0085 * k], [0.13 * k, 1.292 * k, 0.012 * k, 0.012 * k]], mirror: 'x', blend: 0.024 * k });

    // Arms: out and down from the shoulder, each limb narrower one way than the other.
    const a = f.along;
    const onArm = (d: number): [number, number, number] => [f.shoulder[0] + a[0] * d * k, f.shoulder[1] + a[1] * d * k, f.shoulder[2]];
    const armPart = (d: number, r: number, deep = r): { at: Vec3; across: number; front: number; back: number } => ({ at: onArm(d), across: r * k * limbs, front: deep * k * limbs, back: deep * k * limbs });
    parts.push({
        shape: 'limb', tag: 'arm', mirror: 'x', blend: 0.016 * k, curve: 5, side: [0, 0, 1],
        sections: [armPart(-0.012, 0.044), armPart(0.03, 0.052, 0.05), armPart(0.1, 0.044, 0.044), armPart(0.2, 0.037, 0.038), armPart(0.262, 0.032, 0.031), armPart(0.31, 0.035, 0.034), armPart(0.4, 0.029, 0.026), armPart(0.5, 0.024, 0.018)],
    });
    // A hand: a palm wider than it is thick, and the fingers springing from its end.
    parts.push({
        shape: 'limb', tag: 'hand', mirror: 'x', blend: 0.006 * k, curve: 4, side: [0, 0, 1],
        sections: [armPart(0.5, 0.022, 0.015), armPart(0.53, 0.036, 0.016), armPart(0.57, 0.041, 0.0145), armPart(0.598, 0.04, 0.0115)],
    });
    for (const finger of f.fingers) {
        const end = (t: number): [number, number, number, number] => [
            finger.base[0] - a[0] * 0.008 * k + a[0] * finger.length * t, finger.base[1] - a[1] * 0.008 * k + a[1] * finger.length * t - 0.004 * k * t * t, finger.base[2],
            finger.radius * (1 - 0.25 * t),
        ];
        parts.push({ shape: 'chain', tag: 'hand', mirror: 'x', blend: 0.0025 * k, points: [end(0), end(0.5), end(1)] });
    }
    parts.push({ shape: 'chain', tag: 'hand', mirror: 'x', blend: 0.008 * k, points: [[...f.thumb.base, 0.0125 * k], [...f.thumb.mid, 0.0095 * k], [...f.thumb.tip, 0.0075 * k]] });

    // Legs.
    const leg = (y: number, x: number, z: number, across: number, front: number, back: number): { at: Vec3; across: number; front: number; back: number } => ({ at: sx(x, y, z), across: across * k * limbs, front: front * k * limbs, back: back * k * limbs });
    parts.push({
        shape: 'limb', tag: 'leg', mirror: 'x', blend: 0.022 * k, curve: 5, side: [1, 0, 0], power: 2.15,
        sections: [leg(0.84, 0.08, -0.004, 0.06, 0.07, 0.076), leg(0.745, 0.08, 0, 0.07, 0.072, 0.074), leg(0.62, 0.075, 0.004, 0.058, 0.062, 0.058), leg(0.5, 0.07, 0.006, 0.046, 0.05, 0.048), leg(0.445, 0.068, 0.008, 0.042, 0.046, 0.042), leg(0.39, 0.067, 0.0, 0.04, 0.038, 0.045), leg(0.31, 0.066, -0.012, 0.042, 0.033, 0.052), leg(0.2, 0.066, -0.016, 0.03, 0.026, 0.034), leg(0.1, 0.067, -0.016, 0.022, 0.022, 0.025), leg(0.07, 0.067, -0.018, 0.022, 0.024, 0.026)],
    });
    // A foot: heel behind the ankle, the arch high, the ball broad, the toes tapering. Its depth is up and down: `side` is across it.
    parts.push({
        shape: 'limb', tag: 'foot', mirror: 'x', blend: 0.012 * k, curve: 5, side: [1, 0, 0],
        sections: [
            { at: sx(0.067, 0.036, -0.058), across: 0.022 * k, front: 0.028 * k, back: 0.028 * k },
            { at: sx(0.067, 0.044, -0.03), across: 0.027 * k, front: 0.036 * k, back: 0.036 * k },
            { at: sx(0.069, 0.042, 0.03), across: 0.032 * k, front: 0.03 * k, back: 0.03 * k },
            { at: sx(0.072, 0.024, 0.095), across: 0.04 * k, front: 0.016 * k, back: 0.016 * k },
            { at: sx(0.073, 0.016, 0.15), across: 0.036 * k, front: 0.012 * k, back: 0.012 * k },
            { at: sx(0.073, 0.012, 0.178), across: 0.026 * k, front: 0.0095 * k, back: 0.0095 * k },
        ],
    });

    parts.push(...headParts(p));
    return parts;
}

/** The head, about the point between the ears at the height of the eyes, facing +z. */
function headParts(p: HumanoidParams): OrganicPart[] {
    const f = humanoidFrame(p);
    const k = f.k;
    const size = (p.head ?? 1) * k;
    // Heads are 0.238 tall in the table: crown at 1.6, chin at 1.362.
    const origin: Vec3 = [0, (1.6 - 0.112 * (p.head ?? 1)) * k, -0.012 * k];
    const pt = (x: number, y: number, z: number): [number, number, number] => [origin[0] + x * size, origin[1] + y * size, origin[2] + z * size];
    const skin = p.skin ?? SKIN;
    const parts: OrganicPart[] = [];
    // The neck runs from under the skull to the collar, leaning forward as it rises.
    parts.push({
        shape: 'limb', tag: 'neck', blend: 0.02 * k, curve: 4, side: [1, 0, 0],
        sections: [
            { at: [0, 1.33 * k, -0.024 * k], across: 0.047 * k, front: 0.042 * k, back: 0.048 * k },
            { at: [0, 1.385 * k, -0.018 * k], across: 0.037 * k, front: 0.037 * k, back: 0.04 * k },
            { at: pt(0, -0.045, -0.018), across: 0.04 * size, front: 0.038 * size, back: 0.042 * size },
        ],
    });
    parts.push({ shape: 'ellipsoid', tag: 'scalp', radii: [0.077 * size, 0.088 * size, 0.096 * size], at: pt(0, 0.038, -0.018), blend: 0.02 * size });
    // The face, from the brow to the chin: a mask of sections narrowing to the jaw, deeper in front than a skull.
    parts.push({
        shape: 'limb', tag: 'face', blend: 0.016 * size, curve: 6, side: [1, 0, 0], power: 2.25,
        sections: [
            { at: pt(0, 0.05, -0.002), across: 0.072 * size, front: 0.082 * size, back: 0.06 * size },
            { at: pt(0, 0.012, 0), across: 0.071 * size, front: 0.084 * size, back: 0.06 * size },
            { at: pt(0, -0.028, 0.002), across: 0.065 * size, front: 0.08 * size, back: 0.056 * size },
            { at: pt(0, -0.062, 0.006), across: 0.05 * size, front: 0.073 * size, back: 0.044 * size },
            { at: pt(0, -0.088, 0.012), across: 0.032 * size, front: 0.063 * size, back: 0.028 * size },
            { at: pt(0, -0.106, 0.022), across: 0.016 * size, front: 0.047 * size, back: 0.012 * size },
        ],
    });
    // The planes that make it a face: brow, cheek, chin.
    parts.push({ shape: 'chain', tag: 'face', points: [[...pt(0.008, 0.024, 0.07), 0.0075 * size], [...pt(0.03, 0.027, 0.066), 0.0075 * size], [...pt(0.054, 0.018, 0.044), 0.006 * size]], mirror: 'x', blend: 0.02 * size });
    parts.push({ shape: 'ellipsoid', tag: 'face', radii: [0.021 * size, 0.017 * size, 0.018 * size], at: pt(0.036, -0.026, 0.056), mirror: 'x', blend: 0.016 * size });
    parts.push({ shape: 'ellipsoid', tag: 'face', radii: [0.014 * size, 0.011 * size, 0.012 * size], at: pt(0, -0.097, 0.062), blend: 0.012 * size });
    // The eye sockets go in, and what fills them comes after.
    parts.push({ shape: 'ellipsoid', tag: 'face', subtract: true, radii: [0.0205 * size, 0.0118 * size, 0.013 * size], at: pt(0.031, 0.002, 0.079), mirror: 'x', blend: 0.013 * size });
    // A nose: a bridge coming out of the brow, a tip, and two wings.
    parts.push({
        shape: 'limb', tag: 'face', blend: 0.012 * size, curve: 5, side: [1, 0, 0],
        sections: [
            { at: pt(0, 0.006, 0.066), across: 0.0055 * size, front: 0.0055 * size, back: 0.0055 * size },
            { at: pt(0, -0.016, 0.078), across: 0.0056 * size, front: 0.0062 * size, back: 0.006 * size },
            { at: pt(0, -0.035, 0.086), across: 0.0068 * size, front: 0.0072 * size, back: 0.0065 * size },
            { at: pt(0, -0.04, 0.0855), across: 0.0052 * size, front: 0.0052 * size, back: 0.005 * size },
        ],
    });
    parts.push({ shape: 'ellipsoid', tag: 'face', radii: [0.0052 * size, 0.0045 * size, 0.0055 * size], at: pt(0.0098, -0.0395, 0.0775), mirror: 'x', blend: 0.007 * size });
    // Lips, and the line between them.
    parts.push({ shape: 'ellipsoid', tag: 'lips', color: p.lips ?? LIPS, radii: [0.0135 * size, 0.0036 * size, 0.0065 * size], at: pt(0, -0.0635, 0.0775), blend: 0.005 * size });
    parts.push({ shape: 'ellipsoid', tag: 'lips', color: p.lips ?? LIPS, radii: [0.011 * size, 0.0046 * size, 0.0065 * size], at: pt(0, -0.0718, 0.0755), blend: 0.005 * size });
    parts.push({ shape: 'ellipsoid', tag: 'lips', subtract: true, radii: [0.0135 * size, 0.0009 * size, 0.006 * size], at: pt(0, -0.0675, 0.0822), blend: 0.002 * size });
    // Ears: a flat drawing standing off the side of the skull.
    parts.push({
        shape: 'outline', tag: 'ear', mirror: 'x', depth: 0.005 * size, round: 0.004 * size, curve: 3, blend: 0.004 * size, rotate: [0, -80, 0], at: pt(0.076, -0.002, -0.022),
        points: [[-0.012 * size, 0.022 * size], [0.002 * size, 0.031 * size], [0.015 * size, 0.022 * size], [0.015 * size, 0.002 * size], [0.006 * size, -0.018 * size], [-0.002 * size, -0.026 * size], [-0.007 * size, -0.014 * size], [-0.011 * size, 0.004 * size]],
    });
    parts.push({ shape: 'ellipsoid', tag: 'ear', subtract: true, mirror: 'x', radii: [0.003 * size, 0.012 * size, 0.008 * size], at: pt(0.08, 0.002, -0.02), blend: 0.003 * size });
    if (p.eyes === 'closed') {
        parts.push({ shape: 'ellipsoid', tag: 'lid', radii: [0.0202 * size, 0.0115 * size, 0.0142 * size], at: pt(0.031, 0.002, 0.0615), mirror: 'x', blend: 0.005 * size });
    } else {
        parts.push({ shape: 'sphere', tag: 'eye', radius: 0.0152 * size, at: pt(0.031, 0.002, 0.0585), mirror: 'x', blend: 0, color: p.sclera ?? SCLERA });
        parts.push({ shape: 'ellipsoid', tag: 'iris', radii: [0.0068 * size, 0.0075 * size, 0.0026 * size], at: pt(0.031, 0.002, 0.0722), mirror: 'x', blend: 0, color: p.iris ?? IRIS });
        // Lids over the ball, an upper heavier than the lower, leaving it open between them.
        parts.push({ shape: 'ellipsoid', tag: 'lid', radii: [0.0198 * size, 0.0062 * size, 0.0132 * size], at: pt(0.031, 0.0125, 0.0635), rotate: [-12, 0, 0], mirror: 'x', blend: 0.005 * size, color: skin });
        parts.push({ shape: 'ellipsoid', tag: 'lid', radii: [0.0185 * size, 0.0038 * size, 0.0125 * size], at: pt(0.031, -0.0092, 0.0625), rotate: [12, 0, 0], mirror: 'x', blend: 0.005 * size, color: skin });
    }
    return parts;
}

/** The finest faces go where there is the most to see: on the face, and on the hands. */
export function humanoidFineRegions(p: HumanoidParams = {}): { at: Vec3; radius: number; longest: number; mirror?: 'x' }[] {
    const f = humanoidFrame(p);
    const size = (p.head ?? 1) * f.k;
    const head: Vec3 = [0, (1.6 - 0.112 * (p.head ?? 1) - 0.03 * (p.head ?? 1)) * f.k, 0.012 * f.k];
    const hand: Vec3 = [(f.wrist[0] + f.knuckle[0]) / 2 + f.along[0] * 0.05 * f.k, (f.wrist[1] + f.knuckle[1]) / 2 + f.along[1] * 0.05 * f.k, f.wrist[2]];
    return [
        { at: head, radius: 0.135 * size, longest: 0.0034 * size },
        { at: hand, radius: 0.17 * f.k, longest: 0.0042 * f.k, mirror: 'x' },
    ];
}

const MAX_HUMANOID_RESOLUTION = 400;

export function humanoid(mesh: PolyMesh, p: HumanoidParams): PolyMesh {
    const resolution = p.resolution ?? 240;
    if (!Number.isInteger(resolution) || resolution < 120 || resolution > MAX_HUMANOID_RESOLUTION) throw new Error(`resolution ${resolution} must be a whole number, 120..${MAX_HUMANOID_RESOLUTION}`);
    for (const key of ['height', 'head', 'shoulders', 'chest', 'waist', 'hips', 'limbs'] as const) {
        if (p[key] !== undefined && !(p[key]! > 0)) throw new Error(`${key} ${p[key]} must be positive`);
    }
    if (p.eyes !== undefined && p.eyes !== 'open' && p.eyes !== 'closed') throw new Error(`eyes ${JSON.stringify(p.eyes)} must be open or closed`);
    return organic(mesh, {
        parts: humanoidParts(p),
        resolution,
        maxResolution: MAX_HUMANOID_RESOLUTION,
        color: p.skin ?? SKIN,
        ...(p.tag ? { tag: p.tag } : {}),
        fine: humanoidFineRegions(p),
    });
}
