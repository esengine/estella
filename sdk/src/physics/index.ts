// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   ESEngine Physics module - standalone Box2D WASM integration
 *
 * @example
 * ```typescript
 * import { PhysicsPlugin } from 'esengine/physics';
 * app.addPlugin(new PhysicsPlugin('physics.js', { gravity: { x: 0, y: -9.81 } }));
 * ```
 */

// Contacts as entity events (the channel widgets emit into), so an authored
// EventBinding row can wire a trigger area with no code.
export {
    PhysicsEventType,
    registerPhysicsEventBridge,
    type PhysicsContactEventData,
} from './PhysicsEventBridge';

export {
    PhysicsPlugin,
    physicsPlugin,
    PhysicsEvents,
    PhysicsAPI,
    Physics,
    type PhysicsPluginConfig,
    type PhysicsEventsData,
    type CollisionEnterEvent,
    type CollisionHitEvent,
    type SensorEvent,
    type RaycastHit,
    type ShapeCastHit,
    type MassData,
} from './PhysicsPlugin';

export {
    loadPhysicsModule,
    type PhysicsWasmModule,
    type PhysicsModuleFactory,
} from './PhysicsModuleLoader';

export {
    RigidBody2D,
    BoxCollider2D,
    CircleCollider2D,
    CapsuleCollider2D,
    SegmentCollider2D,
    PolygonCollider2D,
    ChainCollider2D,
    OneWayPlatform2D,
    RevoluteJoint2D,
    DistanceJoint2D,
    PrismaticJoint2D,
    WeldJoint2D,
    WheelJoint2D,
    MotorJoint2D,
    BodyType,
    type RigidBody2DData,
    type BoxCollider2DData,
    type CircleCollider2DData,
    type CapsuleCollider2DData,
    type SegmentCollider2DData,
    type PolygonCollider2DData,
    type ChainCollider2DData,
    type OneWayPlatform2DData,
    type RevoluteJoint2DData,
    type DistanceJoint2DData,
    type PrismaticJoint2DData,
    type WeldJoint2DData,
    type WheelJoint2DData,
    type MotorJoint2DData,
} from './PhysicsComponents';

export {
    PhysicsDebugDraw,
    setupPhysicsDebugDraw,
    drawPhysicsDebug,
    type PhysicsDebugDrawConfig,
} from './PhysicsDebugDraw';

export {
    readColliderShapes,
    shapeOffset,
    shapeCenter,
    colliderShapeOutline,
    CAPSULE_ARC_SEGMENTS,
    type ColliderShape,
    type ColliderInstance,
    type ColliderOutline,
} from './ColliderShape';

export {
    CharacterController2D,
    moveAndSlide,
    registerCharacterControllerSystem,
    type CharacterController2DData,
    type MoveAndSlideParams,
    type MoveAndSlideResult,
    type SlideCast,
    type SlideHit,
} from './CharacterController2D';
