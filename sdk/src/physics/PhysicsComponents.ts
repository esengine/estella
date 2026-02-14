/**
 * @file    PhysicsComponents.ts
 * @brief   Physics component definitions for TypeScript SDK
 */

import type { Vec2 } from '../types';
import { defineBuiltin } from '../component';

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
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
}

export interface CircleColliderData {
    radius: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
}

export interface CapsuleColliderData {
    radius: number;
    halfHeight: number;
    offset: Vec2;
    density: number;
    friction: number;
    restitution: number;
    isSensor: boolean;
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
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false
});

export const CircleCollider = defineBuiltin<CircleColliderData>('CircleCollider', {
    radius: 0.5,
    offset: { x: 0, y: 0 },
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false
});

export const CapsuleCollider = defineBuiltin<CapsuleColliderData>('CapsuleCollider', {
    radius: 0.25,
    halfHeight: 0.5,
    offset: { x: 0, y: 0 },
    density: 1.0,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false
});

// =============================================================================
// Body Type Enum (matches C++ BodyType)
// =============================================================================

export const BodyType = {
    Static: 0,
    Kinematic: 1,
    Dynamic: 2
} as const;

export type BodyType = (typeof BodyType)[keyof typeof BodyType];
