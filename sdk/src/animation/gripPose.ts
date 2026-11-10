// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gripPose.ts
 * @brief   How a hand is held: a pistol grip, a hammer's handle, a cup, said once and fitting any hand.
 *
 * @details A pose stored as bone rotations belongs to the skeleton it was made on, since the bones of two rigs do not face the same way.
 *          So a GripPose says only what is true of a hand: how far each finger bends, how far it fans out, how far the thumb comes across.
 *          The axes are worked out from each rig's own hand, once, from where its joints stand: which way the palm faces, which way each
 *          finger points. What runs each frame is then a few quaternions a joint, and nothing at all once a hand has settled on a rig no clip moves.
 *
 *          It does not know what is held. Putting the hand on an object is the attachment's business, and fitting the fingers to its
 *          surface a later step's.
 */
import type { App } from '../app/app';
import { defineComponent, getComponent, Children, Name, Transform, type ComponentDef, type TransformData } from '../ecs/component';
import { defineSystem, GetWorld, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import type { World } from '../ecs/world';
import { resolveChildEntity } from '../ecs/childPath';
import { playModeOnly } from '../ecs/env';
import { SystemLabel } from '../ecs/systemLabels';
import { log } from '../util/logger';
import { q } from '../math/quat';
import type { Entity } from '../types';
import { leanQuat } from './quatMix';

/** How one finger is held. @experimental */
export interface GripFinger {
    /** How far it bends, 0 as the rig rests to 1 closed. */
    curl: number;
    /** How far its first joint bends, where that differs from the rest of it: a finger laid along a frame, or hooked. Defaults to `curl`. */
    base?: number;
    /** How far the fingers fan out from one another, -1 to 1. */
    spread?: number;
}

/** How the thumb is held: as a reach, since where it can rest is somewhere on the other fingers. @experimental */
export interface GripThumb {
    /** How far it goes from where it rests to what it reaches for, 0 to 1. */
    opposition: number;
    /** What it reaches for: the middle of the middle finger, as a fist or a handle has it, or the index finger's tip, as a pinch does. Defaults to `fingers`. */
    to?: 'fingers' | 'index';
    /** How far short of them it stops, in lengths of the index finger: what is held between, a grip or a mug. Defaults to 0. */
    gap?: number;
}

/** How a whole hand is held. Nothing in it names a bone, so it fits any rig. @experimental */
export interface GripPoseDef {
    thumb: GripThumb;
    index: GripFinger;
    middle: GripFinger;
    ring: GripFinger;
    pinky: GripFinger;
    /** The index finger as `trigger` takes it to 1: pressing, where the finger above is resting. Absent, `trigger` does nothing. */
    trigger?: GripFinger;
}

const f = (curl: number, base?: number, spread?: number): GripFinger => ({ curl, ...(base !== undefined ? { base } : {}), ...(spread !== undefined ? { spread } : {}) });
const thumb = (opposition: number, gap = 0, to: 'fingers' | 'index' = 'fingers'): GripThumb => ({ opposition, gap, to });

const poses = new Map<string, GripPoseDef>(Object.entries({
    open: { thumb: thumb(0), index: f(0), middle: f(0), ring: f(0), pinky: f(0) },
    relaxed: { thumb: thumb(0.25, 0.6), index: f(0.18, 0.15), middle: f(0.25, 0.2), ring: f(0.3, 0.25), pinky: f(0.35, 0.3) },
    fist: { thumb: thumb(1), index: f(1), middle: f(1), ring: f(1), pinky: f(1) },
    pistol: {
        thumb: thumb(1, 0.4), index: f(0.1, 0.32), middle: f(0.78, 0.72), ring: f(0.82, 0.76), pinky: f(0.85, 0.8),
        trigger: f(0.55, 0.42),
    },
    support: { thumb: thumb(0.9, 0.5), index: f(0.4, 0.35), middle: f(0.45, 0.4), ring: f(0.48, 0.42), pinky: f(0.5, 0.45) },
    handle: { thumb: thumb(1, 0.1), index: f(0.78, 0.7), middle: f(0.82, 0.75), ring: f(0.85, 0.78), pinky: f(0.88, 0.8) },
    pinch: { thumb: thumb(1, 0, 'index'), index: f(0.55, 0.5), middle: f(0.25, 0.2), ring: f(0.25, 0.2), pinky: f(0.25, 0.2) },
    cup: { thumb: thumb(0.9, 0.8), index: f(0.45, 0.25, 0.3), middle: f(0.45, 0.25, 0.3), ring: f(0.45, 0.25, 0.3), pinky: f(0.45, 0.25, 0.3) },
} satisfies Record<string, GripPoseDef>));

/** Adds a pose of the game's own, or replaces one by name. @experimental */
export function registerGripPose(name: string, pose: GripPoseDef): void {
    poses.set(name, pose);
}

/** The names a `GripPose` component can take. @experimental */
export function gripPoseNames(): string[] {
    return [...poses.keys()];
}

/** The pose of that name, or undefined. @experimental */
export function gripPose(name: string): GripPoseDef | undefined {
    return poses.get(name);
}

/** The fields of the `GripPose` component. @experimental */
export interface GripPoseData {
    /** The pose each hand takes; empty leaves that hand to whatever else moves it. */
    rightPose: string;
    leftPose: string;
    /** How much of it applies, over what a clip is doing with the fingers. */
    rightWeight: number;
    leftWeight: number;
    /** How far the index finger has gone from resting to pressing. */
    rightTrigger: number;
    leftTrigger: number;
    /** About how long a change of pose takes, in seconds. */
    blendSeconds: number;
    /** The hand joint, by path from this entity. Empty looks for it by name. */
    rightHand: string;
    leftHand: string;
}

/**
 * Holds a rig's hands in a named pose. Goes on the rig's root.
 *
 * @experimental
 */
export const GripPose: ComponentDef<GripPoseData> = /* @__PURE__ */ defineComponent<GripPoseData>('GripPose', {
    rightPose: '', leftPose: '', rightWeight: 1, leftWeight: 1, rightTrigger: 0, leftTrigger: 0, blendSeconds: 0.15, rightHand: '', leftHand: '',
}, {
    fields: {
        rightPose: { category: 'Right Hand', tooltip: 'open, relaxed, fist, pistol, support, handle, pinch, cup, or one the game registers. Empty leaves the hand alone.' },
        rightWeight: { min: 0, max: 1, step: 0.01, category: 'Right Hand', tooltip: 'How much of the pose applies, over what a clip is doing with the fingers.' },
        rightTrigger: { min: 0, max: 1, step: 0.01, category: 'Right Hand', tooltip: 'How far the index finger has gone from resting to pressing, in a pose that has both.' },
        rightHand: { category: 'Right Hand', advanced: true, tooltip: 'The hand joint, by path from this entity. Empty looks for it by name.' },
        leftPose: { category: 'Left Hand', tooltip: 'open, relaxed, fist, pistol, support, handle, pinch, cup, or one the game registers. Empty leaves the hand alone.' },
        leftWeight: { min: 0, max: 1, step: 0.01, category: 'Left Hand', tooltip: 'How much of the pose applies, over what a clip is doing with the fingers.' },
        leftTrigger: { min: 0, max: 1, step: 0.01, category: 'Left Hand', tooltip: 'How far the index finger has gone from resting to pressing, in a pose that has both.' },
        leftHand: { category: 'Left Hand', advanced: true, tooltip: 'The hand joint, by path from this entity. Empty looks for it by name.' },
        blendSeconds: { min: 0, step: 0.01, unit: 's', tooltip: 'About how long a change of pose takes.' },
    },
});

interface Quat { w: number; x: number; y: number; z: number }
interface Vec3 { x: number; y: number; z: number }

/** The fingers, in the order a hand's numbers are kept. */
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type FingerName = (typeof FINGERS)[number];

const NAME_OF: Record<FingerName, RegExp> = {
    thumb: /thumb/i, index: /index|pointer/i, middle: /middle/i, ring: /(?<![a-z])ring|[a-z]ring(?=[\d_.:-]|$)/i, pinky: /pinky|pinkie|little/i,
};
/** A bone inside the palm: nothing a pose bends, and what the first joint of a finger may hang from. */
const INSIDE_PALM = /metacarpal|palm/i;

/** How far each joint of a finger bends when it is closed: first, second, third. In radians. */
const CLOSED = [Math.PI / 2, (100 * Math.PI) / 180, (70 * Math.PI) / 180];
const SPREAD = (15 * Math.PI) / 180;
const FAN: Record<FingerName, number> = { thumb: 0, index: 1, middle: 0.15, ring: -0.6, pinky: -1 };

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z); return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l); };
const axisAngle = (axis: Vec3, radians: number): Quat => {
    const s = Math.sin(radians / 2);
    return { w: Math.cos(radians / 2), x: axis.x * s, y: axis.y * s, z: axis.z * s };
};

