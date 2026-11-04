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
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { defineComponent, getComponent, Name, Parent, Children, Transform, type ComponentDef, type ParentData, type ChildrenData, type TransformData } from '../ecs/component';
import type { MeshSkinData } from '../ecs/component.generated';
import { q } from '../math/quat';
import { log } from '../util/logger';
import { v3 } from '../math/vec3';
import { RigidBody3D, BoxCollider3D } from './Physics3DComponents';
import { SwingTwistJoint3D } from './AdvancedJoint3D';

/** How a ragdoll's joints are limited. */
export const RagdollProfile = {
    /** Every joint gets `swing` and `twist`. */
    Uniform: 0,
    /** Each joint gets the share of them its part of a body has, read from the bone's name: a spine stiff, a shoulder loose, a shin almost a hinge. A bone the names do not place gets all of it. */
    Humanoid: 1,
} as const;

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
    active: false, skin: 0, profile: RagdollProfile.Humanoid, swing: 100, twist: 60, thickness: 0.25, minBoneLength: 0.05, friction: 0.5, recoverTime: 0.4,
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
        friction: { min: 0, category: 'Bodies' },
        recoverTime: { min: 0, category: 'Recovery', tooltip: 'Seconds to blend from the limp pose back to the animation once the ragdoll is turned off.' },
    },
});

/** A bone as the plan reads it: where it is in the world, and the nearest bone above it. */
export interface RagdollBone {
    id: number;
    /** What the bone is called, which is how the humanoid profile tells a knee from a shoulder. */
    name?: string;
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
export function planRagdoll(bones: readonly RagdollBone[], options: { thickness: number; minBoneLength: number; profile?: number }): RagdollLimb[] {
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
        limbs.push(limb);
        limbOf.set(bone.id, limb);
    }
    return limbs;
}

/** A bone's local pose. */
interface Pose { position: Vec3; rotation: Quat }

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

    const skeletonOf = (entity: Entity, data: RagdollData): { skin: Entity; joints: Entity[] } | null => {
        // By name: the skin's joints are a variable-length list the component table has no layout for.
        const skinDef = getComponent('MeshSkin');
        if (!skinDef) return null;
        // The named entity, or else this one, or else the first thing below it that is skinned (an imported character keeps its mesh on a child).
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
    };

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
        const rig = skeletonOf(entity, data);
        if (!rig) {
            log.warn('physics3d', `Ragdoll on entity ${entity} found no skinned mesh with joints on it or below it`);
            return;
        }
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
            return {
                id: j as number, parent: nearestBone(j),
                name: world.has(j, Name) ? (world.get(j, Name) as { value: string }).value : undefined,
                position: { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z },
                rotation: { w: t.worldRotation.w, x: t.worldRotation.x, y: t.worldRotation.y, z: t.worldRotation.z },
            };
        });
        const limbs = planRagdoll(bones, { thickness: data.thickness, minBoneLength: data.minBoneLength, profile: data.profile });
        log.info('physics3d', `Ragdoll on entity ${entity}: ${limbs.length} limbs from ${bones.length} bones`);
        const rad = (deg: number): number => (Math.min(Math.max(deg, 0), 175) * Math.PI) / 180;
        for (const limb of limbs) {
            const e = limb.entity as Entity;
            world.insert(e, RigidBody3D, { bodyType: 2, enabled: true });
            world.insert(e, BoxCollider3D, { halfExtents: limb.halfExtents, center: limb.center, friction: data.friction, restitution: 0, isSensor: false, enabled: true });
            if (limb.connected !== null) {
                world.insert(e, SwingTwistJoint3D, {
                    connectedEntity: limb.connected, anchor: { x: 0, y: 0, z: 0 }, axis: limb.axis, normalAxis: limb.normalAxis,
                    enableMotor: false, angularVelocity: { x: 0, y: 0, z: 0 }, maxMotorTorque: 10, collideConnected: false, enabled: true,
                    normalHalfConeAngle: rad(data.swing * limb.swing), planeHalfConeAngle: rad(data.swing * limb.swing),
                    twistMinAngle: -rad(data.twist * limb.twist), twistMaxAngle: rad(data.twist * limb.twist),
                });
            }
        }
        recovering.delete(entity);
        limp.set(entity, { limbs: limbs.map((l) => l.entity as Entity), posed: new Map() });
    };

    const deactivate = (entity: Entity, data: RagdollData): void => {
        const held = limp.get(entity);
        if (!held) return;
        limp.delete(entity);
        log.info('physics3d', `Ragdoll on entity ${entity} stands up (blend ${data.recoverTime}s)`);
        for (const e of held.limbs) {
            if (!world.valid(e)) continue;
            world.remove(e, SwingTwistJoint3D);
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
