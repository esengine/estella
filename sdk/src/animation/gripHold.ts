// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gripHold.ts
 * @brief   A character holding an object: where the palms go on it, the arms that take them there, and the fingers once there.
 *
 * @details Three parts, each answering one thing. The object's `GripProfile` says where on it a palm sits, for the hand that leads and the one
 *          that supports. The arm is bent to take the palm there. The fingers are a pose blended over what the clip does.
 *
 *          The order is fixed and runs one way, so no hand can move what moves it: the clip's pose, then where the object is (on the leading hand,
 *          or where the game put it), then the supporting hand's anchor read off the object, then that arm, then the fingers of both. The
 *          object never reads the supporting hand. Everything comes from this frame's pose and the game's clock: the same inputs and steps give
 *          the same bones.
 */
import type { App } from '../app/app';
import { defineComponent, Children, Name, Parent, Transform, type ComponentDef, type TransformData } from '../ecs/component';
import { defineSystem, GetWorld, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import type { World } from '../ecs/world';
import { resolveChildEntity } from '../ecs/childPath';
import { fxPreviewOrPlayMode } from '../ecs/env';
import { SystemLabel } from '../ecs/systemLabels';
import { log } from '../util/logger';
import { q } from '../math/quat';
import type { Entity } from '../types';
import { askHeldHands, findHand, gripPose, gripPoseFromJson, palmFrameOf, releaseGripPoses, type GripPoseDef, type HeldHand } from './gripPose';

interface Vec3 { x: number; y: number; z: number }
interface Quat { w: number; x: number; y: number; z: number }

/** Where a palm sits on a held object, and how its fingers are held there. @experimental */
export interface GripProfileData {
    /** An entity under the object whose place and turn are the leading palm's: its origin the palm's centre, +Z the way the fingers point, +Y the way the palm faces. */
    mainAnchor: Entity;
    /** The same for the supporting hand. None holds the object in one hand. */
    supportAnchor: Entity;
    /** The fingers of each: a pose captured from a hand (registerFingerPose), or a GripPose by name. */
    mainPose: string;
    supportPose: string;
    /** The fingers of each said joint by joint, as JSON of a GripPoseDef (an editor writes it). Over the pose by name where it is set. */
    mainFingers: string;
    supportFingers: string;
    /** The hand the anchors were placed for. Held with the other hand leading, both anchors are mirrored to it. */
    hand: number;
    /** The plane of the object's own that mirrors them: the one square to its X, Y or Z. */
    mirror: number;
}

/** The plane an object's anchors are mirrored in, by the axis square to it. @experimental */
export const GripMirror = { X: 0, Y: 1, Z: 2 } as const;

/**
 * How an object is held. Goes on the object; its anchors are entities under it.
 *
 * @experimental
 */
export const GripProfile: ComponentDef<GripProfileData> = /* @__PURE__ */ defineComponent<GripProfileData>('GripProfile', {
    mainAnchor: 0 as Entity, supportAnchor: 0 as Entity, mainPose: 'handle', supportPose: 'support', mainFingers: '', supportFingers: '', hand: 0, mirror: 0,
}, {
    entityFields: ['mainAnchor', 'supportAnchor'],
    fields: {
        mainFingers: { advanced: true, tooltip: 'The leading hand\'s fingers joint by joint, as JSON. Written by the grip editor; over mainPose where set.' },
        supportFingers: { advanced: true, tooltip: 'The supporting hand\'s fingers joint by joint, as JSON.' },
        hand: { enum: [{ label: 'Right', value: 0 }, { label: 'Left', value: 1 }], tooltip: 'The hand the anchors were placed for. Held with the other leading, they are mirrored.' },
        mirror: { enum: [{ label: 'YZ (X)', value: 0 }, { label: 'XZ (Y)', value: 1 }, { label: 'XY (Z)', value: 2 }], tooltip: 'The object\'s own plane that mirrors the anchors to the other hand.' },
        mainAnchor: { tooltip: 'Where the leading palm sits: an entity under this one. Its +Z is the way the fingers point, +Y the way the palm faces.' },
        supportAnchor: { tooltip: 'Where the supporting palm sits. Empty holds this in one hand.' },
        mainPose: { tooltip: 'The leading hand\'s fingers: a captured finger pose, or a grip pose (pistol, handle, support, ...).' },
        supportPose: { tooltip: 'The supporting hand\'s fingers.' },
    },
});

/** Which hand leads. @experimental */
export const GripHand = { Right: 0, Left: 1 } as const;
/** What places the held object: the leading hand as the clip moves it, or the game (aiming), with the leading arm brought to it. @experimental */
export const GripPlacement = { Hand: 0, Object: 1 } as const;

/** The fields of the `GripHolder` component. @experimental */
export interface GripHolderData {
    /** What it holds: an entity with a GripProfile. None holds nothing. */
    held: Entity;
    mainHand: number;
    placement: number;
    /** How much of the hold applies over the clip, 0 to 1; and of the supporting hand's, under that. */
    weight: number;
    supportWeight: number;
    /** About how long taking hold, letting go, or changing what is held takes, in seconds. */
    blendSeconds: number;
    /** The hand joints, by path from this entity. Empty finds them by name. */
    rightHand: string;
    leftHand: string;
}

/**
 * Holds an object in its GripProfile's grip. Goes on the rig's root.
 *
 * @experimental
 */
export const GripHolder: ComponentDef<GripHolderData> = /* @__PURE__ */ defineComponent<GripHolderData>('GripHolder', {
    held: 0 as Entity, mainHand: GripHand.Right, placement: GripPlacement.Hand, weight: 1, supportWeight: 1, blendSeconds: 0.2, rightHand: '', leftHand: '',
}, {
    entityFields: ['held'],
    fields: {
        held: { tooltip: 'What is held: an entity with a GripProfile.' },
        mainHand: { enum: [{ label: 'Right', value: GripHand.Right }, { label: 'Left', value: GripHand.Left }], tooltip: 'The hand that leads.' },
        placement: { enum: [{ label: 'Hand', value: GripPlacement.Hand }, { label: 'Object', value: GripPlacement.Object }], tooltip: 'Hand: the object rides the leading hand as the clip moves it. Object: the game places it (aiming) and the leading arm is brought to it.' },
        weight: { min: 0, max: 1, step: 0.01, tooltip: 'How much of the hold applies over the clip.' },
        supportWeight: { min: 0, max: 1, step: 0.01, tooltip: 'How much of the supporting hand\'s hold applies, under the weight.' },
        blendSeconds: { min: 0, step: 0.01, unit: 's', tooltip: 'About how long taking hold, letting go, or changing what is held takes.' },
        rightHand: { advanced: true, tooltip: 'The right hand joint, by path from this entity. Empty finds it by name.' },
        leftHand: { advanced: true, tooltip: 'The left hand joint, by path from this entity. Empty finds it by name.' },
    },
});

/** A pose of the fingers as one rig holds them: each joint's own turn, by its name. @experimental */
export interface FingerPoseDef {
    joints: Record<string, Quat>;
}

const fingerPoses = new Map<string, FingerPoseDef>();

/** Keeps a finger pose by name, for a GripProfile to name. Replaces one of that name. @experimental */
export function registerFingerPose(name: string, pose: FingerPoseDef): void {
    fingerPoses.set(name, { joints: Object.fromEntries(Object.entries(pose.joints).map(([k, v]) => [k, q.normalize({ ...v })])) });
}

/** The finger pose of that name, or undefined. @experimental */
export function fingerPose(name: string): FingerPoseDef | undefined {
    return fingerPoses.get(name);
}

/** The turn of every named joint below `hand`, as it stands now: what a pose made by hand, or by a GripPose, is kept as. Plain JSON. @experimental */
export function captureFingerPose(world: World, hand: Entity): FingerPoseDef {
    const joints: Record<string, Quat> = {};
    const walk = (at: Entity): void => {
        for (const child of (world.tryGet(at, Children) as { entities?: Entity[] } | null)?.entities ?? []) {
            const name = (world.tryGet(child, Name) as { value?: string } | null)?.value;
            if (name && world.has(child, Transform)) {
                const r = (world.get(child, Transform) as TransformData).rotation;
                joints[name] = { w: r.w, x: r.x, y: r.y, z: r.z };
            }
            walk(child);
        }
    };
    walk(hand);
    return { joints };
}

/** A place, a turn and an even scale. */
interface Pose3 { p: Vec3; r: Quat; s: number }

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3): Vec3 => { const l = len(a); return l < 1e-12 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l); };
const then = (a: Pose3, b: Pose3): Pose3 => ({ p: add(a.p, q.rotate(a.r, scale(b.p, a.s))), r: q.normalize(q.mul(a.r, b.r)), s: a.s * b.s });
const inverse = (a: Pose3): Pose3 => { const r = q.conjugate(a.r), s = 1 / a.s; return { p: scale(q.rotate(r, a.p), -s), r, s }; };

