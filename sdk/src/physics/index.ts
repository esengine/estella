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
    type SensorEvent,
    type RaycastHit,
} from './PhysicsPlugin';

export {
    loadPhysicsModule,
    loadPhysicsSideModule,
    type PhysicsWasmModule,
    type PhysicsModuleFactory,
    type ESEngineMainModule,
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
