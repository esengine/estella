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
    Physics,
    type PhysicsPluginConfig,
    type PhysicsEventsData,
    type CollisionEnterEvent,
    type SensorEvent,
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
    BodyType,
    type RigidBodyData,
    type BoxColliderData,
    type CircleColliderData,
    type CapsuleColliderData,
} from './PhysicsComponents';
