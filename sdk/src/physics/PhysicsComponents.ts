// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsComponents.ts
 * @brief   Physics component definitions for TypeScript SDK
 */

import type { Entity, Vec2 } from '../types';
import type { AnyComponentDef, ComponentData } from '../ecs/component';
import { defineBuiltin, defineComponent } from '../ecs/component';
import type { World } from '../ecs/world';

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

export interface RigidBody2DData {
    bodyType: number;
    gravityScale: number;
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
    bullet: boolean;
    enabled: boolean;
}

export interface BoxCollider2DData {
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

export interface CircleCollider2DData {
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

export interface CapsuleCollider2DData {
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

export interface SegmentCollider2DData {
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

export interface PolygonCollider2DData {
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

export interface ChainCollider2DData {
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

export const RigidBody2D = defineBuiltin<RigidBody2DData>('RigidBody2D', {
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

export const BoxCollider2D = defineBuiltin<BoxCollider2DData>('BoxCollider2D', {
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

export const CircleCollider2D = defineBuiltin<CircleCollider2DData>('CircleCollider2D', {
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

export const CapsuleCollider2D = defineBuiltin<CapsuleCollider2DData>('CapsuleCollider2D', {
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

export const SegmentCollider2D = defineBuiltin<SegmentCollider2DData>('SegmentCollider2D', {
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

export const PolygonCollider2D = defineComponent<PolygonCollider2DData>('PolygonCollider2D', {
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

export const ChainCollider2D = defineComponent<ChainCollider2DData>('ChainCollider2D', {
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
// Collider Reads
// =============================================================================

/**
 * The collider's data, or null when the component is absent **or disabled** — a
 * disabled collider is equivalent to an absent one (no Box2D shape, nothing to
 * cast against, no debug outline), and every consumer reads it through here so
 * those answers agree. Data predating the field has no `enabled`, and stays solid.
 */
export function activeCollider<C extends AnyComponentDef>(
    world: World, entity: Entity, collider: C,
): ComponentData<C> | null {
    if (!world.has(entity, collider)) return null;
    const data = world.get(entity, collider);
    return (data as { enabled?: boolean }).enabled === false ? null : data;
}

// =============================================================================
// One-Way (One-Sided) Platform
// =============================================================================

export interface OneWayPlatform2DData {
    // Solid-side normal in world/physics space. Contacts are cancelled unless the
    // other body approaches from this side. Default {0,1} = solid top (land on top,
    // jump up through it).
    normal: Vec2;
    enabled: boolean;
}

// A collider modifier: put it on an entity that also has a RigidBody2D + a collider.
// Consumed by PhysicsSystem, which enables Box2D pre-solve events on the entity's
// shapes and feeds the normal to the one-way pre-solve callback.
export const OneWayPlatform2D = defineComponent<OneWayPlatform2DData>('OneWayPlatform2D', {
    normal: { x: 0, y: 1 },
    enabled: true,
});

// =============================================================================
// Joint Components
// =============================================================================

export interface RevoluteJoint2DData {
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

export const RevoluteJoint2D = defineComponent<RevoluteJoint2DData>('RevoluteJoint2D', {
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

export interface DistanceJoint2DData {
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

export const DistanceJoint2D = defineComponent<DistanceJoint2DData>('DistanceJoint2D', {
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

export interface PrismaticJoint2DData {
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

export const PrismaticJoint2D = defineComponent<PrismaticJoint2DData>('PrismaticJoint2D', {
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

export interface WeldJoint2DData {
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

export const WeldJoint2D = defineComponent<WeldJoint2DData>('WeldJoint2D', {
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

export interface WheelJoint2DData {
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

export const WheelJoint2D = defineComponent<WheelJoint2DData>('WheelJoint2D', {
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

export interface MotorJoint2DData {
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

export const MotorJoint2D = defineComponent<MotorJoint2DData>('MotorJoint2D', {
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