/** Spherical interpolation, the shorter way: what a weight between a clip and a grip means. */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
    let d = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    const sign = d < 0 ? -1 : 1;
    d = Math.abs(d);
    if (d > 0.9995) {
        const k = 1 - t;
        return q.normalize({ w: a.w * k + b.w * t * sign, x: a.x * k + b.x * t * sign, y: a.y * k + b.y * t * sign, z: a.z * k + b.z * t * sign });
    }
    const theta = Math.acos(d), sinT = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sinT, wb = (Math.sin(t * theta) / sinT) * sign;
    return { w: a.w * wa + b.w * wb, x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
}

/** An entity's place in the world as it stands, from the composed transform. */
function worldOf(world: World, e: Entity): Pose3 {
    const t = world.get(e, Transform) as TransformData;
    return { p: { ...t.worldPosition }, r: q.normalize(t.worldRotation), s: t.worldScale.x };
}

function localOf(world: World, e: Entity): Pose3 {
    const t = world.get(e, Transform) as TransformData;
    return { p: { ...t.position }, r: q.normalize(t.rotation), s: t.scale.x };
}

function parentOf(world: World, e: Entity): Entity | null {
    const p = world.tryGet(e, Parent) as { entity?: Entity } | null;
    return p && typeof p.entity === 'number' && world.valid(p.entity) ? p.entity : null;
}

