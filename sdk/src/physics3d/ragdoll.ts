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
 *          skin follows. The animators on the character are held off while it is limp.
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
import { defineComponent, getComponent, Parent, Transform, type ComponentDef, type ParentData, type TransformData } from '../ecs/component';
import type { MeshSkinData } from '../ecs/component.generated';
import { Animator, type AnimatorData } from '../animation/Animator';
import { q } from '../math/quat';
import { v3 } from '../math/vec3';
import { RigidBody3D, BoxCollider3D } from './Physics3DComponents';
import { SwingTwistJoint3D } from './AdvancedJoint3D';

/** The fields of the `Ragdoll` component. @experimental */
export interface RagdollData {
    /** Whether the character is limp. Turn it on when it is knocked down, off to stand it up. */
    active: boolean;
    /** The entity that holds the `MeshSkin` whose joints are the skeleton; -1 is this entity. */
    skin: number;
    /** How far a limb may swing from its bone's line, in degrees, either way. */
    swing: number;
    /** How far a limb may twist about its own line, in degrees, either way. */
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
    active: false, skin: -1, swing: 45, twist: 30, thickness: 0.25, minBoneLength: 0.05, friction: 0.5, recoverTime: 0.4,
}, {
    entityFields: ['skin'],
    fields: {
        active: { category: 'Ragdoll', tooltip: 'Whether the character is limp. Turn it on when it is knocked down, off to stand it up.' },
        skin: { category: 'Ragdoll', tooltip: 'The entity that holds the skinned mesh, whose joints are the skeleton. Empty is this entity.' },
        swing: { min: 0, max: 175, category: 'Limits', tooltip: 'How far a limb may swing from its bone\'s line, in degrees.' },
        twist: { min: 0, max: 175, category: 'Limits', tooltip: 'How far a limb may twist about its own line, in degrees.' },
        thickness: { min: 0.01, max: 2, category: 'Bodies', tooltip: 'A limb\'s thickness as a fraction of its length.' },
        minBoneLength: { min: 0, category: 'Bodies', tooltip: 'A bone shorter than this gets no body of its own (a finger, a toe): its parent carries it.' },
        friction: { min: 0, category: 'Bodies' },
        recoverTime: { min: 0, category: 'Recovery', tooltip: 'Seconds to blend from the limp pose back to the animation once the ragdoll is turned off.' },
    },
});

/** A bone as the plan reads it: where it is in the world, and the nearest bone above it. */
export interface RagdollBone {
    id: number;
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
export function planRagdoll(bones: readonly RagdollBone[], options: { thickness: number; minBoneLength: number }): RagdollLimb[] {
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
        };
        limbs.push(limb);
        limbOf.set(bone.id, limb);
    }
    return limbs;
}

/** What a ragdoll holds while it is limp: the bodies it made, and the animators it held off. */
interface Limp {
    limbs: Entity[];
    /** Every bone of the skeleton, for the pose to be blended back. */
    bones: Entity[];
    animators: Entity[];
}

