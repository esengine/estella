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
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';
import type { JointBreak3DEvent, Physics3DWasmModule } from './Physics3DModule';
import { rotateVec3ByQuat } from './ColliderShape3D';
import { SwingTwistJoint3D, SixDOFJoint3D, joint3DSettingsError, advancedJointSettings, jointMotionBits,
    type SwingTwistJoint3DData, type SixDOFJoint3DData } from './AdvancedJoint3D';
export { SwingTwistJoint3D, SixDOFJoint3D, JointMotion3D, joint3DSettingsError,
    type SwingTwistJoint3DData, type SixDOFJoint3DData } from './AdvancedJoint3D';

export interface PointJoint3DData {
    connectedEntity: number;
    anchor: Vec3;
    collideConnected: boolean;
    enabled: boolean;
    /** The force it gives way at, in newtons: past it the joint is taken out of the world and `enabled` lowered. 0 never. */
    breakForce: number;
    /** The twist it gives way at, in newton metres. 0 never. */
    breakTorque: number;
}

/**
 * A shared point the two bodies turn freely about — a chain link, a ragdoll limb.
 *
 * @experimental
 */
export const PointJoint3D = defineComponent<PointJoint3DData>('PointJoint3D', {
    connectedEntity: -1,
    anchor: { x: 0, y: 0, z: 0 },
    collideConnected: false,
    enabled: true,
    breakForce: 0,
    breakTorque: 0,
}, {
    entityFields: ['connectedEntity'],
    fields: { anchor: { tooltip: 'Where the joint attaches, in THIS entity\'s frame (world units).' } },
});

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
    /** The force it gives way at, in newtons: past it the joint is taken out of the world and `enabled` lowered. 0 never. */
    breakForce: number;
    /** The twist it gives way at, in newton metres. 0 never. */
    breakTorque: number;
    /** Where the hinge is now, in radians. Written by the world each step. */
    angle: number;
}

/**
 * One axis of rotation — a door, a lever, a driven wheel. Limits are radians
 * measured from the pose the joint was made in, so zero is where you placed it.
 *
 * @experimental
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
    breakForce: 0,
    breakTorque: 0,
    angle: 0,
}, {
    entityFields: ['connectedEntity'],
    fields: { anchor: { tooltip: 'Where the joint attaches, in THIS entity\'s frame (world units).' } },
});

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
    /** The force it gives way at, in newtons: past it the joint is taken out of the world and `enabled` lowered. 0 never. */
    breakForce: number;
    /** The twist it gives way at, in newton metres. 0 never. */
    breakTorque: number;
    /** How far along the axis it has travelled, in world units. Written by the
     *  world each step. */
    translation: number;
}

/**
 * One axis of travel — a lift, a piston, a sliding door. Limits are world units
 * along `axis`, again measured from where the joint was made.
 *
 * @experimental
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
    breakForce: 0,
    breakTorque: 0,
    translation: 0,
}, {
    entityFields: ['connectedEntity'],
    fields: { anchor: { tooltip: 'Where the joint attaches, in THIS entity\'s frame (world units).' } },
});

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
    /** The force it gives way at, in newtons: past it the joint is taken out of the world and `enabled` lowered. 0 never. */
    breakForce: number;
    /** The twist it gives way at, in newton metres. 0 never. */
    breakTorque: number;
}

/**
 * A distance kept between two points: a rope when only `maxLength` matters, a rod
 * when the two lengths meet, a spring when `frequency` is above zero.
 *
 * @experimental
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
    breakForce: 0,
    breakTorque: 0,
}, { entityFields: ['connectedEntity'] });

export interface FixedJoint3DData {
    connectedEntity: number;
    collideConnected: boolean;
    enabled: boolean;
    /** The force it gives way at, in newtons: past it the joint is taken out of the world and `enabled` lowered. 0 never. */
    breakForce: number;
    /** The twist it gives way at, in newton metres. 0 never. */
    breakTorque: number;
}

/**
 * No freedom at all: the two move as one. It has no anchor — the pose the pieces
 * are in when the joint is made is the joint.
 *
 * @experimental
 */
export const FixedJoint3D = defineComponent<FixedJoint3DData>('FixedJoint3D', {
    connectedEntity: -1,
    collideConnected: false,
    enabled: true,
    breakForce: 0,
    breakTorque: 0,
}, { entityFields: ['connectedEntity'] });