const nameOf = (world: World, e: Entity): string => (world.tryGet(e, Name) as { value?: string } | null)?.value ?? '';
const childrenOf = (world: World, e: Entity): Entity[] => (world.tryGet(e, Children) as { entities?: Entity[] } | null)?.entities ?? [];

/** One joint a hand moves: where it rests, and the turns a pose asks of it, in its own frame. */
interface Joint {
    entity: Entity;
    rest: Quat;
    curlAxis: Vec3;
    /** On a finger's first joint. */
    spreadAxis?: Vec3;
    /** What this wrote last, to tell it from what a clip has written since. */
    written: Quat;
}

/** A finger's joints, knuckle first. Those it has no joint for are left out. */
type Finger = { name: FingerName; joints: Joint[]; fan: number };

/** Numbers a hand is held by, kept flat so two poses can be eased between: curl, base, spread for each finger, then the thumb's reach, how much of it is for the index tip, and its gap. */
const NUMBERS = FINGERS.length * 3 + 3;
const REACH = NUMBERS - 3, TO_INDEX = NUMBERS - 2, GAP = NUMBERS - 1;

function numbersOf(pose: GripPoseDef | null, out: Float64Array): void {
    let i = 0;
    for (const name of FINGERS) {
        const finger = name === 'thumb' ? undefined : pose?.[name];
        out[i++] = clamp01(finger?.curl ?? 0);
        out[i++] = clamp01(finger?.base ?? finger?.curl ?? 0);
        out[i++] = Math.max(-1, Math.min(1, finger?.spread ?? 0));
    }
    out[REACH] = clamp01(pose?.thumb.opposition ?? 0);
    out[TO_INDEX] = pose?.thumb.to === 'index' ? 1 : 0;
    out[GAP] = Math.max(0, pose?.thumb.gap ?? 0);
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** What is known of one hand on one rig. */
interface HandState {
    hand: Entity;
    fingers: Finger[];
    /** Which fingers it could not find, to say so once. */
    missing: FingerName[];
    /** The numbers now, and how much of them is applied now: both eased. */
    current: Float64Array;
    wanted: Float64Array;
    weight: number;
    /** How fast each number is moving, and the weight after them. */
    speed: Float64Array;
    /** Whether `current` and `weight` have arrived and everything written still stands. */
    settled: boolean;
    pose: string;
    trigger: number;
    /** What the thumb reaches with, where it has a chain long enough to bend. */
    thumb: ThumbReach | null;
    /** The hand's own directions, in its frame. */
    palm: Vec3;
    across: Vec3;
    /** The index finger's length: what a gap is measured in, and about how thick a finger is. */
    reachUnit: number;
    index: Entity[];
    middle: Entity[];
}

/** The thumb as a chain that reaches: where its root stands and how long each bone is, as the rig rests, in the hand's frame. */
interface ThumbReach {
    root: Vec3;
    lengths: [number, number, number];
    /** Each bone's direction as it rests, and each joint's turn from the hand. */
    restDirs: [Vec3, Vec3, Vec3];
    restTurns: [Quat, Quat, Quat];
    /** The turn of the joint the thumb's root hangs from. */
    parentTurn: Quat;
    restTip: Vec3;
}

/** A finger's bones in order, from the hand: those named for it, knuckle first, those in the palm passed through. */
function fingerChain(world: World, hand: Entity, name: FingerName): Entity[] {
    const pattern = NAME_OF[name];
    const search = (at: Entity, depth: number): Entity | null => {
        if (depth > 3) return null;
        for (const child of childrenOf(world, at)) {
            if (pattern.test(nameOf(world, child)) && !INSIDE_PALM.test(nameOf(world, child))) return child;
        }
        for (const child of childrenOf(world, at)) {
            const named = nameOf(world, child);
            // Through the palm's own bones, and not into something held.
            if (INSIDE_PALM.test(named)) { const found = search(child, depth + 1); if (found !== null) return found; }
        }
        return null;
    };
    const first = search(hand, 0);
    if (first === null) return [];
    const chain = [first];
    for (let at = first, guard = 0; guard < 6; guard++) {
        const next = childrenOf(world, at).find((c) => pattern.test(nameOf(world, c))) ?? null;
        if (next === null) break;
        chain.push(next);
        at = next;
    }
    return chain;
}

/** Where a joint stands from the hand, and its turn from it. */
function fromHand(world: World, chain: Entity[]): { at: Vec3[]; turn: Quat[] } {
    let position: Vec3 = { x: 0, y: 0, z: 0 };
    let rotation: Quat = { w: 1, x: 0, y: 0, z: 0 };
    const at: Vec3[] = [], turn: Quat[] = [];
    for (const joint of chain) {
        const local = world.get(joint, Transform) as TransformData;
        position = add(position, q.rotate(rotation, local.position));
        rotation = q.normalize(q.mul(rotation, local.rotation));
        at.push(position);
        turn.push(rotation);
    }
    return { at, turn };
}

/** Which way the palm faces, and toward the thumb across it, in the hand's own frame. Null with too few fingers to tell. */
function palmOf(world: World, side: 'right' | 'left', chains: Partial<Record<FingerName, Entity[]>>): { palm: Vec3; across: Vec3; forward: Vec3 } | null {
    const knuckle = (name: FingerName): Vec3 | null => {
        const chain = chains[name];
        return chain && chain.length ? fromHand(world, chain).at[0]! : null;
    };
    const outer = knuckle('index') ?? knuckle('middle');
    const inner = knuckle('pinky') ?? knuckle('ring') ?? knuckle('middle');
    const middle = knuckle('middle') ?? outer;
    if (!outer || !inner || !middle) return null;
    const across = norm(sub(outer, inner));
    if (Math.hypot(across.x, across.y, across.z) < 0.5) return null;
    // The way the fingers themselves point, and square to the knuckles: a wrist is rarely straight behind its middle finger.
    const long = chains.middle && chains.middle.length > 1 ? chains.middle : chains.index && chains.index.length > 1 ? chains.index : null;
    const placed = long ? fromHand(world, long).at : null;
    const along = placed ? sub(placed[1]!, placed[0]!) : middle;
    const forward = norm(sub(along, scale(across, dot(along, across))));
    // A right hand with its fingers ahead and its thumb to the left has its palm down: which is the cross product, one way round for each hand.
    const palm = norm(scale(cross(forward, across), side === 'right' ? -1 : 1));
    return Math.hypot(palm.x, palm.y, palm.z) < 0.5 ? null : { palm, across, forward };
}

/** The hand's joints, with the turns a pose asks of each. They are worked out from the rig as it stands now, once. */
function buildHand(world: World, hand: Entity, side: 'right' | 'left'): HandState | null {
    const chains: Partial<Record<FingerName, Entity[]>> = {};
    for (const name of FINGERS) chains[name] = fingerChain(world, hand, name);
    const shape = palmOf(world, side, chains);
    if (!shape) return null;
    const { palm, across } = shape;
    const fingers: Finger[] = [];
    const missing: FingerName[] = [];
    for (const name of FINGERS) {
        const chain = chains[name]!;
        if (chain.length === 0) { missing.push(name); continue; }
        const { at, turn } = fromHand(world, chain);
        // Its first joint to its second is the way it points; a finger of one joint points as the joint does from the hand.
        const pointing = norm(chain.length > 1 ? sub(at[1]!, at[0]!) : at[0]!);
        const bend = norm(cross(pointing, palm));
        // The last bone of a chain that goes on past three is the tip's end, which nothing bends.
        const moved = chain.slice(0, 3);
        const joints: Joint[] = moved.map((entity, i) => {
            const toJoint = q.conjugate(turn[i]!);
            const rest = q.normalize((world.get(entity, Transform) as TransformData).rotation);
            const joint: Joint = { entity, rest: { ...rest }, curlAxis: norm(q.rotate(toJoint, bend)), written: { ...rest } };
            if (i === 0) {
                joint.spreadAxis = norm(q.rotate(toJoint, palm));
                // Toward the index finger for a positive spread.
                if (dot(cross(palm, pointing), across) < 0) joint.spreadAxis = scale(joint.spreadAxis, -1);
            }
            return joint;
        });
        fingers.push({ name, joints, fan: FAN[name] });
    }
    const index = chains.index ?? [], middle = chains.middle ?? [];
    const lengthOf = (chain: Entity[]): number => {
        const at = chain.length ? fromHand(world, chain).at : [];
        let n = 0;
        for (let i = 1; i < at.length; i++) n += Math.hypot(at[i]!.x - at[i - 1]!.x, at[i]!.y - at[i - 1]!.y, at[i]!.z - at[i - 1]!.z);
        return n;
    };
    const reachUnit = lengthOf(index) || lengthOf(middle) || 0;
    return {
        hand, fingers, missing, current: new Float64Array(NUMBERS), wanted: new Float64Array(NUMBERS), weight: 0, speed: new Float64Array(NUMBERS + 1), settled: false, pose: '', trigger: 0,
        thumb: thumbReach(world, chains.thumb ?? []), palm, across, reachUnit, index, middle,
    };
}

/** The thumb's chain as it rests: null with fewer than three bones, since two cannot both reach and curl. */
function thumbReach(world: World, chain: Entity[]): ThumbReach | null {
    if (chain.length < 3) return null;
    const { at, turn } = fromHand(world, chain);
    const segment = (i: number): Vec3 => sub(at[i + 1]!, at[i]!);
    const third = chain.length > 3 ? segment(2) : scale(segment(1), 0.85);
    const lengths: [number, number, number] = [Math.hypot(...xyz(segment(0))), Math.hypot(...xyz(segment(1))), Math.hypot(...xyz(third))];
    if (lengths.some((l) => !(l > 1e-6))) return null;
    const local0 = (world.get(chain[0]!, Transform) as TransformData).rotation;
    return {
        root: at[0]!, lengths, restDirs: [norm(segment(0)), norm(segment(1)), norm(third)], restTurns: [turn[0]!, turn[1]!, turn[2]!],
        parentTurn: q.normalize(q.mul(turn[0]!, q.conjugate(local0))), restTip: add(at[2]!, third),
    };
}

const xyz = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** Where a bent chain's tip is, when its second and third joints each turn by `bend`, measured along its first bone and square to it. */
function chainTip(lengths: readonly number[], bend: number): [number, number] {
    const [a, b, c] = lengths as [number, number, number];
    return [a + b * Math.cos(bend) + c * Math.cos(2 * bend), b * Math.sin(bend) + c * Math.sin(2 * bend)];
}

/**
 * The thumb's joints turned so its tip lands on `goal`, its bones curling toward `inward`: the bend found by halving, the plane by where the goal is.
 * Answers each joint's turn from the hand.
 */
function reachThumb(reach: ThumbReach, goal: Vec3, inward: Vec3): [Quat, Quat, Quat] {
    const toGoal = sub(goal, reach.root);
    const total = reach.lengths[0] + reach.lengths[1] + reach.lengths[2];
    const want = Math.min(Math.max(Math.hypot(...xyz(toGoal)), total * 0.35), total - 1e-6);
    let lo = 0, hi = 1.7;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const [x, y] = chainTip(reach.lengths, mid);
        if (Math.hypot(x, y) > want) lo = mid; else hi = mid;
    }
    const bend = (lo + hi) / 2;
    const [tx, ty] = chainTip(reach.lengths, bend);
    const lean = Math.atan2(ty, tx);
    const u = norm(toGoal);
    const off = sub(inward, scale(u, dot(inward, u)));
    const v = Math.hypot(...xyz(off)) > 1e-6 ? norm(off) : norm(cross(u, { x: 0, y: 0, z: 1 }));
    const along = (angle: number): Vec3 => add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
    const dirs = [along(-lean), along(bend - lean), along(2 * bend - lean)];
    // Each bone turned the least way from where its parent left it: no twist added along it.
    const turns: Quat[] = [];
    let parentNow = reach.parentTurn, parentRest = reach.parentTurn;
    for (let i = 0; i < 3; i++) {
        const carried = q.normalize(q.mul(q.mul(parentNow, q.conjugate(parentRest)), reach.restTurns[i]!));
        const facing = q.rotate(q.mul(parentNow, q.conjugate(parentRest)), reach.restDirs[i]!);
        const turned = q.normalize(q.mul(q.rotationTo(facing, dirs[i]!), carried));
        turns.push(turned);
        parentRest = reach.restTurns[i]!;
        parentNow = turned;
    }
    return turns as [Quat, Quat, Quat];
}

