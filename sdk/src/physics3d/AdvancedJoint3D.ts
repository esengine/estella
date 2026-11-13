// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @file Swing/twist and per-axis constraints, authored in a body's local frame. */
import { defineComponent, type FieldMeta } from '../ecs/component';
import type { Vec3 } from '../types';

/** Axis motion for SixDOF joints. @experimental */
export const JointMotion3D = { Locked: 0, Limited: 1, Free: 2 } as const;

interface JointFrame3D {
    connectedEntity: number;
    anchor: Vec3;
    axis: Vec3;
    normalAxis: Vec3;
    enableMotor: boolean;
    /** Body B's target angular velocity relative to A, in constraint axes, rad/s. */
    angularVelocity: Vec3;
    maxMotorTorque: number;
    collideConnected: boolean;
    enabled: boolean;
    /** The force it gives way at, in newtons: past it the joint is taken out of the world and `enabled` lowered. 0 never. */
    breakForce: number;
    /** The twist it gives way at, in newton metres. 0 never. */
    breakTorque: number;
}

/** Shoulder/hip rotation about a twist axis with an elliptical swing cone. @experimental */
export interface SwingTwistJoint3DData extends JointFrame3D {
    normalHalfConeAngle: number;
    planeHalfConeAngle: number;
    twistMinAngle: number;
    twistMaxAngle: number;
}

/** Translation is in world units; angles are radians. Zero is the creation pose. @experimental */
export interface SixDOFJoint3DData extends JointFrame3D {
    /** X/Y/Z: JointMotion3D.Locked, Limited or Free. */
    translationMotion: Vec3;
    rotationMotion: Vec3;
    translationLower: Vec3;
    translationUpper: Vec3;
    rotationLower: Vec3;
    rotationUpper: Vec3;
    /** Body B's target velocity relative to A, in constraint axes, world units/s. */
    linearVelocity: Vec3;
    maxMotorForce: number;
}

const frame = {
    connectedEntity: -1, anchor: { x: 0, y: 0, z: 0 },
    axis: { x: 1, y: 0, z: 0 }, normalAxis: { x: 0, y: 1, z: 0 },
    enableMotor: false, angularVelocity: { x: 0, y: 0, z: 0 },
    maxMotorTorque: 10, collideConnected: false, enabled: true, breakForce: 0, breakTorque: 0,
};
const fields: Record<string, FieldMeta> = {
    anchor: { tooltip: 'Attachment in this entity’s local frame, in world units.' },
    axis: { category: 'Reference Frame', tooltip: 'Local X/twist direction. Must be nonzero.' },
    normalAxis: { category: 'Reference Frame', tooltip: 'Local Y reference. Must not be parallel to the X/twist axis.' },
    enableMotor: { category: 'Motor' },
    angularVelocity: { category: 'Motor', tooltip: 'Body B relative to A, in constraint axes (rad/s).' },
    maxMotorTorque: { category: 'Motor', min: 0, tooltip: 'Maximum torque per motor axis (N m).' },
    collideConnected: { category: 'Collision' },
    breakForce: { category: 'Breaking', min: 0, tooltip: 'Newtons it gives way at; 0 never.' },
    breakTorque: { category: 'Breaking', min: 0, tooltip: 'Newton metres of twist it gives way at; 0 never.' },
};

/** A limited ball joint with separate twist limits. Angles are radians. @experimental */
export const SwingTwistJoint3D = defineComponent<SwingTwistJoint3DData>('SwingTwistJoint3D', {
    ...frame, axis: { x: 0, y: 1, z: 0 }, normalAxis: { x: 1, y: 0, z: 0 }, normalHalfConeAngle: Math.PI / 4, planeHalfConeAngle: Math.PI / 4,
    twistMinAngle: -Math.PI / 6, twistMaxAngle: Math.PI / 6,
}, { entityFields: ['connectedEntity'], fields: {
    ...fields,
    normalHalfConeAngle: { category: 'Swing Limits', min: 0, max: Math.PI },
    planeHalfConeAngle: { category: 'Swing Limits', min: 0, max: Math.PI },
    twistMinAngle: { category: 'Twist Limits', min: -Math.PI, max: Math.PI },
    twistMaxAngle: { category: 'Twist Limits', min: -Math.PI, max: Math.PI },
} });