/** An anchor's place on its object: its locals composed up to the object, so it follows the object wherever this frame puts it. */
function anchorOn(world: World, object: Entity, anchor: Entity): Pose3 | null {
    let at: Entity | null = anchor;
    let pose: Pose3 = { p: { x: 0, y: 0, z: 0 }, r: { w: 1, x: 0, y: 0, z: 0 }, s: 1 };
    for (let guard = 0; at !== null && guard < 32; guard++) {
        if (at === object) return pose;
        pose = then(localOf(world, at), pose);
        at = parentOf(world, at);
    }
    return null;
}

/** An anchor's pose on its object, mirrored in the plane square to one of the object's axes: what the other hand's palm takes there. */
function mirrored(a: Pose3, axis: number): Pose3 {
    const p = { ...a.p }, r = { ...a.r };
    if (axis === 1) { p.y = -p.y; r.x = -r.x; r.z = -r.z; } else if (axis === 2) { p.z = -p.z; r.x = -r.x; r.y = -r.y; } else { p.x = -p.x; r.y = -r.y; r.z = -r.z; }
    return { p, r, s: a.s };
}

/** One hand's arm and palm, found once. */
interface Arm {
    hand: Entity;
    forearm: Entity;
    upper: Entity;
    /** The palm, from the hand joint. */
    palm: Pose3;
    /** The finger joints by name, for a captured pose. */
    fingers: Map<string, Entity>;
}

function armOf(world: World, root: Entity, side: 'right' | 'left', path: string): Arm | null {
    const hand = path ? resolveChildEntity(world, root, path) : findHand(world, root, side);
    if (hand === null) return null;
    const forearm = parentOf(world, hand), upper = forearm === null ? null : parentOf(world, forearm);
    const frame = palmFrameOf(world, hand, side);
    if (forearm === null || upper === null || !frame) return null;
    const fingers = new Map<string, Entity>();
    const walk = (at: Entity): void => {
        for (const child of (world.tryGet(at, Children) as { entities?: Entity[] } | null)?.entities ?? []) {
            const name = (world.tryGet(child, Name) as { value?: string } | null)?.value;
            if (name) fingers.set(name, child);
            walk(child);
        }
    };
    walk(hand);
    return { hand, forearm, upper, palm: { p: frame.center, r: frame.turn, s: 1 }, fingers };
}