const NAMED_HAND = /hand|wrist/i;
const NOT_A_HAND = /thumb|index|middle|ring|pinky|pinkie|little|finger|metacarpal|palm/i;
const IS_RIGHT = /right|(^|[^a-z])r($|[^a-z])/i;
const IS_LEFT = /left|(^|[^a-z])l($|[^a-z])/i;

/**
 * The palm of a hand joint, in the hand's own frame: its centre (halfway to the middle knuckle), and the turn whose +Z is the way the fingers point
 * and whose +Y is the way the palm faces. Null for a hand whose fingers say neither. @internal
 */
export function palmFrameOf(world: World, hand: Entity, side: 'right' | 'left'): { center: Vec3; turn: Quat } | null {
    const chains: Partial<Record<FingerName, Entity[]>> = {};
    for (const name of FINGERS) chains[name] = fingerChain(world, hand, name);
    const shape = palmOf(world, side, chains);
    const knuckle = (chains.middle?.length ? chains.middle : chains.index?.length ? chains.index : chains.ring) ?? null;
    if (!shape || !knuckle?.length) return null;
    const z = shape.forward, y = norm(sub(shape.palm, scale(z, dot(shape.palm, z))));
    const x = cross(y, z);
    return { center: scale(fromHand(world, [knuckle[0]!]).at[0]!, 0.5), turn: basisTurn(x, y, z) };
}