/** Six axes independently locked, limited or free; optional velocity motors. @experimental */
export const SixDOFJoint3D = defineComponent<SixDOFJoint3DData>('SixDOFJoint3D', {
    ...frame,
    translationMotion: { x: 0, y: 0, z: 0 }, rotationMotion: { x: 0, y: 0, z: 0 },
    translationLower: { x: -100, y: -100, z: -100 }, translationUpper: { x: 100, y: 100, z: 100 },
    rotationLower: { x: -Math.PI / 6, y: -Math.PI / 6, z: -Math.PI / 6 },
    rotationUpper: { x: Math.PI / 6, y: Math.PI / 6, z: Math.PI / 6 },
    linearVelocity: { x: 0, y: 0, z: 0 }, maxMotorForce: 100,
}, { entityFields: ['connectedEntity'], fields: {
    ...fields,
    translationMotion: { category: 'Translation Limits', tooltip: 'Each axis: 0 locked, 1 limited, 2 free.' },
    translationLower: { category: 'Translation Limits' }, translationUpper: { category: 'Translation Limits' },
    rotationMotion: { category: 'Rotation Limits', tooltip: 'Each axis: 0 locked, 1 limited, 2 free.' },
    rotationLower: { category: 'Rotation Limits' }, rotationUpper: { category: 'Rotation Limits' },
    linearVelocity: { category: 'Motor', tooltip: 'Body B relative to A, in constraint axes (world units/s).' },
    maxMotorForce: { category: 'Motor', min: 0, tooltip: 'Maximum force per translation axis (N).' },
} });

const axes = ['x', 'y', 'z'] as const;
const finiteVec = (v: Vec3) => v && axes.every((a) => Number.isFinite(v[a]));

/** Returns an explanation for invalid settings, or null when they are valid. @experimental */
export function joint3DSettingsError(d: SwingTwistJoint3DData | SixDOFJoint3DData): string | null {
    if (![d.anchor, d.axis, d.normalAxis, d.angularVelocity].every(finiteVec)) return 'Joint vectors must be finite.';
    const x = d.axis, y = d.normalAxis;
    const cross = Math.hypot(x.y * y.z - x.z * y.y, x.z * y.x - x.x * y.z, x.x * y.y - x.y * y.x);
    const nx = Math.hypot(x.x, x.y, x.z), ny = Math.hypot(y.x, y.y, y.z);
    const scale = nx * ny;
    if (nx < 1e-6 || ny < 1e-6 || !Number.isFinite(scale) || cross / scale < 1e-5) return 'Reference directions must be nonzero and not parallel.';
    if (!Number.isFinite(d.maxMotorTorque) || d.maxMotorTorque < 0) return 'Motor torque must be finite and nonnegative.';
    if ('translationMotion' in d) {
        if (![d.translationMotion, d.rotationMotion, d.translationLower, d.translationUpper,
            d.rotationLower, d.rotationUpper, d.linearVelocity].every(finiteVec)) return 'Axis settings must be finite.';
        if (!Number.isFinite(d.maxMotorForce) || d.maxMotorForce < 0) return 'Motor force must be finite and nonnegative.';
        for (const a of axes) {
            for (const rotation of [false, true]) {
                const mode = (rotation ? d.rotationMotion : d.translationMotion)[a];
                if (![0, 1, 2].includes(mode)) return 'Axis motion must be Locked, Limited or Free.';
                if (mode !== 1) continue;
                const lo = (rotation ? d.rotationLower : d.translationLower)[a];
                const hi = (rotation ? d.rotationUpper : d.translationUpper)[a];
                if (lo >= hi) return 'A limited axis needs a lower bound below its upper bound.';
                if (rotation && (lo < -Math.PI || hi > Math.PI)) return 'Rotation limits must lie within −π to π.';
            }
        }
    } else {
        if (![d.normalHalfConeAngle, d.planeHalfConeAngle].every((v) => Number.isFinite(v) && v >= 0 && v <= Math.PI)) {
            return 'Swing half angles must lie within 0 to π.';
        }
        if (!Number.isFinite(d.twistMinAngle) || !Number.isFinite(d.twistMaxAngle)
            || d.twistMinAngle < -Math.PI || d.twistMaxAngle > Math.PI || d.twistMinAngle > d.twistMaxAngle) {
            return 'Twist limits must be ordered within −π to π.';
        }
    }
    return null;
}

/** Constraint frame/settings changes rebuild; changing motors does not reset the reference pose. */
export function advancedJointSettings(d: SwingTwistJoint3DData | SixDOFJoint3DData): string {
    const { enableMotor: _enable, angularVelocity: _angular, maxMotorTorque: _torque, ...rest } = d;
    if ('linearVelocity' in rest) {
        const { linearVelocity: _linear, maxMotorForce: _force, ...settings } = rest;
        return JSON.stringify(settings);
    }
    return JSON.stringify(rest);
}

export function jointMotionBits(motion: Vec3): number {
    return motion.x | (motion.y << 2) | (motion.z << 4);
}
