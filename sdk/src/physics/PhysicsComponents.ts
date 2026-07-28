// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsComponents.ts
 * @brief   Physics component definitions for TypeScript SDK
 */

import type { Vec2 } from '../types';
import { defineBuiltin, defineComponent } from '../ecs/component';

// Box2D collision filtering: a body's own layers (category) and the layers it
// collides with (mask), as named bitmasks. Bit labels come from the project's
// collision-layer settings (the `collisionLayers` source) — see the editor.
const COLLISION_FILTER_META = {
    categoryBits: { bitmask: { bits: 16, source: 'collisionLayers' }, advanced: true },
    maskBits: { bitmask: { bits: 16, source: 'collisionLayers' }, advanced: true },
} as const;

// =============================================================================
// Component Data Interfaces
// =============================================================================

export interface RigidBodyData {
    bodyType: number;
    gravityScale: number;
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
    bullet: boolean;
    enabled: boolean;
}

export interface BoxColliderData {
    halfExtents: Vec2;
    offset: Vec2;
    radius: number;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}

export interface CircleColliderData {
    radius: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}

export interface CapsuleColliderData {
    radius: number;
    halfHeight: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}

export interface SegmentColliderData {
    point1: Vec2;
    point2: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}

export interface PolygonColliderData {
    vertices: Vec2[];
    radius: number;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
    enabled: boolean;
    categoryBits: number;
    maskBits: number;
}

export interface ChainColliderData {
    points: Vec2[];
    isLoop: boolean;
    friction: number;
    restitution: number;
    categoryBits: number;
    maskBits: number;
    enabled: boolean;
}

// =============================================================================
// Body Type Enum
// =============================================================================

// Single-sourced from the C++ BodyType ES_ENUM via the generated module — the
// hand-restated `as const` copy this replaced could drift from C++.
export { BodyType } from '../wasm/wasm.generated';

// =============================================================================
// Builtin Component Instances
// =============================================================================

export const RigidBody = defineBuiltin<RigidBodyData>('RigidBody', {
    bodyType: 2,
    gravityScale: 1.0,
    linearDamping: 0.0,
    angularDamping: 0.0,
    fixedRotation: false,
    bullet: false,
    enabled: true
}, {
    fields: {
        // bodyType's dropdown is generated from the C++ BodyType enum.
        linearDamping: { min: 0, advanced: true },
        angularDamping: { min: 0, advanced: true },
        fixedRotation: { advanced: true },
        bullet: { advanced: true },
    },
});

export const BoxCollider = defineBuiltin<BoxColliderData>('BoxCollider', {
    halfExtents: { x: 0.5, y: 0.5 },
    offset: { x: 0, y: 0 },
    radius: 0.05,
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
}, { fields: { ...COLLISION_FILTER_META } });

export const CircleCollider = defineBuiltin<CircleColliderData>('CircleCollider', {
    radius: 0.5,
    offset: { x: 0, y: 0 },
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
}, { fields: { ...COLLISION_FILTER_META } });

export const CapsuleCollider = defineBuiltin<CapsuleColliderData>('CapsuleCollider', {
    radius: 0.25,
    halfHeight: 0.5,
    offset: { x: 0, y: 0 },
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
}, { fields: { ...COLLISION_FILTER_META } });

export const SegmentCollider = defineBuiltin<SegmentColliderData>('SegmentCollider', {
    point1: { x: -0.5, y: 0 },
    point2: { x: 0.5, y: 0 },
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
}, { fields: { ...COLLISION_FILTER_META } });

export const PolygonCollider = defineComponent<PolygonColliderData>('PolygonCollider', {
    vertices: [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.5 },
        { x: -0.5, y: 0.5 },
    ],
    radius: 0.0,
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
}, { fields: { ...COLLISION_FILTER_META } });

export const ChainCollider = defineComponent<ChainColliderData>('ChainCollider', {
    points: [
        { x: -1, y: 0 },
        { x: 0, y: 0.5 },
        { x: 1, y: 0 },
        { x: 0, y: -0.5 },
    ],
    isLoop: true,
    friction: 0.6,
    restitution: 0.0,
    categoryBits: 0x0001,
    maskBits: 0xFFFF,
    enabled: true,
}, { fields: { ...COLLISION_FILTER_META } });

// =============================================================================
// One-Way (One-Sided) Platform
// =============================================================================

export interface OneWayPlatformData {
    // Solid-side normal in world/physics space. Contacts are cancelled unless the
    // other body approaches from this side. Default {0,1} = solid top (land on top,
    // jump up through it).
    normal: Vec2;
    enabled: boolean;
}

// A collider modifier: put it on an entity that also has a RigidBody + a collider.
// Consumed by PhysicsSystem, which enables Box2D pre-solve events on the entity's
// shapes and feeds the normal to the one-way pre-solve callback.
export const OneWayPlatform = defineComponent<OneWayPlatformData>('OneWayPlatform', {
    normal: { x: 0, y: 1 },
    enabled: true,
});

// =============================================================================
// Joint Components
// =============================================================================