/** The turn that takes +X, +Y, +Z to three square unit vectors. */
function basisTurn(x: Vec3, y: Vec3, z: Vec3): Quat {
    const trace = x.x + y.y + z.z;
    let w: number, qx: number, qy: number, qz: number;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        w = s / 4; qx = (y.z - z.y) / s; qy = (z.x - x.z) / s; qz = (x.y - y.x) / s;
    } else if (x.x > y.y && x.x > z.z) {
        const s = Math.sqrt(1 + x.x - y.y - z.z) * 2;
        w = (y.z - z.y) / s; qx = s / 4; qy = (y.x + x.y) / s; qz = (z.x + x.z) / s;
    } else if (y.y > z.z) {
        const s = Math.sqrt(1 + y.y - x.x - z.z) * 2;
        w = (z.x - x.z) / s; qx = (y.x + x.y) / s; qy = s / 4; qz = (z.y + y.z) / s;
    } else {
        const s = Math.sqrt(1 + z.z - x.x - y.y) * 2;
        w = (x.y - y.x) / s; qx = (z.x + x.z) / s; qy = (z.y + y.z) / s; qz = s / 4;
    }
    return q.normalize({ w, x: qx, y: qy, z: qz });
}

/** The joint named for that hand under `root`, nearest first. @internal */
export function findHand(world: World, root: Entity, side: 'right' | 'left'): Entity | null {
    const wanted = side === 'right' ? IS_RIGHT : IS_LEFT;
    const queue: Entity[] = [root];
    for (let i = 0; i < queue.length && i < 512; i++) {
        const at = queue[i]!;
        const name = nameOf(world, at);
        if (at !== root && NAMED_HAND.test(name) && !NOT_A_HAND.test(name) && wanted.test(name) && fingerChain(world, at, 'middle').length + fingerChain(world, at, 'index').length > 0) return at;
        queue.push(...childrenOf(world, at));
    }
    return null;
}