/** The joints a hold writes, and what it last wrote to each, to blend from when what is held changes and to tell a clip's writes from its own. */
interface HolderState {
    arms: { right: Arm | null; left: Arm | null };
    paths: string;
    held: Entity;
    /** How much of the hold applies now, and how fast it is moving: eased toward the weight. */
    amount: number;
    speed: number;
    /** On a change of what is held: each joint's turn as it was, eased away from. */
    from: Map<Entity, Quat>;
    change: number;
    changeSpeed: number;
    written: Map<Entity, Quat>;
    /** Each joint's turn as something else last left it: the clip's, which a hold goes over. */
    base: Map<Entity, Quat>;
    /** Each object it carried on a hand: where it was before, and where this last put it, to give it back when a preview ends. */
    carried: Map<Entity, { rest: { p: Vec3; r: Quat }; put: { p: Vec3; r: Quat } }>;
    /** The fingers last asked of each hand, faded out by `amount` once nothing is held. */
    asked: { right?: HeldHand & { share: number }; left?: HeldHand & { share: number } };
    /** How far each palm stops short of its anchor, as the arm reaches: 0 within reach. */
    short: { main: number; support: number };
    mirrored: boolean;
}

/** Eases `value` toward `wanted`, critically damped: from still, and to rest without passing it. */
function ease(value: number, speed: number, wanted: number, blend: number, dt: number): [number, number] {
    if (blend <= 0) return [wanted, 0];
    const omega = 6 / blend;
    const gap = value - wanted;
    const carry = (speed + omega * gap) * dt;
    const fade = Math.exp(-omega * dt);
    const nextSpeed = (speed - omega * carry) * fade;
    const next = wanted + (gap + carry) * fade;
    return Math.abs(next - wanted) < 1e-4 && Math.abs(nextSpeed) < 1e-3 ? [wanted, 0] : [next, nextSpeed];
}

/**
 * The upper arm and forearm turned so the hand joint lands on `goal`, the elbow keeping the side it is bent toward; then the hand turned to `handTurn`.
 * World turns in, each joint's own turn out. The arm cannot be longer than it is: past its reach it points straight at the goal.
 */
function bendArm(world: World, arm: Arm, goal: Vec3, handTurn: Quat): Map<Entity, Quat> & { short?: number } {
    const upper = worldOf(world, arm.upper), fore = worldOf(world, arm.forearm), hand = worldOf(world, arm.hand);
    const shoulder = parentOf(world, arm.upper);
    const shoulderTurn = shoulder === null ? { w: 1, x: 0, y: 0, z: 0 } : worldOf(world, shoulder).r;
    const a = len(sub(fore.p, upper.p)), b = len(sub(hand.p, fore.p));
    const reach = sub(goal, upper.p);
    const out: Map<Entity, Quat> & { short?: number } = new Map<Entity, Quat>();
    if (a < 1e-9 || b < 1e-9 || len(reach) < 1e-9) return out;
    out.short = Math.max(0, len(reach) - (a + b));
    const c = Math.min(Math.max(len(reach), Math.abs(a - b) + 1e-6), a + b - 1e-6);
    const along = norm(reach);
    // The side the elbow is bent to now; a straight arm takes any side off the line.
    let side = sub(sub(fore.p, upper.p), scale(along, dot(sub(fore.p, upper.p), along)));
    if (len(side) < 1e-9) side = { x: -along.y, y: along.x, z: 0 };
    if (len(side) < 1e-9) side = { x: 0, y: -along.z, z: along.y };
    side = norm(side);
    const cos = Math.min(1, Math.max(-1, (a * a + c * c - b * b) / (2 * a * c)));
    const elbow = add(upper.p, add(scale(along, a * cos), scale(side, a * Math.sqrt(Math.max(0, 1 - cos * cos)))));
    const tip = add(upper.p, scale(along, c));
    const upperTurn = q.normalize(q.mul(q.rotationTo(sub(fore.p, upper.p), sub(elbow, upper.p)), upper.r));
    const carried = q.normalize(q.mul(upperTurn, q.conjugate(upper.r)));
    const foreTurn = q.normalize(q.mul(q.rotationTo(q.rotate(carried, sub(hand.p, fore.p)), sub(tip, elbow)), q.mul(carried, fore.r)));
    out.set(arm.upper, q.normalize(q.mul(q.conjugate(shoulderTurn), upperTurn)));
    out.set(arm.forearm, q.normalize(q.mul(q.conjugate(upperTurn), foreTurn)));
    out.set(arm.hand, q.normalize(q.mul(q.conjugate(foreTurn), handTurn)));
    return out;
}

