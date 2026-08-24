// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   ESEngine 3D physics module — standalone Jolt WASM integration.
 *
 * @details The flat world's twin, entry for entry: `esengine/physics` hands a
 * game the plugin, the world resource and the contact events, and until this
 * file existed the solid world handed it none of them. Its components reached
 * the main entry, so a scene could hold a body and a collider — and nothing a
 * system could import could cast a ray at one or hear it land.
 *
 * @example
 * ```typescript
 * import { Physics3DPlugin, Physics3D } from 'esengine/physics3d';
 * app.addPlugin(new Physics3DPlugin('physics3d.js', { gravity: { x: 0, y: -9.81, z: 0 } }));
 *
 * defineSystem([Res(Physics3D)], (queries) => {
 *     const hit = queries?.raycast({ x: 0, y: 100, z: 0 }, { x: 0, y: -200, z: 0 });
 * });
 * ```
 */

export {
    Physics3DPlugin,
    physics3dPlugin,
    Physics3D,
    Physics3DRuntime,
} from './Physics3DPlugin';

export {
    Physics3DQueries,
    type Cast3DHit,
    type Overlap3DHit,
} from './Physics3DQueries';

export {
    Physics3DEvents,
    loadPhysics3DModule,
    assertPhysics3DContract,
    drainPhysics3DEvents,
    PHYSICS3D_TRANSFORM_STRIDE,
    type Physics3DEventsData,
    type Contact3DEvent,
    type Sensor3DEvent,
    type Physics3DWasmModule,
    type Physics3DModuleFactory,
} from './Physics3DModule';

export {
    stepPhysics3D,
    DEFAULT_PHYSICS3D_CONFIG,
    type Physics3DConfig,
} from './Physics3DSystem';

export {
    RigidBody3D,
    BoxCollider3D,
    SphereCollider3D,
    CapsuleCollider3D,
    MeshCollider3D,
    ConvexCollider3D,
    CharacterController3D,
    type RigidBody3DData,
    type BoxCollider3DData,
    type SphereCollider3DData,
    type CapsuleCollider3DData,
    type MeshCollider3DData,
    type ConvexCollider3DData,
    type CharacterController3DData,
} from './Physics3DComponents';

export {
    PointJoint3D,
    HingeJoint3D,
    SliderJoint3D,
    DistanceJoint3D,
    FixedJoint3D,
    readJoint3D,
    type PointJoint3DData,
    type HingeJoint3DData,
    type SliderJoint3DData,
    type DistanceJoint3DData,
    type FixedJoint3DData,
    type Joint3DShape,
} from './Physics3DJoints';

export {
    Physics3DDebugDraw,
    setupPhysics3DDebugDraw,
    drawPhysics3DDebug,
    type Physics3DDebugDrawConfig,
} from './Physics3DDebugDraw';

export {
    readCollider3DShapes,
    collider3DWireframe,
    placeCollider3DWireframe,
    rotateVec3ByQuat,
    COLLIDER3D_RING_SEGMENTS,
    type Collider3DShape,
    type Collider3DInstance,
    type Collider3DComponent,
} from './ColliderShape3D';