/** What one rig's hands are doing. */
interface RigState { right: HandState | null; left: HandState | null; rightHand: string; leftHand: string; tried: { right: boolean; left: boolean } }

const SAME = 1e-6;
const same = (a: Quat, b: Quat): boolean => Math.abs(a.w - b.w) < SAME && Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME && Math.abs(a.z - b.z) < SAME;

/**
 * A number moved toward where it is wanted, critically damped: it starts from still and comes to rest without passing it. Going a fixed share of the
 * gap each frame would be at its fastest on the first, and a finger with far to go visibly jumps.
 */
function ease(value: number, wanted: number, state: HandState, slot: number, blend: number, dt: number): number {
    if (blend <= 0) { state.speed[slot] = 0; return wanted; }
    const omega = 6 / blend;
    const gap = value - wanted;
    const carry = (state.speed[slot]! + omega * gap) * dt;
    const fade = Math.exp(-omega * dt);
    const speed = (state.speed[slot]! - omega * carry) * fade;
    const next = wanted + (gap + carry) * fade;
    if (Math.abs(next - wanted) < 1e-3 && Math.abs(speed) < 1e-2) { state.speed[slot] = 0; return wanted; }
    state.speed[slot] = speed;
    return next;
}

/** Holds one hand a frame: eases its numbers on, and turns each joint to them over what is there. */
function holdHand(world: World, state: HandState, poseName: string, weight: number, trigger: number, blend: number, dt: number, moved: boolean): void {
    const pose = poseName ? poses.get(poseName) ?? null : null;
    if (poseName !== state.pose) {
        if (poseName && !pose) log.warn('animation', `there is no grip pose called "${poseName}": the hand is left alone`);
        state.pose = poseName;
        // A new pose eases on from where the hand is; a hand let go keeps its numbers and fades by its weight.
        if (pose) numbersOf(pose, state.wanted);
        state.settled = false;
    }
    const wantedWeight = pose ? clamp01(weight) : 0;
    const press = pose?.trigger ? clamp01(trigger) : 0;
    if (press !== state.trigger) { state.trigger = press; state.settled = false; }
    if (wantedWeight !== state.weight) state.settled = false;
    if (state.settled && !moved) return;

    let arrived = true;
    for (let i = 0; i < NUMBERS; i++) {
        const next = ease(state.current[i]!, state.wanted[i]!, state, i, blend, dt);
        state.current[i] = next;
        if (next !== state.wanted[i]) arrived = false;
    }
    state.weight = ease(state.weight, wantedWeight, state, NUMBERS, blend, dt);
    if (state.weight !== wantedWeight) arrived = false;

    // The thumb last: what it reaches for is where the other fingers have just been put.
    const ordered = [...state.fingers.filter((x) => x.name !== 'thumb'), ...state.fingers.filter((x) => x.name === 'thumb')];
    for (const finger of ordered) {
        const reached = finger.name === 'thumb' && state.thumb ? thumbTurns(world, state) : null;
        const at = FINGERS.indexOf(finger.name) * 3;
        let curl = state.current[at]!, base = state.current[at + 1]!;
        const spread = state.current[at + 2]!;
        if (finger.name === 'index' && press > 0 && pose?.trigger) {
            curl += (clamp01(pose.trigger.curl) - curl) * press;
            base += (clamp01(pose.trigger.base ?? pose.trigger.curl) - base) * press;
        }
        for (let i = 0; i < finger.joints.length; i++) {
            const joint = finger.joints[i]!;
            let target: Quat;
            if (reached) {
                // From the joint's turn from the hand to its own: its parent is the joint before, or for the first what the thumb hangs from.
                const parent = i === 0 ? state.thumb!.parentTurn : reached[i - 1]!;
                target = q.normalize(q.mul(q.conjugate(parent), reached[i]!));
            } else {
                let turn = axisAngle(joint.curlAxis, (i === 0 ? base : curl) * CLOSED[i]!);
                if (joint.spreadAxis && spread !== 0 && finger.fan !== 0) turn = q.mul(axisAngle(joint.spreadAxis, spread * finger.fan * SPREAD), turn);
                target = q.normalize(q.mul(joint.rest, turn));
            }
            const local = world.get(joint.entity, Transform) as TransformData;
            // Moved since this wrote it, a clip is speaking and the pose goes over that; otherwise over how the rig rests.
            const from = same(local.rotation, joint.written) ? joint.rest : local.rotation;
            const out = { w: from.w, x: from.x, y: from.y, z: from.z };
            if (state.weight >= 1) { out.w = target.w; out.x = target.x; out.y = target.y; out.z = target.z; }
            else leanQuat(out, target, state.weight);
            const written = q.normalize(out);
            world.update(joint.entity, Transform, (t: TransformData) => { t.rotation = { w: written.w, x: written.x, y: written.y, z: written.z }; });
            joint.written = { ...((world.get(joint.entity, Transform) as TransformData).rotation) };
        }
    }
    state.settled = arrived;
}

