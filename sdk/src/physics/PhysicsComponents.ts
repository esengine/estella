/**
 * @file    PhysicsComponents.ts
 * @brief   Physics component definitions for TypeScript SDK
 */

import type { Vec2 } from '../types';
import { defineBuiltin, defineComponent } from '../component';

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
});

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
});

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
});

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
});

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
});

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

// =============================================================================
// Body Type Enum (matches C++ BodyType)
// =============================================================================

export const BodyType = {
    Static: 0,
    Kinematic: 1,
    Dynamic: 2
} as const;

export type BodyType = (typeof BodyType)[keyof typeof BodyType];