/** The pose a bone was left in, to blend from. */
interface Recovery {
    elapsed: number;
    duration: number;
    from: Map<Entity, { position: Vec3; rotation: Quat }>;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function nlerp(a: Quat, b: Quat, t: number): Quat {
    const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    const s = dot < 0 ? -1 : 1;
    return q.normalize({ w: a.w + (s * b.w - a.w) * t, x: a.x + (s * b.x - a.x) * t, y: a.y + (s * b.y - a.y) * t, z: a.z + (s * b.z - a.z) * t });
}

/** Installs the system that turns a `Ragdoll`'s switch into bodies, and back. Called once by the 3D physics plugin. */
export function installRagdolls(app: App): void {
    const limp = new Map<Entity, Limp>();
    const recovering = new Map<Entity, Recovery>();
    const world = app.world;

    const skeletonOf = (entity: Entity, data: RagdollData): { skin: Entity; joints: Entity[] } | null => {
        const skin = (data.skin >= 0 ? data.skin : entity) as Entity;
        // By name: the skin's joints are a variable-length list the component table has no layout for.
        const skinDef = getComponent('MeshSkin');
        if (!skinDef || !world.valid(skin) || !world.has(skin, skinDef)) return null;
        const joints = (world.get(skin, skinDef) as MeshSkinData).joints.filter((j) => world.valid(j) && world.has(j, Transform));
        return joints.length > 0 ? { skin, joints } : null;
    };

    /** The animators that would fight the bodies: on the character, its skin, and what they hang from. */
    const animatorsOf = (entity: Entity, skin: Entity): Entity[] => {
        const found = new Set<Entity>();
        for (const start of [entity, skin]) {
            let e: Entity | undefined = start;
            for (let guard = 0; e !== undefined && world.valid(e) && guard < 64; guard++) {
                if (world.has(e, Animator)) found.add(e);
                e = world.has(e, Parent) ? (world.get(e, Parent) as ParentData).entity : undefined;
            }
        }
        return [...found];
    };

    const activate = (entity: Entity, data: RagdollData): void => {
        const rig = skeletonOf(entity, data);
        if (!rig) return;
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
                position: { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z },
                rotation: { w: t.worldRotation.w, x: t.worldRotation.x, y: t.worldRotation.y, z: t.worldRotation.z },
            };
        });
        const limbs = planRagdoll(bones, { thickness: data.thickness, minBoneLength: data.minBoneLength });
        const swing = (data.swing * Math.PI) / 180, twist = (data.twist * Math.PI) / 180;
        for (const limb of limbs) {
            const e = limb.entity as Entity;
            world.insert(e, RigidBody3D, { bodyType: 2, enabled: true });
            world.insert(e, BoxCollider3D, { halfExtents: limb.halfExtents, center: limb.center, friction: data.friction, restitution: 0, isSensor: false, enabled: true });
            if (limb.connected !== null) {
                world.insert(e, SwingTwistJoint3D, {
                    connectedEntity: limb.connected, anchor: { x: 0, y: 0, z: 0 }, axis: limb.axis, normalAxis: limb.normalAxis,
                    enableMotor: false, angularVelocity: { x: 0, y: 0, z: 0 }, maxMotorTorque: 10, collideConnected: false, enabled: true,
                    normalHalfConeAngle: swing, planeHalfConeAngle: swing, twistMinAngle: -twist, twistMaxAngle: twist,
                });
            }
        }
        const animators = animatorsOf(entity, rig.skin);
        for (const a of animators) {
            const d = world.get(a, Animator) as AnimatorData;
            if (d.enabled) world.insert(a, Animator, { ...d, enabled: false });
        }
        recovering.delete(entity);
        limp.set(entity, { limbs: limbs.map((l) => l.entity as Entity), bones: rig.joints, animators });
    };

    const deactivate = (entity: Entity, data: RagdollData): void => {
        const held = limp.get(entity);
        if (!held) return;
        limp.delete(entity);
        // The pose the bodies were left in, before they are taken away.
        const from = new Map<Entity, { position: Vec3; rotation: Quat }>();
        for (const bone of held.bones) {
            if (!world.valid(bone)) continue;
            const t = world.get(bone, Transform) as TransformData;
            from.set(bone, {
                position: { x: t.position.x, y: t.position.y, z: t.position.z },
                rotation: { w: t.rotation.w, x: t.rotation.x, y: t.rotation.y, z: t.rotation.z },
            });
        }
        for (const e of held.limbs) {
            if (!world.valid(e)) continue;
            world.remove(e, SwingTwistJoint3D);
            world.remove(e, BoxCollider3D);
            world.remove(e, RigidBody3D);
        }
        for (const a of held.animators) {
            if (!world.valid(a)) continue;
            const d = world.get(a, Animator) as AnimatorData;
            world.insert(a, Animator, { ...d, enabled: true });
        }
        if (data.recoverTime > 0) recovering.set(entity, { elapsed: 0, duration: data.recoverTime, from });
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

    // After the animation has written its pose for the frame: the blend is between that and where the body was.
    app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([Res(Time)], (time: TimeData) => {
        for (const [entity, r] of recovering) {
            r.elapsed += time.delta;
            const w = smooth(Math.min(r.elapsed / r.duration, 1));
            for (const [bone, was] of r.from) {
                if (!world.valid(bone)) continue;
                const t = world.get(bone, Transform) as TransformData;
                t.position.x = was.position.x + (t.position.x - was.position.x) * w;
                t.position.y = was.position.y + (t.position.y - was.position.y) * w;
                t.position.z = was.position.z + (t.position.z - was.position.z) * w;
                const r2 = nlerp(was.rotation, { w: t.rotation.w, x: t.rotation.x, y: t.rotation.y, z: t.rotation.z }, w);
                t.rotation.x = r2.x; t.rotation.y = r2.y; t.rotation.z = r2.z; t.rotation.w = r2.w;
                world.set(bone, Transform, t);
            }
            if (r.elapsed >= r.duration) recovering.delete(entity);
        }
    }, { name: 'RagdollRecoverSystem' }), { runIf: playModeOnly });
}