/**
 * Where the thumb goes this frame, as each joint's turn from the hand: from where it rests toward the middle of the middle finger (or the index tip) as
 * they now stand, on the palm's side of them by a finger's thickness and the pose's gap. Null with no reach asked, which leaves it as it rests.
 */
function thumbTurns(world: World, state: HandState): [Quat, Quat, Quat] | null {
    const reach = state.thumb!;
    const amount = state.current[REACH]!;
    if (amount <= 0) return null;
    const middleOf = (chain: Entity[]): Vec3 | null => {
        if (chain.length < 3) return null;
        const at = fromHand(world, chain).at;
        return scale(add(at[1]!, at[2]!), 0.5);
    };
    const tipOf = (chain: Entity[]): Vec3 | null => (chain.length ? fromHand(world, chain).at[chain.length - 1]! : null);
    // The middle finger's, not the index's: an index finger on a trigger would move the thumb with it.
    const fingers = middleOf(state.middle) ?? middleOf(state.index);
    const index = tipOf(state.index) ?? fingers;
    if (!fingers || !index) return null;
    const toIndex = state.current[TO_INDEX]!;
    const on = add(scale(fingers, 1 - toIndex), scale(index, toIndex));
    const thickness = state.reachUnit * 0.16;
    const contact = add(on, scale(state.palm, thickness + state.current[GAP]! * state.reachUnit));
    const goal = add(scale(reach.restTip, 1 - amount), scale(contact, amount));
    return reachThumb(reach, goal, norm(add(scale(state.across, -0.8), scale(state.palm, 0.6))));
}

