// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   ESEngine Physics module - standalone Box2D WASM integration
 *
 * @example
 * ```typescript
 * import { Physics2DPlugin } from 'esengine/physics';
 * app.addPlugin(new Physics2DPlugin('physics.js', { gravity: { x: 0, y: -9.81 } }));
 * ```
 */

// Contacts as entity events (the channel widgets emit into), so an authored
// EventBinding row can wire a trigger area with no code.
export {
    Physics2DEventType,
    registerPhysics2DEventBridge,
    type Physics2DContactEventData,
} from './PhysicsEventBridge';

export {
    Physics2DPlugin,
    physics2dPlugin,
    Physics2DEvents,
    Physics2DAPI,
    Physics2D,
    type Physics2DPluginConfig,
    type Physics2DEventsData,
    type CollisionEnterEvent,
    type CollisionHitEvent,
    type SensorEvent,
    type RaycastHit,
    type ShapeCastHit,
    type MassData,
} from './Physics2DPlugin';

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
    HingeJoint2D,
    DistanceJoint2D,
    SliderJoint2D,
    FixedJoint2D,
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
    type HingeJoint2DData,
    type DistanceJoint2DData,
    type SliderJoint2DData,
    type FixedJoint2DData,
    type WheelJoint2DData,
    type MotorJoint2DData,
} from './PhysicsComponents';

export {
    Physics2DDebugDraw,
    setupPhysics2DDebugDraw,
    drawPhysics2DDebug,
    type Physics2DDebugDrawConfig,
} from './Physics2DDebugDraw';

export {
    readCollider2DShapes,
    shapeOffset,
    shapeCenter,
    collider2DOutline,
    CAPSULE_ARC_SEGMENTS,
    type Collider2DShape,
    type Collider2DInstance,
    type Collider2DOutline,
} from './ColliderShape2D';

export {
    CharacterController2D,
    moveAndSlide,
    registerCharacterController2DSystem,
    type CharacterController2DData,
    type MoveAndSlideParams,
    type MoveAndSlideResult,
    type SlideCast,
    type SlideHit,
} from './CharacterController2D';