export interface RevoluteJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    enableMotor: boolean;
    motorSpeed: number;
    maxMotorTorque: number;
    enableLimit: boolean;
    lowerAngle: number;
    upperAngle: number;
    collideConnected: boolean;
    enabled: boolean;
}

export const RevoluteJoint = defineComponent<RevoluteJointData>('RevoluteJoint', {
    connectedEntity: -1,
    anchorA: { x: 0, y: 0 },
    anchorB: { x: 0, y: 0 },
    enableMotor: false,
    motorSpeed: 0,
    maxMotorTorque: 0,
    enableLimit: false,
    lowerAngle: 0,
    upperAngle: 0,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface DistanceJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    length: number;
    enableSpring: boolean;
    hertz: number;
    dampingRatio: number;
    enableLimit: boolean;
    minLength: number;
    maxLength: number;
    enableMotor: boolean;
    maxMotorForce: number;
    motorSpeed: number;
    collideConnected: boolean;
    enabled: boolean;
}

export const DistanceJoint = defineComponent<DistanceJointData>('DistanceJoint', {
    connectedEntity: -1,
    anchorA: { x: 0, y: 0 },
    anchorB: { x: 0, y: 0 },
    length: 1,
    enableSpring: false,
    hertz: 1,
    dampingRatio: 0.5,
    enableLimit: false,
    minLength: 0.5,
    maxLength: 2,
    enableMotor: false,
    maxMotorForce: 0,
    motorSpeed: 0,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface PrismaticJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    axis: Vec2;
    enableSpring: boolean;
    hertz: number;
    dampingRatio: number;
    enableLimit: boolean;
    lowerTranslation: number;
    upperTranslation: number;
    enableMotor: boolean;
    maxMotorForce: number;
    motorSpeed: number;
    collideConnected: boolean;
    enabled: boolean;
}

export const PrismaticJoint = defineComponent<PrismaticJointData>('PrismaticJoint', {
    connectedEntity: -1,
    anchorA: { x: 0, y: 0 },
    anchorB: { x: 0, y: 0 },
    axis: { x: 1, y: 0 },
    enableSpring: false,
    hertz: 1,
    dampingRatio: 0.5,
    enableLimit: false,
    lowerTranslation: 0,
    upperTranslation: 0,
    enableMotor: false,
    maxMotorForce: 0,
    motorSpeed: 0,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface WeldJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    linearHertz: number;
    angularHertz: number;
    linearDampingRatio: number;
    angularDampingRatio: number;
    collideConnected: boolean;
    enabled: boolean;
}

export const WeldJoint = defineComponent<WeldJointData>('WeldJoint', {
    connectedEntity: -1,
    anchorA: { x: 0, y: 0 },
    anchorB: { x: 0, y: 0 },
    linearHertz: 0,
    angularHertz: 0,
    linearDampingRatio: 1,
    angularDampingRatio: 1,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface WheelJointData {
    connectedEntity: number;
    anchorA: Vec2;
    anchorB: Vec2;
    axis: Vec2;
    enableSpring: boolean;
    hertz: number;
    dampingRatio: number;
    enableLimit: boolean;
    lowerTranslation: number;
    upperTranslation: number;
    enableMotor: boolean;
    maxMotorTorque: number;
    motorSpeed: number;
    collideConnected: boolean;
    enabled: boolean;
}

export const WheelJoint = defineComponent<WheelJointData>('WheelJoint', {
    connectedEntity: -1,
    anchorA: { x: 0, y: 0 },
    anchorB: { x: 0, y: 0 },
    axis: { x: 0, y: 1 },
    enableSpring: true,
    hertz: 5,
    dampingRatio: 0.7,
    enableLimit: false,
    lowerTranslation: 0,
    upperTranslation: 0,
    enableMotor: false,
    maxMotorTorque: 0,
    motorSpeed: 0,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });

export interface MotorJointData {
    connectedEntity: number;
    // Target relative linear velocity (world units/s) and the max force to reach it.
    linearVelocity: Vec2;
    maxVelocityForce: number;
    // Target relative angular velocity (rad/s) and the max torque to reach it.
    angularVelocity: number;
    maxVelocityTorque: number;
    // Optional spring position control (0 hertz = velocity-only motor).
    linearHertz: number;
    linearDampingRatio: number;
    maxSpringForce: number;
    angularHertz: number;
    angularDampingRatio: number;
    maxSpringTorque: number;
    collideConnected: boolean;
    enabled: boolean;
}

export const MotorJoint = defineComponent<MotorJointData>('MotorJoint', {
    connectedEntity: -1,
    linearVelocity: { x: 0, y: 0 },
    maxVelocityForce: 0,
    angularVelocity: 0,
    maxVelocityTorque: 0,
    linearHertz: 0,
    linearDampingRatio: 0,
    maxSpringForce: 0,
    angularHertz: 0,
    angularDampingRatio: 0,
    maxSpringTorque: 0,
    collideConnected: false,
    enabled: true,
}, { entityFields: ['connectedEntity'] });
