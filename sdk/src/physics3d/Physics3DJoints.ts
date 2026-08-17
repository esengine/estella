// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DJoints.ts
 * @brief   Joints between 3D bodies, as a scene authors them.
 * @details A joint lives on the entity that declares it and names the other one,
 *          the same shape the 2D joints use — so a scene reads the same whichever
 *          world it is in, and one entity can be jointed to several others by
 *          carrying several joint entities rather than one crowded component.
 *
 *          Anchors and axes are written in THIS entity's local space, in world
 *          units, and are resolved against its transform when the joint is made:
 *          an author moves the piece and the joint follows, rather than holding a
 *          world coordinate that stops meaning anything once the scene is edited.
 */
import { defineComponent, Transform } from '../ecs/component';
import type { TransformData } from '../ecs/component.generated';
import type { App } from '../app/app';
import type { Entity, Vec3 } from '../types';
import type { Physics3DWasmModule } from './Physics3DModule';
import { rotateVec3ByQuat } from './ColliderShape3D';

export interface PointJoint3DData {
    connectedEntity: number;
    anchor: Vec3;
    collideConnected: boolean;
    enabled: boolean;
}

/**
 * A shared point the two bodies turn freely about — a chain link, a ragdoll limb.
 *
 * @beta
 */
export const PointJoint3D = defineComponent<PointJoint3DData>('PointJoint3D', {
    connectedEntity: -1,
    anchor: { x: 0, y: 0, z: 0 },
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface HingeJoint3DData {
    connectedEntity: number;
    anchor: Vec3;
    axis: Vec3;
    enableLimit: boolean;
    lowerAngle: number;
    upperAngle: number;
    enableMotor: boolean;
    motorSpeed: number;
    maxMotorTorque: number;
    collideConnected: boolean;
    enabled: boolean;
    /** Where the hinge is now, in radians. Written by the world each step. */
    angle: number;
}

/**
 * One axis of rotation — a door, a lever, a driven wheel. Limits are radians
 * measured from the pose the joint was made in, so zero is where you placed it.
 *
 * @beta
 */
export const HingeJoint3D = defineComponent<HingeJoint3DData>('HingeJoint3D', {
    connectedEntity: -1,
    anchor: { x: 0, y: 0, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
    enableLimit: false,
    lowerAngle: -Math.PI / 2,
    upperAngle: Math.PI / 2,
    enableMotor: false,
    motorSpeed: 0,
    maxMotorTorque: 0,
    collideConnected: false,
    enabled: true,
    angle: 0,
}, { entityFields: ['connectedEntity'] });

export interface SliderJoint3DData {
    connectedEntity: number;
    anchor: Vec3;
    axis: Vec3;
    enableLimit: boolean;
    lowerTranslation: number;
    upperTranslation: number;
    enableMotor: boolean;
    motorSpeed: number;
    maxMotorForce: number;
    collideConnected: boolean;
    enabled: boolean;
    /** How far along the axis it has travelled, in world units. Written by the
     *  world each step. */
    translation: number;
}

/**
 * One axis of travel — a lift, a piston, a sliding door. Limits are world units
 * along `axis`, again measured from where the joint was made.
 *
 * @beta
 */
export const SliderJoint3D = defineComponent<SliderJoint3DData>('SliderJoint3D', {
    connectedEntity: -1,
    anchor: { x: 0, y: 0, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
    enableLimit: false,
    lowerTranslation: -100,
    upperTranslation: 100,
    enableMotor: false,
    motorSpeed: 0,
    maxMotorForce: 0,
    collideConnected: false,
    enabled: true,
    translation: 0,
}, { entityFields: ['connectedEntity'] });

export interface DistanceJoint3DData {
    connectedEntity: number;
    anchor: Vec3;
    connectedAnchor: Vec3;
    minLength: number;
    maxLength: number;
    frequency: number;
    damping: number;
    collideConnected: boolean;
    enabled: boolean;
}

/**
 * A distance kept between two points: a rope when only `maxLength` matters, a rod
 * when the two lengths meet, a spring when `frequency` is above zero.
 *
 * @beta
 */
export const DistanceJoint3D = defineComponent<DistanceJoint3DData>('DistanceJoint3D', {
    connectedEntity: -1,
    anchor: { x: 0, y: 0, z: 0 },
    connectedAnchor: { x: 0, y: 0, z: 0 },
    minLength: 0,
    maxLength: 100,
    frequency: 0,
    damping: 0.5,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface FixedJoint3DData {
    connectedEntity: number;
    collideConnected: boolean;
    enabled: boolean;
}

/**
 * No freedom at all: the two move as one. It has no anchor — the pose the pieces
 * are in when the joint is made is the joint.
 *
 * @beta
 */
export const FixedJoint3D = defineComponent<FixedJoint3DData>('FixedJoint3D', {
    connectedEntity: -1,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

/** The joint components, in the order the system offers an entity's to the world. */
export const JOINT3D_TYPES = [
    PointJoint3D, HingeJoint3D, SliderJoint3D, DistanceJoint3D, FixedJoint3D,
] as const;

/** What the world holds for one joint: the two bodies it was built between, which
 *  are what it takes to take the joint back out again. */
export interface Joint3DRecord {
    bodyA: number;
    bodyB: number;
    /** Which component built it — a joint whose component changed is rebuilt. */
    type: string;
    /** The motor the world was last told about, so a joint is only re-driven when
     *  gameplay actually changed it. */
    motorOn: boolean;
    motorSpeed: number;
}

export type Joint3DMap = Map<Entity, Joint3DRecord>;

type AnyJoint = { connectedEntity: number; collideConnected: boolean; enabled: boolean };
type Joint3DDef = (typeof JOINT3D_TYPES)[number];

/** An entity's joint: the FIRST of the five it carries, matching what the world
 *  builds — the module keys one constraint per entity, so a second component on
 *  the same entity would be geometry nothing enforces. */
function jointOn(app: App, entity: Entity): { def: Joint3DDef; data: AnyJoint } | null {
    for (const def of JOINT3D_TYPES) {
        if (app.world.has(entity, def)) {
            return { def, data: app.world.get(entity, def) as unknown as AnyJoint };
        }
    }
    return null;
}

/** A local (world-unit) point on `entity`, in metres, where the solver wants it. */
function anchorInMetres(app: App, entity: Entity, local: Vec3, ppu: number): Vec3 {
    const t = app.world.get(entity, Transform) as TransformData | undefined;
    const p = t?.worldPosition ?? { x: 0, y: 0, z: 0 };
    const r = t?.worldRotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const turned = rotateVec3ByQuat(r, local);
    return { x: (p.x + turned.x) / ppu, y: (p.y + turned.y) / ppu, z: (p.z + turned.z) / ppu };
}

/** A local direction on `entity`, in world space. Directions do not scale. */
function axisInWorld(app: App, entity: Entity, local: Vec3): Vec3 {
    const t = app.world.get(entity, Transform) as TransformData | undefined;
    return rotateVec3ByQuat(t?.worldRotation ?? { x: 0, y: 0, z: 0, w: 1 }, local);
}

/**
 * Hand one joint to the world. The entity that declares it is body A and the one
 * it names is body B, so `anchor` and `connectedAnchor` read in that order and a
 * hinge's angle grows the way the axis points.
 */
function build(app: App, module: Physics3DWasmModule, entity: Entity,
               def: Joint3DDef, bodyA: number, bodyB: number, ppu: number): boolean {
    const raw = app.world.get(entity, def) as unknown;
    const collide = (raw as AnyJoint).collideConnected ? 1 : 0;
    const e = entity as number;

    if (def === PointJoint3D) {
        const d = raw as PointJoint3DData;
        const a = anchorInMetres(app, entity, d.anchor, ppu);
        return module._physics3d_addPointJoint(e, bodyA, bodyB, a.x, a.y, a.z, collide) !== 0;
    }
    if (def === HingeJoint3D) {
        const d = raw as HingeJoint3DData;
        const a = anchorInMetres(app, entity, d.anchor, ppu);
        const axis = axisInWorld(app, entity, d.axis);
        return module._physics3d_addHingeJoint(
            e, bodyA, bodyB, a.x, a.y, a.z, axis.x, axis.y, axis.z,
            d.enableLimit ? 1 : 0, d.lowerAngle, d.upperAngle,
            d.enableMotor ? 1 : 0, d.motorSpeed, d.maxMotorTorque, collide) !== 0;
    }
    if (def === SliderJoint3D) {
        const d = raw as SliderJoint3DData;
        const a = anchorInMetres(app, entity, d.anchor, ppu);
        const axis = axisInWorld(app, entity, d.axis);
        // Travel and speed are lengths; torque and force are not, the same split
        // the 2D joints make.
        return module._physics3d_addSliderJoint(
            e, bodyA, bodyB, a.x, a.y, a.z, axis.x, axis.y, axis.z,
            d.enableLimit ? 1 : 0, d.lowerTranslation / ppu, d.upperTranslation / ppu,
            d.enableMotor ? 1 : 0, d.motorSpeed / ppu, d.maxMotorForce, collide) !== 0;
    }
    if (def === DistanceJoint3D) {
        const d = raw as DistanceJoint3DData;
        const a = anchorInMetres(app, entity, d.anchor, ppu);
        const b = anchorInMetres(app, d.connectedEntity as Entity, d.connectedAnchor, ppu);
        return module._physics3d_addDistanceJoint(
            e, bodyA, bodyB, a.x, a.y, a.z, b.x, b.y, b.z,
            d.minLength / ppu, d.maxLength / ppu, d.frequency, d.damping, collide) !== 0;
    }
    return module._physics3d_addFixedJoint(e, bodyA, bodyB, collide) !== 0;
}

/**
 * Bring the world's joints in line with the ECS.
 *
 * Called BEFORE bodies are removed, and that order is load-bearing: the module
 * holds each constraint against two bodies, so a body taken out from under a live
 * joint leaves the solver holding nothing.
 *
 * @param doomed Entities whose bodies are about to go, so their joints go first.
 */
export function syncJoints3D(app: App, module: Physics3DWasmModule,
                             bodies: Map<Entity, number>, joints: Joint3DMap,
                             ppu: number, doomed: ReadonlySet<Entity>): void {
    for (const [entity, held] of joints) {
        const joint = app.world.valid(entity) ? jointOn(app, entity) : null;
        const connected = joint ? joint.data.connectedEntity as Entity : (-1 as Entity);
        const stillRight = joint !== null
            && joint.data.enabled !== false
            && joint.def._name === held.type
            && !doomed.has(entity) && !doomed.has(connected)
            && bodies.get(entity) === held.bodyA
            && bodies.get(connected) === held.bodyB;
        if (stillRight) continue;
        module._physics3d_removeJoint(entity as number, held.bodyA, held.bodyB);
        joints.delete(entity);
    }

    for (const def of JOINT3D_TYPES) {
        for (const entity of app.world.queryEntities([def])) {
            if (joints.has(entity)) continue;
            const joint = jointOn(app, entity);
            if (!joint || joint.data.enabled === false) continue;
            const bodyA = bodies.get(entity);
            const bodyB = bodies.get(joint.data.connectedEntity as Entity);
            // A joint waits for both ends: a scene that spawns the other half a
            // frame later gets its joint on that frame rather than never.
            if (bodyA === undefined || bodyB === undefined || bodyA === bodyB) continue;
            if (build(app, module, entity, joint.def, bodyA, bodyB, ppu)) {
                const motor = motorOf(app, entity, joint.def, ppu);
                joints.set(entity, {
                    bodyA, bodyB, type: joint.def._name,
                    motorOn: motor.on, motorSpeed: motor.speed,
                });
            }
        }
    }

    driveJoints3D(app, module, joints, ppu);
}

/** The motor a driven joint is asking for right now, in the module's units. */
function motorOf(app: App, entity: Entity, def: Joint3DDef, ppu: number,
): { on: boolean; speed: number } {
    if (def === HingeJoint3D) {
        const d = app.world.get(entity, HingeJoint3D) as HingeJoint3DData;
        return { on: d.enableMotor === true, speed: d.motorSpeed };
    }
    if (def === SliderJoint3D) {
        const d = app.world.get(entity, SliderJoint3D) as SliderJoint3DData;
        return { on: d.enableMotor === true, speed: d.motorSpeed / ppu };
    }
    return { on: false, speed: 0 };
}

/**
 * Carry gameplay's motor changes into the world, and the joint's own state back.
 * A joint is built once, so without this `motorSpeed` would be a field nothing
 * reads after the first frame — and no game could ask how far the door swung.
 */
function driveJoints3D(app: App, module: Physics3DWasmModule, joints: Joint3DMap,
                       ppu: number): void {
    for (const [entity, held] of joints) {
        if (held.type === HingeJoint3D._name) {
            const d = app.world.get(entity, HingeJoint3D) as HingeJoint3DData;
            const on = d.enableMotor === true;
            if (on !== held.motorOn || d.motorSpeed !== held.motorSpeed) {
                module._physics3d_setJointMotor(entity as number, on ? 1 : 0, d.motorSpeed);
                held.motorOn = on;
                held.motorSpeed = d.motorSpeed;
            }
            d.angle = module._physics3d_jointValue(entity as number);
            app.world.set(entity, HingeJoint3D, d);
        } else if (held.type === SliderJoint3D._name) {
            const d = app.world.get(entity, SliderJoint3D) as SliderJoint3DData;
            const on = d.enableMotor === true;
            const speed = d.motorSpeed / ppu;
            if (on !== held.motorOn || speed !== held.motorSpeed) {
                module._physics3d_setJointMotor(entity as number, on ? 1 : 0, speed);
                held.motorOn = on;
                held.motorSpeed = speed;
            }
            d.translation = module._physics3d_jointValue(entity as number) * ppu;
            app.world.set(entity, SliderJoint3D, d);
        }
    }
}