function letGo(world: World, state: HandState | null): void {
    if (!state) return;
    for (const finger of state.fingers) {
        for (const joint of finger.joints) {
            if (world.valid(joint.entity) && world.has(joint.entity, Transform)) {
                world.update(joint.entity, Transform, (t: TransformData) => { t.rotation = { w: joint.rest.w, x: joint.rest.x, y: joint.rest.y, z: joint.rest.z }; });
            }
        }
    }
}

/** What a rig's hand was found to have. @experimental */
export interface GripHandStatus {
    /** The joint it took for the hand, or null where none could be found. */
    hand: Entity | null;
    /** How many joints a pose moves on it. */
    joints: number;
    /** The fingers it has no bones for: a pose simply does without them. */
    missing: string[];
    /** The pose it is in. */
    pose: string;
    /** How much of it applies now. */
    weight: number;
}

const rigs = new WeakMap<App, Map<Entity, RigState>>();

/** What each hand of a rig with a `GripPose` was found to have, once the system has seen it. @experimental */
export function gripPoseStatus(app: App, rig: Entity): { right: GripHandStatus; left: GripHandStatus } | null {
    const state = rigs.get(app)?.get(rig);
    if (!state) return null;
    const of = (h: HandState | null): GripHandStatus => ({
        hand: h?.hand ?? null, joints: h ? h.fingers.reduce((n, finger) => n + finger.joints.length, 0) : 0, missing: h ? [...h.missing] : [...FINGERS], pose: h?.pose ?? '', weight: h?.weight ?? 0,
    });
    return { right: of(state.right), left: of(state.left) };
}