/** The joint components, in the order the system offers an entity's to the world. */
export const JOINT3D_TYPES = [
    PointJoint3D, HingeJoint3D, SliderJoint3D, DistanceJoint3D, FixedJoint3D, SwingTwistJoint3D, SixDOFJoint3D,
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
    settings?: string;
    motorSettings?: string;
    /** A hinge's or slider's range and motor limit, or a distance joint's lengths and spring, as the world last had
     *  them: a change in play reaches the joint without making it again. */
    shape?: string;
}

export type Joint3DMap = Map<Entity, Joint3DRecord>;

type AnyJoint = { connectedEntity: number; collideConnected: boolean; enabled: boolean };
type Joint3DDef = (typeof JOINT3D_TYPES)[number];

/** An entity's joint: the FIRST of the joint components it carries, matching what the world
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

/** One joint as a visualizer needs it: which rule, what it connects, and the
 *  local geometry that positions it. Anchors and axes are in the declaring
 *  entity's own space, in world units. */
export interface Joint3DShape {
    type: string;
    connectedEntity: number;
    /** Null for a fixed joint, which has no anchor — the pose is the joint. */
    anchor: Vec3 | null;
    /** The far anchor, on the connected entity. Distance joints only. */
    connectedAnchor: Vec3 | null;
    /** The axis a hinge turns about or a slider travels along. */
    axis: Vec3 | null;
    enabled: boolean;
    limits?: SwingTwistJoint3DData | SixDOFJoint3DData;
}

/**
 * The joint an entity declares, in the shape a gizmo draws — the SAME first-wins
 * choice the world makes, so an editor never draws a joint the solver ignored.
 */
export function readJoint3D(world: World, entity: number): Joint3DShape | null {
    for (const def of JOINT3D_TYPES) {
        if (!world.has(entity, def)) continue;
        const d = world.get(entity, def) as unknown as Record<string, unknown>;
        return {
            type: def._name,
            connectedEntity: d.connectedEntity as number,
            anchor: (d.anchor as Vec3 | undefined) ?? null,
            connectedAnchor: (d.connectedAnchor as Vec3 | undefined) ?? null,
            axis: (d.axis as Vec3 | undefined) ?? null,
            enabled: d.enabled !== false,
            limits: def === SwingTwistJoint3D || def === SixDOFJoint3D ? d as unknown as SwingTwistJoint3DData | SixDOFJoint3DData : undefined,
        };
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

    if (def === SwingTwistJoint3D || def === SixDOFJoint3D) {
        const d = raw as SwingTwistJoint3DData | SixDOFJoint3DData;
        if (joint3DSettingsError(d)) return false;
        const a = anchorInMetres(app, entity, d.anchor, ppu);
        const x = axisInWorld(app, entity, d.axis), y = axisInWorld(app, entity, d.normalAxis);
        if ('translationMotion' in d) {
            const lo = d.translationLower, hi = d.translationUpper;
            const rl = d.rotationLower, rh = d.rotationUpper;
            return module._physics3d_addSixDOFJoint(e, bodyA, bodyB, a.x, a.y, a.z,
                x.x, x.y, x.z, y.x, y.y, y.z,
                jointMotionBits(d.translationMotion), jointMotionBits(d.rotationMotion),
                lo.x / ppu, lo.y / ppu, lo.z / ppu, hi.x / ppu, hi.y / ppu, hi.z / ppu,
                rl.x, rl.y, rl.z, rh.x, rh.y, rh.z, collide) !== 0;
        }
        return module._physics3d_addSwingTwistJoint(e, bodyA, bodyB, a.x, a.y, a.z,
            x.x, x.y, x.z, y.x, y.y, y.z, d.normalHalfConeAngle, d.planeHalfConeAngle,
            d.twistMinAngle, d.twistMaxAngle, collide) !== 0;
    }
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
        const advanced = joint && (joint.def === SwingTwistJoint3D || joint.def === SixDOFJoint3D)
            ? joint.data as SwingTwistJoint3DData | SixDOFJoint3DData : null;
        const stillRight = (!advanced || (!joint3DSettingsError(advanced) && advancedJointSettings(advanced) === held.settings))
            && joint !== null
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
                    motorOn: motor.on, motorSpeed: motor.speed, shape: shapeOf(app, entity, joint.def, ppu)?.join(','),
                    settings: joint.def === SwingTwistJoint3D || joint.def === SixDOFJoint3D
                        ? advancedJointSettings(joint.data as SwingTwistJoint3DData | SixDOFJoint3DData) : undefined,
                });
            }
        }
    }

    driveJoints3D(app, module, joints, ppu);
}

/**
 * What a joint's range, motor limit or lengths are now, in the module's units: [enable, lower, upper, limit] for a
 * hinge or slider, [min, max, frequency, damping] for a distance joint; null for a joint that has none.
 */
