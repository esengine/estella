// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ragdoll.ts
 * @brief   A skinned character that goes limp: its bones become bodies joined by swing/twist limits, and give the pose back to the animation after.
 *
 * @details A `Ragdoll` is read off the skeleton a character already has (the joints its `MeshSkin` names), so there is nothing to author beyond the
 *          switch and a few numbers. Turning `active` on gives each bone that is long enough a box along the bone (a box, because a capsule is
 *          aligned to its body's y and a bone is not) and a `SwingTwistJoint3D` to the nearest bone above it that has one, at the pose the animation had that frame,
 *          so nothing snaps. The bodies are the ordinary 3D physics ones: the solver writes each bone's pose back through the hierarchy, and the
 *          skin follows. The animation keeps running underneath and the bodies' pose is put back over it each frame.
 *
 *          Turning it off removes the bodies and lets the animation drive again, and over `recoverTime` seconds blends from the pose the body
 *          was in to the one the animation gives, so a character does not pop upright. That is the whole of a passive ragdoll; driving the limbs
 *          (a motor, a stand-up pose match) is left for later.
 */
import type { App } from '../app/app';
import type { Entity, Quat, Vec3 } from '../types';
import type { World } from '../ecs/world';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { defineComponent, getComponent, Name, Parent, Children, Transform, type ComponentDef, type ParentData, type ChildrenData, type TransformData } from '../ecs/component';
import type { MeshSkinData } from '../ecs/component.generated';
import { q } from '../math/quat';
import { log } from '../util/logger';
import { v3 } from '../math/vec3';
import { RigidBody3D, BoxCollider3D } from './Physics3DComponents';
import { SwingTwistJoint3D, SixDOFJoint3D, JointMotion3D, type SwingTwistJoint3DData, type SixDOFJoint3DData } from './AdvancedJoint3D';

/** How a ragdoll's joints are limited. */
export const RagdollProfile = {
    /** Every joint gets `swing` and `twist`. */
    Uniform: 0,
    /** Each joint gets the share of them its part of a body has, read from the bone's name: a spine stiff, a shoulder loose, a shin almost a hinge. A bone the names do not place gets all of it. */
    Humanoid: 1,
} as const;

/** Which of its own axes a character looks along. */
export const RagdollFacing = { PlusZ: 0, MinusZ: 1, PlusX: 2, MinusX: 3 } as const;

/** The fields of the `Ragdoll` component. @experimental */
export interface RagdollData {
    /** Whether the character is limp. Turn it on when it is knocked down, off to stand it up. */
    active: boolean;
    /** The entity that holds the `MeshSkin` whose joints are the skeleton. 0 looks on this entity and then below it. */
    skin: number;
    /** {@link RagdollProfile}: whether every joint gets the same limits, or each the limits its part of a body has. */
    profile: number;
    /** How far a limb may swing from its bone's line, in degrees, either way. With the humanoid profile this is the most a loose joint (a shoulder, a hip) is given. */
    swing: number;
    /** How far a limb may twist about its own line, in degrees, either way. With the humanoid profile this is the most a loose joint is given. */
    twist: number;
    /** How far a knee or an elbow may bend, in degrees, and only one way: a shin folds back, a forearm folds forward. 0 leaves them swinging like any other joint. Humanoid profile only. */
    bend: number;
    /** {@link RagdollFacing}: which way the character looks, in its own frame. It is what tells a knee from a hyperextended one. */
    facing: number;
    /** A limb's thickness as a fraction of its length. */
    thickness: number;
    /** A bone shorter than this (world units) gets no body of its own: a finger, a toe. Its parent carries it. */
    minBoneLength: number;
    friction: number;
    /** Seconds to blend from the limp pose back to the animation once `active` is turned off. 0 pops. */
    recoverTime: number;
}

/**
 * A skinned character that can go limp.
 *
 * @experimental
 */
export const Ragdoll: ComponentDef<RagdollData> = defineComponent<RagdollData>('Ragdoll', {
    active: false, skin: 0, profile: RagdollProfile.Humanoid, swing: 100, twist: 60, bend: 130, facing: RagdollFacing.PlusZ, thickness: 0.25, minBoneLength: 0.05, friction: 0.5, recoverTime: 0.4,
}, {
    entityFields: ['skin'],
    fields: {
        active: { category: 'Ragdoll', tooltip: 'Whether the character is limp. Turn it on when it is knocked down, off to stand it up.' },
        skin: { category: 'Ragdoll', tooltip: 'The entity that holds the skinned mesh, whose joints are the skeleton. Empty looks on this entity and then below it.' },
        profile: { enum: [{ label: 'Uniform', value: RagdollProfile.Uniform }, { label: 'Humanoid', value: RagdollProfile.Humanoid }], category: 'Limits', tooltip: 'Uniform gives every joint the same limits. Humanoid gives each the share of them its part of a body has, read from the bone\'s name: a spine stiff, a shoulder loose, a shin almost a hinge.' },
        swing: { min: 0, max: 175, category: 'Limits', tooltip: 'How far a limb may swing from its bone\'s line, in degrees. With the humanoid profile, the most a loose joint (a shoulder, a hip) is given.' },
        twist: { min: 0, max: 175, category: 'Limits', tooltip: 'How far a limb may twist about its own line, in degrees. With the humanoid profile, the most a loose joint is given.' },
        thickness: { min: 0.01, max: 2, category: 'Bodies', tooltip: 'A limb\'s thickness as a fraction of its length.' },
        minBoneLength: { min: 0, category: 'Bodies', tooltip: 'A bone shorter than this gets no body of its own (a finger, a toe): its parent carries it.' },
        bend: { min: 0, max: 175, category: 'Limits', tooltip: 'How far a knee or an elbow may bend, in degrees, and only one way: a shin folds back, a forearm folds forward. 0 leaves them swinging like any other joint. Humanoid profile only.' },
        facing: { enum: [{ label: '+Z', value: RagdollFacing.PlusZ }, { label: '-Z', value: RagdollFacing.MinusZ }, { label: '+X', value: RagdollFacing.PlusX }, { label: '-X', value: RagdollFacing.MinusX }], category: 'Limits', tooltip: 'Which of its own axes the character looks along. It is what tells a knee from a hyperextended one.' },
        friction: { min: 0, category: 'Bodies' },
        recoverTime: { min: 0, category: 'Recovery', tooltip: 'Seconds to blend from the limp pose back to the animation once the ragdoll is turned off.' },
    },
});

/** The fields of the `RagdollJoint` component. @experimental */
export interface RagdollJointData {
    /** Whether this bone gets a body of its own. Off, the bone above carries it. */
    body: boolean;
    /** Whether the limits below stand in for the ones the profile would give this joint. */
    custom: boolean;
    /** How far the limb may swing from its bone's line, in degrees, either way. */
    swing: number;
    /** How far the limb may twist about its own line, in degrees, either way. */
    twist: number;
    /** How far it may bend, in degrees, one way only (a knee, an elbow). 0 is an ordinary swing and twist joint. */
    bend: number;
    /** Which way a bend goes where the bone's name does not say: 0 as its name says (a shin back, a forearm forward), 1 toward the way the character faces, -1 away from it. */
    fold: number;
}

/**
 * What the author says of one bone of a ragdoll: that it gets no body, or limits of its own. Put it on the bone's entity.
 *
 * @experimental
 */
export const RagdollJoint: ComponentDef<RagdollJointData> = defineComponent<RagdollJointData>('RagdollJoint', {
    body: true, custom: false, swing: 70, twist: 40, bend: 0, fold: 0,
}, {
    fields: {
        body: { category: 'Ragdoll', tooltip: 'Whether this bone gets a body of its own. Off, the bone above carries it.' },
        custom: { category: 'Limits', tooltip: 'Use the limits below instead of the ones the ragdoll\'s profile gives this joint.' },
        swing: { min: 0, max: 175, category: 'Limits', tooltip: 'How far the limb may swing from its bone\'s line, in degrees, either way.', shownWhen: { field: 'custom', values: [1] } },
        twist: { min: 0, max: 175, category: 'Limits', tooltip: 'How far the limb may twist about its own line, in degrees, either way.', shownWhen: { field: 'custom', values: [1] } },
        bend: { min: 0, max: 175, category: 'Limits', tooltip: 'How far it may bend, in degrees, one way only (a knee, an elbow). 0 is an ordinary swing and twist joint.', shownWhen: { field: 'custom', values: [1] } },
        fold: { enum: [{ label: 'As its name says', value: 0 }, { label: 'Toward the facing', value: 1 }, { label: 'Away from the facing', value: -1 }], category: 'Limits', tooltip: 'Which way a bend goes where the bone\'s name does not say.', shownWhen: { field: 'custom', values: [1] } },
    },
});

/** A bone as the plan reads it: where it is in the world, and the nearest bone above it. */
export interface RagdollBone {
    id: number;
    /** What the bone is called, which is how the humanoid profile tells a knee from a shoulder. */
    name?: string;
    /** What the author said of this bone in a {@link RagdollJoint}: no body, or limits of its own, in degrees. */
    override?: { body?: boolean; swing?: number; twist?: number; bend?: number; fold?: number };
    parent: number | null;
    position: Vec3;
    rotation: Quat;
}

/** What one limb is made of: a box in its bone's frame, and the joint to the limb above. */
export interface RagdollLimb {
    entity: number;
    /** The limb whose body this one is joined to; null for the topmost, which hangs from nothing. */
    connected: number | null;
    halfExtents: Vec3;
    center: Vec3;
    /** The twist axis and a reference perpendicular to it, in this bone's own frame. */
    axis: Vec3;
    normalAxis: Vec3;
    /** The share (0 to 1) of the component's swing and twist this joint gets. */
    swing: number;
    twist: number;
    /** Limits the author gave this bone in degrees, which stand in for the share of the component's. */
    swingDeg?: number;
    twistDeg?: number;
    /**
     * Set where the joint is a one-way hinge (a knee, an elbow): the hinge axis and a reference perpendicular to it, in this bone's own frame, and
     * how far the bone may turn about it either way from the pose it is in when the joint is made, in radians (the lower is at most 0, the upper at least 0).
     */
    hinge?: { axis: Vec3; normalAxis: Vec3; lower: number; upper: number };
}

/** The parts of a body whose joints are limited differently. */
export type BoneClass = 'spine' | 'neck' | 'head' | 'shoulder' | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot' | 'toe' | 'other';

/** The share of the swing and twist each part gets: a trunk bends little, a shoulder and a hip go round, a knee and an elbow are almost hinges. */
export const BONE_LIMITS: Readonly<Record<BoneClass, { swing: number; twist: number }>> = {
    spine: { swing: 0.3, twist: 0.35 },
    neck: { swing: 0.45, twist: 0.6 },
    head: { swing: 0.4, twist: 0.6 },
    shoulder: { swing: 0.25, twist: 0.15 },
    upperArm: { swing: 1, twist: 0.8 },
    forearm: { swing: 0.8, twist: 0.1 },
    hand: { swing: 0.45, twist: 0.25 },
    thigh: { swing: 0.75, twist: 0.4 },
    shin: { swing: 0.9, twist: 0.08 },
    foot: { swing: 0.35, twist: 0.2 },
    toe: { swing: 0.25, twist: 0.08 },
    other: { swing: 1, twist: 1 },
};

/**
 * Which part of a body a bone is, from its name (Rigify's `DEF-upper_arm.L`, Mixamo's `LeftArm`, a plain `forearm_r`). The checks go from the more specific to the less, because
 * a forearm is also an arm and a shin a leg.
 *
 * @experimental
 */
export function classifyBone(name: string | undefined): BoneClass {
    const n = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (!n) return 'other';
    if (/toe/.test(n)) return 'toe';
    if (/foot|ankle/.test(n)) return 'foot';
    if (/shin|calf|lowerleg|knee/.test(n)) return 'shin';
    if (/thigh|upperleg|upleg/.test(n)) return 'thigh';
    if (/hand|wrist|palm/.test(n)) return 'hand';
    if (/forearm|lowerarm|elbow/.test(n)) return 'forearm';
    if (/upperarm|uparm/.test(n)) return 'upperArm';
    if (/shoulder|clavicle|collar/.test(n)) return 'shoulder';
    if (/neck/.test(n)) return 'neck';
    if (/head/.test(n)) return 'head';
    if (/spine|chest|torso|abdomen|belly/.test(n)) return 'spine';
    // A bare "arm" or "leg": Mixamo's LeftArm is the upper arm, its LeftLeg the thigh.
    if (/arm/.test(n)) return 'upperArm';
    if (/leg/.test(n)) return 'thigh';
    return 'other';
}

const EPS = 1e-9;

/** A direction perpendicular to `a`. */
function perpendicular(a: Vec3): Vec3 {
    const ref = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    return v3.normalize(v3.cross(a, ref));
}

/**
 * The limbs a skeleton is made into. Pure: bones in, limbs out, parents before children.
 *
 * A bone points at its longest child; one with no children (a hand, a head) takes its parent's line and half its length. A bone shorter than
 * `minBoneLength` gets no limb, and what hangs from it hangs from the limb above.
 *
 * @experimental
 */
export function planRagdoll(bones: readonly RagdollBone[], options: { thickness: number; minBoneLength: number; profile?: number; bend?: number; forward?: Vec3 }): RagdollLimb[] {
    const byId = new Map(bones.map((b) => [b.id, b]));
    const children = new Map<number, RagdollBone[]>();
    for (const b of bones) {
        if (b.parent === null || !byId.has(b.parent)) continue;
        let list = children.get(b.parent);
        if (!list) children.set(b.parent, list = []);
        list.push(b);
    }
    const limbs: RagdollLimb[] = [];
    const limbOf = new Map<number, RagdollLimb>();
    const lengthTo = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

    // Parents before children, from the roots down.
    const roots = bones.filter((b) => b.parent === null || !byId.has(b.parent));
    const order: RagdollBone[] = [];
    const visit = (b: RagdollBone): void => { order.push(b); for (const c of children.get(b.id) ?? []) visit(c); };
    for (const r of roots) visit(r);

    for (const bone of order) {
        // A bone the author gave no body is carried by the one above, as a bone too short for one is.
        if (bone.override?.body === false) continue;
        // Where the bone points: at its longest child, else on along the line its parent came in by.
        let target: Vec3 | null = null, length = 0;
        for (const c of children.get(bone.id) ?? []) {
            const d = lengthTo(bone.position, c.position);
            if (d > length) { length = d; target = v3.sub(c.position, bone.position); }
        }
        if (!target) {
            const above = bone.parent === null ? undefined : byId.get(bone.parent);
            if (!above) continue;
            const run = v3.sub(bone.position, above.position);
            length = Math.hypot(run.x, run.y, run.z) / 2;
            target = v3.scale(v3.normalize(run), length);
        }
        if (length < Math.max(options.minBoneLength, EPS)) continue;

        // The bone's line and its box, in the bone's own frame (the collider is not scaled by the entity, so this is in world units).
        const local = q.rotate(q.conjugate(bone.rotation), target);
        const axisIndex = Math.abs(local.x) >= Math.abs(local.y) && Math.abs(local.x) >= Math.abs(local.z) ? 0 : Math.abs(local.y) >= Math.abs(local.z) ? 1 : 2;
        const thickness = Math.max(length * options.thickness, 1e-4);
        const half = [thickness, thickness, thickness];
        half[axisIndex] = length / 2;
        const axis = v3.normalize(local);

        // Joined to the nearest bone above that has a limb.
        let above = bone.parent === null ? undefined : byId.get(bone.parent);
        while (above && !limbOf.has(above.id)) above = above.parent === null ? undefined : byId.get(above.parent);

        const limb: RagdollLimb = {
            entity: bone.id,
            connected: above ? above.id : null,
            halfExtents: { x: half[0]!, y: half[1]!, z: half[2]! },
            center: { x: local.x / 2, y: local.y / 2, z: local.z / 2 },
            axis,
            normalAxis: perpendicular(axis),
            ...(options.profile === RagdollProfile.Uniform ? { swing: 1, twist: 1 } : BONE_LIMITS[classifyBone(bone.name)]),
        };
        // A knee folds back and an elbow folds forward, from the straight line the bone above makes: the hinge is across that line and the way the character faces, and what it may do
        // is measured from the pose it is in now, so the allowance is the bend left and the extension it already has.
        const kind = classifyBone(bone.name);
        const ov = bone.override;
        if (ov?.swing !== undefined) limb.swingDeg = ov.swing;
        if (ov?.twist !== undefined) limb.twistDeg = ov.twist;
        const bend = ov?.bend ?? (options.profile !== RagdollProfile.Uniform ? options.bend : 0) ?? 0;
        const side = ov?.fold ? (ov.fold > 0 ? 1 : -1) : kind === 'shin' ? -1 : kind === 'forearm' ? 1 : 0;
        if (bend > 0 && side !== 0 && options.forward && above) {
            const hinge = hingeFor(bone, above, target, side as 1 | -1, options.forward, (bend * Math.PI) / 180);
            if (hinge) limb.hinge = hinge;
        }
        limbs.push(limb);
        limbOf.set(bone.id, limb);
    }
    return limbs;
}

/** A bone's local pose. */
interface Pose { position: Vec3; rotation: Quat }

/**
 * The one-way hinge of a knee or an elbow, or null where the character's facing runs along the bone so no side is the bending one.
 *
 * `along` is the bone above's line, from its own origin to this bone's; `bendSide` is 1 where the bone folds toward the way the character looks and -1 where it folds away.
 */
function hingeFor(bone: RagdollBone, above: RagdollBone, target: Vec3, bendSide: 1 | -1, forward: Vec3, bend: number): RagdollLimb['hinge'] | null {
    const run = v3.sub(bone.position, above.position);
    if (Math.hypot(run.x, run.y, run.z) < 1e-9) return null;
    const a0 = v3.normalize(run);
    const f = v3.scale(forward, bendSide);
    const side = v3.sub(f, v3.scale(a0, v3.dot(f, a0)));
    if (Math.hypot(side.x, side.y, side.z) < 0.3) return null;
    const d = v3.normalize(side);
    const h = v3.normalize(v3.cross(a0, d));
    const b = v3.normalize(target);
    // How far it is bent now, toward the bending side (negative if it is past straight the other way).
    const now = Math.atan2(v3.dot(v3.cross(a0, b), h), v3.dot(a0, b));
    const toLocal = (v: Vec3): Vec3 => q.rotate(q.conjugate(bone.rotation), v);
    const axis = toLocal(h);
    return { axis, normalAxis: perpendicular(axis), lower: Math.min(-now, -0.02), upper: Math.max(bend - now, 0.02) };
}

/** What a ragdoll holds while it is limp. */
interface Limp {
    limbs: Entity[];
    /** The pose each limb's body left it in at the last fixed step: what is put back after the animation has written its own. */
    posed: Map<Entity, Pose>;
}

/** Limbs handed back to the animation, and the pose each was left in. */
interface Recovery {
    elapsed: number;
    duration: number;
    from: Map<Entity, Pose>;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function nlerp(a: Quat, b: Quat, t: number): Quat {
    const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    const s = dot < 0 ? -1 : 1;
    return q.normalize({ w: a.w + (s * b.w - a.w) * t, x: a.x + (s * b.x - a.x) * t, y: a.y + (s * b.y - a.y) * t, z: a.z + (s * b.z - a.z) * t });
}

/** What a ragdoll is made of: the skeleton it reads, and what each limb gets (a body, and a joint to the limb above). */
export interface RagdollPlan {
    skin: Entity;
    bones: Entity[];
    limbs: Array<{
        limb: RagdollLimb;
        /** The joint it is given: swing and twist, or a one-way hinge as a six-axis joint. Absent for the topmost limb. */
        joint: { kind: 'swingTwist'; data: SwingTwistJoint3DData } | { kind: 'sixDOF'; data: SixDOFJoint3DData } | null;
    }>;
}

/** The skinned mesh a ragdoll reads its skeleton from: the entity named, or this one, or the first thing below it that is skinned. */
function skinOf(world: World, entity: Entity, data: RagdollData): { skin: Entity; joints: Entity[] } | null {
    // By name: the skin's joints are a variable-length list the component table has no layout for.
    const skinDef = getComponent('MeshSkin');
    if (!skinDef) return null;
    let skin: Entity | null = null;
    if (data.skin > 0 && world.valid(data.skin as Entity) && world.has(data.skin as Entity, skinDef)) skin = data.skin as Entity;
    const queue: Entity[] = data.skin > 0 ? [] : [entity];
    for (let i = 0; skin === null && i < queue.length && i < 4096; i++) {
        const e = queue[i]!;
        if (!world.valid(e)) continue;
        if (world.has(e, skinDef)) { skin = e; break; }
        if (world.has(e, Children)) queue.push(...(world.get(e, Children) as ChildrenData).entities);
    }
    if (skin === null) return null;
    const joints = (world.get(skin, skinDef) as MeshSkinData).joints.filter((j) => world.valid(j) && world.has(j, Transform));
    return joints.length > 0 ? { skin, joints } : null;
}

/**
 * What `entity`'s ragdoll would be made of from the pose its skeleton is in now: the same answer the ragdoll builds its bodies from, so the editor can draw it before anything runs.
 * Null where there is no skinned mesh to read.
 *
 * @experimental
 */
export function ragdollPlan(world: World, entity: Entity, data: RagdollData): RagdollPlan | null {
    const rig = skinOf(world, entity, data);
    if (!rig) return null;
    world.ensureTransformsComposed();
    const set = new Set<number>(rig.joints as number[]);
    const nearestBone = (e: Entity): number | null => {
        let p = world.has(e, Parent) ? (world.get(e, Parent) as ParentData).entity : undefined;
        for (let guard = 0; p !== undefined && world.valid(p) && guard < 256; guard++) {
            if (set.has(p)) return p as number;
            p = world.has(p, Parent) ? (world.get(p, Parent) as ParentData).entity : undefined;
        }
        return null;
    };
    const bones: RagdollBone[] = rig.joints.map((j) => {
        const t = world.get(j, Transform) as TransformData;
        const mark = world.has(j, RagdollJoint) ? world.get(j, RagdollJoint) as RagdollJointData : null;
        return {
            id: j as number, parent: nearestBone(j),
            name: world.has(j, Name) ? (world.get(j, Name) as { value: string }).value : undefined,
            position: { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z },
            rotation: { w: t.worldRotation.w, x: t.worldRotation.x, y: t.worldRotation.y, z: t.worldRotation.z },
            ...(mark ? { override: { body: mark.body, fold: mark.fold, ...(mark.custom ? { swing: mark.swing, twist: mark.twist, bend: mark.bend } : {}) } } : {}),
        };
    });
    const facing = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }][data.facing] ?? { x: 0, y: 0, z: 1 };
    const rootT = world.get(entity, Transform) as TransformData;
    const forward = q.rotate({ w: rootT.worldRotation.w, x: rootT.worldRotation.x, y: rootT.worldRotation.y, z: rootT.worldRotation.z }, facing);
    const limbs = planRagdoll(bones, { thickness: data.thickness, minBoneLength: data.minBoneLength, profile: data.profile, bend: data.bend, forward });
    const rad = (deg: number): number => (Math.min(Math.max(deg, 0), 175) * Math.PI) / 180;
    const none = { x: 0, y: 0, z: 0 };
    return {
        skin: rig.skin, bones: rig.joints,
        limbs: limbs.map((limb) => {
            if (limb.connected === null) return { limb, joint: null };
            if (limb.hinge) {
                // The joint is made on this bone and names the bone above, so the rotation it limits is the bone above's relative to this one: the hinge's turn, the other way round.
                const h = limb.hinge;
                return { limb, joint: { kind: 'sixDOF' as const, data: {
                    connectedEntity: limb.connected, anchor: none, axis: h.axis, normalAxis: h.normalAxis,
                    enableMotor: false, angularVelocity: none, maxMotorTorque: 10, collideConnected: false, enabled: true, breakForce: 0, breakTorque: 0,
                    translationMotion: none, rotationMotion: { x: JointMotion3D.Limited, y: JointMotion3D.Locked, z: JointMotion3D.Locked },
                    translationLower: none, translationUpper: none,
                    rotationLower: { x: -h.upper, y: 0, z: 0 }, rotationUpper: { x: -h.lower, y: 0, z: 0 },
                    linearVelocity: none, maxMotorForce: 0,
                } } };
            }
            const swing = rad(limb.swingDeg ?? data.swing * limb.swing), twist = rad(limb.twistDeg ?? data.twist * limb.twist);
            return { limb, joint: { kind: 'swingTwist' as const, data: {
                connectedEntity: limb.connected, anchor: none, axis: limb.axis, normalAxis: limb.normalAxis,
                enableMotor: false, angularVelocity: none, maxMotorTorque: 10, collideConnected: false, enabled: true, breakForce: 0, breakTorque: 0,
                normalHalfConeAngle: swing, planeHalfConeAngle: swing, twistMinAngle: -twist, twistMaxAngle: twist,
            } } };
        }),
    };
}

