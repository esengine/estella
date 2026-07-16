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

export {
    PhysicsPlugin,
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
    RigidBody,
    BoxCollider,
    CircleCollider,
    CapsuleCollider,
    SegmentCollider,
    PolygonCollider,
    ChainCollider,
    OneWayPlatform,
    RevoluteJoint,
    DistanceJoint,
    PrismaticJoint,
    WeldJoint,
    WheelJoint,
    MotorJoint,
    BodyType,
    type RigidBodyData,
    type BoxColliderData,
    type CircleColliderData,
    type CapsuleColliderData,
    type SegmentColliderData,
    type PolygonColliderData,
    type ChainColliderData,
    type OneWayPlatformData,
    type RevoluteJointData,
    type DistanceJointData,
    type PrismaticJointData,
    type WeldJointData,
    type WheelJointData,
    type MotorJointData,
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
    CharacterController,
    moveAndSlide,
    registerCharacterControllerSystem,
    type CharacterControllerData,
    type MoveAndSlideParams,
    type MoveAndSlideResult,
    type SlideCast,
    type SlideHit,
} from './CharacterController';
