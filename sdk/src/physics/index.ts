// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
    RevoluteJoint,
    DistanceJoint,
    PrismaticJoint,
    WeldJoint,
    WheelJoint,
    BodyType,
    type RigidBodyData,
    type BoxColliderData,
    type CircleColliderData,
    type CapsuleColliderData,
    type SegmentColliderData,
    type PolygonColliderData,
    type ChainColliderData,
    type RevoluteJointData,
    type DistanceJointData,
    type PrismaticJointData,
    type WeldJointData,
    type WheelJointData,
} from './PhysicsComponents';

export {
    PhysicsDebugDraw,
    setupPhysicsDebugDraw,
    drawPhysicsDebug,
    type PhysicsDebugDrawConfig,
} from './PhysicsDebugDraw';