/** Where the hand joint and its turn must be for its palm to sit on `anchor`, a pose in the world. */
function handFor(arm: Arm, anchor: Pose3, handScale: number): { at: Vec3; turn: Quat } {
    const turn = q.normalize(q.mul(anchor.r, q.conjugate(arm.palm.r)));
    return { at: sub(anchor.p, q.rotate(turn, scale(arm.palm.p, handScale))), turn };
}

/** The fingers' own turns for a pose: a captured one by joint name. Null where it names no captured pose. */
function capturedFingers(arm: Arm, poseName: string): Map<Entity, Quat> | null {
    const pose = fingerPoses.get(poseName);
    if (!pose) return null;
    const out = new Map<Entity, Quat>();
    for (const [name, rotation] of Object.entries(pose.joints)) {
        const joint = arm.fingers.get(name);
        if (joint !== undefined) out.set(joint, rotation);
    }
    return out;
}

const rigs = new WeakMap<App, Map<Entity, HolderState>>();

/** Runs every holder. Called by the animation plugin, before the grip poses it hands fingers to. */
export function installGripHold(app: App): void {
    const known = new Map<Entity, HolderState>();
    rigs.set(app, known);
    // system-access: what a hold writes (arm joints, fingers, the held object) is found by walking the rig and the object.
    app.addSystemToSchedule(Schedule.Update, defineSystem([Res(Time), GetWorld()], (time: TimeData, world: World) => {
        for (const [rig] of known) if (!world.valid(rig) || !world.has(rig, GripHolder)) known.delete(rig);
        const holders = [...world.getEntitiesWithComponents([GripHolder])];
        if (holders.length === 0) return;
        world.ensureTransformsComposed();
        // What a hold wrote last frame goes back to the clip's pose first, so every solve starts from this frame's clip and never from its own last answer.
        let restored = false;
        for (const state of known.values()) {
            for (const [joint, written] of state.written) {
                if (!world.valid(joint) || !world.has(joint, Transform)) continue;
                const now = (world.get(joint, Transform) as TransformData).rotation;
                const base = state.base.get(joint);
                if (base && same(now, written)) { world.update(joint, Transform, (t: TransformData) => { t.rotation = { ...base }; }); restored = true; }
            }
        }
        if (restored) world.ensureTransformsComposed();
        for (const rig of holders) hold(app, world, known, rig, world.get(rig, GripHolder) as GripHolderData, time.delta);
    }, { name: 'GripHoldSystem' }), { runAfter: [SystemLabel.Animator], runIf: fxPreviewOrPlayMode });
}

/**
 * Every joint a hold turned, and every object it carried, given back as they were before it, and every holder forgotten: an editor leaving its
 * preview, where nothing moves the bones back. What something else has moved since is left as it is. @experimental
 */
export function releaseGripHolds(app: App): void {
    const world = app.world;
    const known = rigs.get(app);
    for (const state of known?.values() ?? []) {
        for (const [joint, written] of state.written) {
            const base = state.base.get(joint);
            if (!base || !world.valid(joint) || !world.has(joint, Transform)) continue;
            if (same((world.get(joint, Transform) as TransformData).rotation, written)) world.update(joint, Transform, (t: TransformData) => { t.rotation = { ...base }; });
        }
        for (const [object, { rest, put }] of state.carried) {
            if (!world.valid(object) || !world.has(object, Transform)) continue;
            const t0 = world.get(object, Transform) as TransformData;
            if (near(t0.position, put.p) && same(t0.rotation, put.r)) world.update(object, Transform, (t: TransformData) => { t.position = { ...rest.p }; t.rotation = { ...rest.r }; });
        }
    }
    known?.clear();
    releaseGripPoses(app);
}

const near = (a: Vec3, b: Vec3): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

/** Inline finger poses read once per text. */
const parsedFingers = new Map<string, GripPoseDef | null>();
function inlineFingers(text: string): GripPoseDef | null {
    if (!text) return null;
    let pose = parsedFingers.get(text);
    if (pose === undefined) {
        if (parsedFingers.size > 64) parsedFingers.clear();
        pose = gripPoseFromJson(text);
        if (!pose) log.warn('animation', 'a GripProfile\'s fingers are not a grip pose in JSON: the pose by name is used');
        parsedFingers.set(text, pose);
    }
    return pose;
}