function shapeOf(app: App, entity: Entity, def: Joint3DDef, ppu: number): number[] | null {
    if (def === HingeJoint3D) {
        const d = app.world.get(entity, HingeJoint3D) as HingeJoint3DData;
        return [d.enableLimit ? 1 : 0, d.lowerAngle, d.upperAngle, d.maxMotorTorque];
    }
    if (def === SliderJoint3D) {
        const d = app.world.get(entity, SliderJoint3D) as SliderJoint3DData;
        return [d.enableLimit ? 1 : 0, d.lowerTranslation / ppu, d.upperTranslation / ppu, d.maxMotorForce];
    }
    if (def === DistanceJoint3D) {
        const d = app.world.get(entity, DistanceJoint3D) as DistanceJoint3DData;
        return [d.minLength / ppu, d.maxLength / ppu, d.frequency, d.damping];
    }
    return null;
}

/** Carry a joint's range, motor limit or lengths into the world when gameplay changed them. */
function reshape(app: App, module: Physics3DWasmModule, entity: Entity, held: Joint3DRecord, def: Joint3DDef, ppu: number): void {
    const now = shapeOf(app, entity, def, ppu);
    if (!now) return;
    const signature = now.join(',');
    if (signature === held.shape) return;
    if (def === DistanceJoint3D) {
        module._physics3d_setDistanceJoint?.(entity as number, now[0]!, now[1]!, now[2]!, now[3]!);
    } else {
        module._physics3d_setJointLimits?.(entity as number, now[0]!, now[1]!, now[2]!);
        module._physics3d_setJointMotorLimit?.(entity as number, now[3]!);
    }
    held.shape = signature;
}

/**
 * Take out of the world every joint that held with more than its breakForce or breakTorque over the step just run, lower its
 * `enabled` so it is not made again, and say so. A joint raised again is made afresh between the bodies where they are then.
 */
export function breakJoints3D(app: App, module: Physics3DWasmModule, joints: Joint3DMap, broken?: JointBreak3DEvent[]): void {
    if (!module._physics3d_jointForce) return;
    for (const [entity, held] of [...joints]) {
        const def = JOINT3D_TYPES.find((d) => d._name === held.type);
        if (!def || !app.world.valid(entity) || !app.world.has(entity, def)) continue;
        const d = app.world.get(entity, def) as unknown as { breakForce?: number; breakTorque?: number; enabled: boolean };
        const maxForce = d.breakForce ?? 0, maxTorque = d.breakTorque ?? 0;
        if (!(maxForce > 0) && !(maxTorque > 0)) continue;
        if (!module._physics3d_jointForce(entity as number)) continue;
        const f32 = module.HEAPF32, o = module._physics3d_queryResult() >> 2;
        const force = f32[o]!, torque = f32[o + 1]!;
        if (!((maxForce > 0 && force > maxForce) || (maxTorque > 0 && torque > maxTorque))) continue;
        module._physics3d_removeJoint(entity as number, held.bodyA, held.bodyB);
        joints.delete(entity);
        d.enabled = false;
        app.world.set(entity, def, d as never);
        broken?.push({ entity, force, torque });
    }
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
        if (held.type === SwingTwistJoint3D._name || held.type === SixDOFJoint3D._name) {
            const def = held.type === SwingTwistJoint3D._name ? SwingTwistJoint3D : SixDOFJoint3D;
            const d = app.world.get(entity, def) as SwingTwistJoint3DData | SixDOFJoint3DData;
            if (joint3DSettingsError(d)) continue;
            const a = d.angularVelocity;
            const v = 'linearVelocity' in d ? d.linearVelocity : { x: 0, y: 0, z: 0 };
            const force = 'maxMotorForce' in d ? d.maxMotorForce : 0;
            const args = [d.enableMotor ? 1 : 0, v.x / ppu, v.y / ppu, v.z / ppu,
                a.x, a.y, a.z, force, d.maxMotorTorque] as const;
            const signature = args.join(',');
            if (signature !== held.motorSettings) {
                module._physics3d_setAdvancedJointMotor(entity as number, ...args);
                held.motorSettings = signature;
            }
        } else if (held.type === DistanceJoint3D._name) {
            reshape(app, module, entity, held, DistanceJoint3D, ppu);
        } else if (held.type === HingeJoint3D._name) {
            reshape(app, module, entity, held, HingeJoint3D, ppu);
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
            reshape(app, module, entity, held, SliderJoint3D, ppu);
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