/** Holds every rig's hands. Runs after the animator, since what a clip says of the fingers is what a pose goes over. */
export function installGripPose(app: App): void {
    const known = new Map<Entity, RigState>();
    rigs.set(app, known);
    // By name: what moves the bones is the animator's or the timeline's, which this does not need to carry.
    const hasClipOn = (world: World, rig: Entity): boolean => ['Animator', 'TimelinePlayer'].some((name) => { const def = getComponent(name); return !!def && world.has(rig, def); });
    // system-access: the hand's joints are found by walking the rig, so which entities it writes is known only then, and only their Transforms.
    app.addSystemToSchedule(Schedule.Update, defineSystem([Res(Time), GetWorld()], (time: TimeData, world: World) => {
        for (const [rig, state] of known) {
            if (world.valid(rig) && world.has(rig, GripPose)) continue;
            letGo(world, state.right);
            letGo(world, state.left);
            known.delete(rig);
        }
        for (const rig of world.getEntitiesWithComponents([GripPose])) {
            const data = world.get(rig, GripPose) as GripPoseData;
            if (!data.rightPose && !data.leftPose && !known.has(rig)) continue;
            let state = known.get(rig);
            if (!state || state.rightHand !== data.rightHand || state.leftHand !== data.leftHand) {
                if (state) { letGo(world, state.right); letGo(world, state.left); }
                state = { right: null, left: null, rightHand: data.rightHand, leftHand: data.leftHand, tried: { right: false, left: false } };
                known.set(rig, state);
            }
            const moved = hasClipOn(world, rig);
            for (const side of ['right', 'left'] as const) {
                const poseName = side === 'right' ? data.rightPose : data.leftPose;
                if (!state[side] && poseName && !state.tried[side]) {
                    state.tried[side] = true;
                    const path = side === 'right' ? data.rightHand : data.leftHand;
                    const hand = path ? resolveChildEntity(world, rig, path) : findHand(world, rig, side);
                    state[side] = hand === null ? null : buildHand(world, hand, side);
                    if (!state[side]) log.warn('animation', `a GripPose found no ${side} hand with fingers on "${nameOf(world, rig)}"${path ? ` at "${path}"` : ''}: name its joint in ${side}Hand`);
                    else if (state[side]!.missing.length) log.warn('animation', `the ${side} hand of "${nameOf(world, rig)}" has no bones for its ${state[side]!.missing.join(', ')}: a pose does without them`);
                }
                const hand = state[side];
                if (hand) {
                    holdHand(world, hand, poseName, side === 'right' ? data.rightWeight : data.leftWeight, side === 'right' ? data.rightTrigger : data.leftTrigger, data.blendSeconds, time.delta, moved);
                }
            }
        }
    }, { name: 'GripPoseSystem' }), { runAfter: [SystemLabel.Animator], runIf: playModeOnly });
}