function hold(app: App, world: World, known: Map<Entity, HolderState>, rig: Entity, data: GripHolderData, dt: number): void {
    const paths = `${data.rightHand}|${data.leftHand}`;
    let state = known.get(rig);
    if (!state || state.paths !== paths) {
        const right = armOf(world, rig, 'right', data.rightHand), left = armOf(world, rig, 'left', data.leftHand);
        if (!right && !left) log.warn('animation', `a GripHolder found no arm with a hand on "${(world.tryGet(rig, Name) as { value?: string } | null)?.value ?? rig}"`);
        state = {
            arms: { right, left }, paths, held: 0 as Entity, amount: 0, speed: 0, from: new Map(), change: 1, changeSpeed: 0, written: new Map(), base: new Map(),
            carried: new Map(), asked: {}, short: { main: 0, support: 0 }, mirrored: false,
        };
        known.set(rig, state);
    }
    const held = data.held && world.valid(data.held) && world.has(data.held, GripProfile) ? data.held : 0 as Entity;
    if (held !== state.held) {
        // What is held changed: every joint eases from where it was, so the hands go to the new grip and do not jump.
        state.from = new Map(state.written);
        state.change = state.from.size ? 0 : 1;
        state.changeSpeed = 0;
        state.held = held;
    }
    [state.amount, state.speed] = ease(state.amount, state.speed, held ? Math.min(1, Math.max(0, data.weight)) : 0, data.blendSeconds, dt);
    [state.change, state.changeSpeed] = ease(state.change, state.changeSpeed, 1, data.blendSeconds, dt);
    const main = data.mainHand === GripHand.Left ? state.arms.left : state.arms.right;
    const support = data.mainHand === GripHand.Left ? state.arms.right : state.arms.left;
    const wanted = new Map<Entity, Quat>();
    const fingerNames: { arm: Arm; pose: string; inline: string; weight: number }[] = [];
    state.short = { main: 0, support: 0 };

    if (held && main) {
        const profile = world.get(held, GripProfile) as GripProfileData;
        // Placed for the other hand: both anchors mirrored in the object's own plane, so one set serves either.
        state.mirrored = data.mainHand !== profile.hand;
        const place = (anchor: Pose3 | null): Pose3 | null => (anchor && state!.mirrored ? mirrored(anchor, profile.mirror) : anchor);
        const mainAnchor = place(profile.mainAnchor ? anchorOn(world, held, profile.mainAnchor) : null);
        const supportAnchor = place(profile.supportAnchor ? anchorOn(world, held, profile.supportAnchor) : null);
        if (mainAnchor) {
            const handWorld = worldOf(world, main.hand);
            let object: Pose3;
            if (data.placement === GripPlacement.Object) {
                // The game has put the object: the leading arm is brought to its anchor.
                object = worldOf(world, held);
                const goal = handFor(main, then(object, mainAnchor), handWorld.s);
                const turns = bendArm(world, main, goal.at, goal.turn);
                for (const [joint, turn] of turns) wanted.set(joint, turn);
                state.short.main = turns.short ?? 0;
            } else {
                // The object rides the leading hand, wherever the clip has put it.
                object = then(then(handWorld, main.palm), inverse(mainAnchor));
                const parent = parentOf(world, held);
                const local = parent === null ? object : then(inverse(worldOf(world, parent)), object);
                const before = world.get(held, Transform) as TransformData;
                const carried = state.carried.get(held);
                if (!carried || !(near(before.position, carried.put.p) && same(before.rotation, carried.put.r))) {
                    state.carried.set(held, { rest: { p: { ...before.position }, r: { ...before.rotation } }, put: { p: { ...before.position }, r: { ...before.rotation } } });
                }
                world.update(held, Transform, (t: TransformData) => {
                    t.position = { ...local.p };
                    t.rotation = { ...local.r };
                });
                const after = world.get(held, Transform) as TransformData;
                state.carried.get(held)!.put = { p: { ...after.position }, r: { ...after.rotation } };
            }
            fingerNames.push({ arm: main, pose: profile.mainPose, inline: profile.mainFingers, weight: 1 });
            const supportWeight = Math.min(1, Math.max(0, data.supportWeight));
            if (support && supportAnchor && supportWeight > 0) {
                // Read off the object as it now stands; the object never reads this hand.
                const goal = handFor(support, then(object, supportAnchor), worldOf(world, support.hand).s);
                const turns = bendArm(world, support, goal.at, goal.turn);
                for (const [joint, turn] of turns) {
                    wanted.set(joint, turn);
                    supportWeights.set(joint, supportWeight);
                }
                state.short.support = turns.short ?? 0;
                fingerNames.push({ arm: support, pose: profile.supportPose, inline: profile.supportFingers, weight: supportWeight });
            }
        }
    }

    // The fingers last: a pose said joint by joint on the profile, a captured one by joint name, or a grip pose by name; the last two kinds are handed
    // to the grip-pose system, which eases them on over whatever else holds that hand.
    const now: HolderState['asked'] = {};
    for (const { arm, pose, inline, weight } of fingerNames) {
        const side = arm === state.arms.right ? 'right' : 'left';
        const joints = inlineFingers(inline);
        const captured = joints ? null : capturedFingers(arm, pose);
        if (captured) {
            for (const [joint, turn] of captured) { wanted.set(joint, turn); supportWeights.set(joint, weight); }
        } else if (joints) {
            now[side] = { key: inline, pose: joints, weight: 0, share: weight };
        } else if (gripPose(pose)) {
            now[side] = { key: pose, pose: gripPose(pose)!, weight: 0, share: weight };
        }
    }
    // Let go of, the last grip fades out with the hold; held, what is asked now.
    if (held && main) state.asked = now;
    if (state.amount > 0 || held) {
        const hands = { blendSeconds: data.blendSeconds, rightHand: data.rightHand, leftHand: data.leftHand } as Parameters<typeof askHeldHands>[2];
        for (const side of ['right', 'left'] as const) {
            const a = state.asked[side];
            if (a) hands[side] = { key: a.key, pose: a.pose, weight: state.amount * a.share };
        }
        if (hands.right || hands.left) askHeldHands(app, rig, hands);
    } else {
        state.asked = {};
    }

    // Every joint once: the clip's turn, toward the hold's by how much of it applies, and from the old grip by how far the change has come.
    const touched = new Set<Entity>([...wanted.keys(), ...state.written.keys()]);
    for (const joint of touched) {
        if (!world.valid(joint) || !world.has(joint, Transform)) continue;
        // Already put back to the clip's turn at the top of the frame where nothing else moved it; what a clip wrote since is the new base.
        const clip = (world.get(joint, Transform) as TransformData).rotation;
        state.base.set(joint, { w: clip.w, x: clip.x, y: clip.y, z: clip.z });
        const target = wanted.get(joint);
        const share = state.amount * (supportWeights.get(joint) ?? 1);
        let out = target ? slerpQuat(clip, target, share) : clip;
        const from = state.from.get(joint);
        if (from && state.change < 1) out = slerpQuat(from, out, state.change);
        const value = q.normalize(out);
        world.update(joint, Transform, (t: TransformData) => { t.rotation = { ...value }; });
        const stored = (world.get(joint, Transform) as TransformData).rotation;
        if (target || state.change < 1) state.written.set(joint, { w: stored.w, x: stored.x, y: stored.y, z: stored.z });
        else state.written.delete(joint);
    }
    supportWeights.clear();
    if (state.change >= 1) state.from.clear();
}

/** Per joint, the share of the hold it takes: the supporting hand's weight on its arm and fingers. Reused across holders in one frame. */
const supportWeights = new Map<Entity, number>();

const same = (a: Quat, b: Quat): boolean => Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

/** What a holder found and is doing. @experimental */
export function gripHolderStatus(app: App, rig: Entity): {
    right: boolean; left: boolean; amount: number; held: Entity;
    /** How far each palm stops short of its anchor, in world units: 0 where the arm reaches it. */
    short: { main: number; support: number };
    /** Whether the anchors are mirrored this frame: held by the other hand than they were placed for. */
    mirrored: boolean;
    /** How long the palm is, from the wrist to the middle knuckle, in the hand's own units: what an editor sizes an anchor's marker by. 0 with no hand found. */
    palm: number;
} | null {
    const state = rigs.get(app)?.get(rig);
    const arm = state?.arms.right ?? state?.arms.left;
    return state ? { right: !!state.arms.right, left: !!state.arms.left, amount: state.amount, held: state.held, short: { ...state.short }, mirrored: state.mirrored, palm: arm ? 2 * len(arm.palm.p) : 0 } : null;
}
