/**
 * @file    PhysicsTypes.ts
 * @brief   Shared data shapes for the physics plugin
 *
 * Plain-data types consumed by `PhysicsPlugin`, `Physics`, and `PhysicsSystem`.
 * Kept dependency-free so all three files can import without cycles.
 */

import type { Entity, Vec2 } from '../types';
import { defineResource } from '../resource';

// =============================================================================
// Plugin configuration
// =============================================================================

export interface PhysicsPluginConfig {
    gravity?: Vec2;
    fixedTimestep?: number;
    subStepCount?: number;
    contactHertz?: number;
    contactDampingRatio?: number;
    contactSpeed?: number;
    collisionLayerMasks?: number[];
}

/** Fully-populated plugin config after defaults are applied. */
export type ResolvedPhysicsConfig =
    Required<Omit<PhysicsPluginConfig, 'collisionLayerMasks'>>
    & Pick<PhysicsPluginConfig, 'collisionLayerMasks'>;

// =============================================================================
// Collision events
// =============================================================================

export interface CollisionEnterEvent {
    entityA: Entity;
    entityB: Entity;
    normalX: number;
    normalY: number;
    contactX: number;
    contactY: number;
}

export interface SensorEvent {
    sensorEntity: Entity;
    visitorEntity: Entity;
}

export interface PhysicsEventsData {
    collisionEnters: CollisionEnterEvent[];
    collisionExits: Array<{ entityA: Entity; entityB: Entity }>;
    sensorEnters: SensorEvent[];
    sensorExits: SensorEvent[];
}

export const PhysicsEvents = defineResource<PhysicsEventsData>({
    collisionEnters: [],
    collisionExits: [],
    sensorEnters: [],
    sensorExits: []
}, 'PhysicsEvents');

// =============================================================================
// Query result shapes
// =============================================================================

export interface RaycastHit {
    entity: Entity;
    point: Vec2;
    normal: Vec2;
    fraction: number;
}

export type ShapeCastHit = RaycastHit;

export interface MassData {
    mass: number;
    inertia: number;
    centerOfMass: Vec2;
}

// =============================================================================
// WASM buffer strides
// =============================================================================

export const COLLISION_EVENT_STRIDE = 6;
export const CAST_HIT_STRIDE = 6;

// =============================================================================
// Quaternion <-> angle helpers (2D physics lives in XY, rotation on Z)
// =============================================================================

export function quatToAngleZ(q: { w: number; x: number; y: number; z: number }): number {
    return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export function angleZToQuat(angle: number): { w: number; x: number; y: number; z: number } {
    const half = angle * 0.5;
    return { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) };
}