/**
 * Installs the systems that turn a `Ragdoll`'s switch into bodies and back. Called once by the 3D physics plugin.
 *
 * The animation is never switched off. A frame runs the fixed steps (the solver writes the bodies' poses into the bones), then Update (the
 * animator writes its own over them), then PostUpdate: where the bodies' poses are written back, so what is drawn is the ragdoll and the next
 * fixed step starts from it. Holding the animator off instead meant restoring it afterwards, which it does not do cleanly (it comes back on
 * a pose of its own), and left a character with no animation to blend back to; run underneath, it is already where it should be.
 */
export function installRagdolls(app: App): void {
    const limp = new Map<Entity, Limp>();
    const recovering = new Map<Entity, Recovery>();
    const world = app.world;

    const localPose = (bone: Entity): Pose => {
        const t = world.get(bone, Transform) as TransformData;
        return {
            position: { x: t.position.x, y: t.position.y, z: t.position.z },
            rotation: { w: t.rotation.w, x: t.rotation.x, y: t.rotation.y, z: t.rotation.z },
        };
    };

    const writePose = (bone: Entity, pose: Pose): void => {
        const t = world.get(bone, Transform) as TransformData;
        t.position.x = pose.position.x; t.position.y = pose.position.y; t.position.z = pose.position.z;
        t.rotation.x = pose.rotation.x; t.rotation.y = pose.rotation.y; t.rotation.z = pose.rotation.z; t.rotation.w = pose.rotation.w;
        world.set(bone, Transform, t);
    };

    const activate = (entity: Entity, data: RagdollData): void => {
        const plan = ragdollPlan(world, entity, data);
        if (!plan) {
            log.warn('physics3d', `Ragdoll on entity ${entity} found no skinned mesh with joints on it or below it`);
            return;
        }
        log.info('physics3d', `Ragdoll on entity ${entity}: ${plan.limbs.length} limbs from ${plan.bones.length} bones`);
        for (const { limb, joint } of plan.limbs) {
            const e = limb.entity as Entity;
            world.insert(e, RigidBody3D, { bodyType: 2, enabled: true });
            world.insert(e, BoxCollider3D, { halfExtents: limb.halfExtents, center: limb.center, friction: data.friction, restitution: 0, isSensor: false, enabled: true });
            if (joint?.kind === 'sixDOF') world.insert(e, SixDOFJoint3D, joint.data);
            else if (joint) world.insert(e, SwingTwistJoint3D, joint.data);
        }
        recovering.delete(entity);
        limp.set(entity, { limbs: plan.limbs.map((l) => l.limb.entity as Entity), posed: new Map() });
    };

    const deactivate = (entity: Entity, data: RagdollData): void => {
        const held = limp.get(entity);
        if (!held) return;
        limp.delete(entity);
        log.info('physics3d', `Ragdoll on entity ${entity} stands up (blend ${data.recoverTime}s)`);
        for (const e of held.limbs) {
            if (!world.valid(e)) continue;
            world.remove(e, SwingTwistJoint3D);
            world.remove(e, SixDOFJoint3D);
            world.remove(e, BoxCollider3D);
            world.remove(e, RigidBody3D);
        }
        // From where the bodies left each limb, to wherever the animation (which has been running all along) has it.
        if (data.recoverTime > 0 && held.posed.size > 0) recovering.set(entity, { elapsed: 0, duration: data.recoverTime, from: held.posed });
    };

    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        for (const entity of world.getEntitiesWithComponents([Ragdoll])) {
            const data = world.get(entity, Ragdoll) as RagdollData;
            const isLimp = limp.has(entity);
            if (data.active && !isLimp) activate(entity, data);
            else if (!data.active && isLimp) deactivate(entity, data);
        }
        for (const entity of [...limp.keys()]) if (!world.valid(entity)) limp.delete(entity);
        for (const entity of [...recovering.keys()]) if (!world.valid(entity)) recovering.delete(entity);
    }, { name: 'RagdollSystem' }), { runIf: playModeOnly });

    // The solver has just written the bodies' poses into the bones; remember them before the animation writes over them.
    app.addSystemToSchedule(Schedule.FixedPostUpdate, defineSystem([], () => {
        for (const held of limp.values()) {
            for (const bone of held.limbs) if (world.valid(bone)) held.posed.set(bone, localPose(bone));
        }
    }, { name: 'RagdollCaptureSystem' }), { runIf: playModeOnly });

    // After the animation has written its pose for the frame: what is drawn is the bodies', and a limb handed back is blended from them.
    app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([Res(Time)], (time: TimeData) => {
        for (const held of limp.values()) {
            for (const [bone, pose] of held.posed) if (world.valid(bone)) writePose(bone, pose);
        }
        for (const [entity, r] of recovering) {
            r.elapsed += time.delta;
            const w = smooth(Math.min(r.elapsed / r.duration, 1));
            for (const [bone, was] of r.from) {
                if (!world.valid(bone)) continue;
                const now = localPose(bone);
                writePose(bone, {
                    position: {
                        x: was.position.x + (now.position.x - was.position.x) * w,
                        y: was.position.y + (now.position.y - was.position.y) * w,
                        z: was.position.z + (now.position.z - was.position.z) * w,
                    },
                    rotation: nlerp(was.rotation, now.rotation, w),
                });
            }
            if (r.elapsed >= r.duration) { recovering.delete(entity); log.info('physics3d', `Ragdoll on entity ${entity} is back on the animation`); }
        }
    }, { name: 'RagdollPoseSystem' }), { runIf: playModeOnly });
}
