// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  components.ts — 2D physics as a scene DECLARES it: components, shapes
 *        and the arithmetic over them. No solver.
 *
 * Its own entry point because a chunk is what a bundler can act on: with the
 * declarations and the solver in one chunk, a core that needs `RigidBody2D`
 * takes Box2D with it into every package. Reading a scene needs this half;
 * simulating it needs `esengine/physics`.
 */
export * from './PhysicsComponents';
export * from './ColliderShape2D';
export * from './polygonHull2D';
export * from './polygonDecompose2D';
export {
    CharacterController2D, moveAndSlide,
    type CharacterController2DData, type SlideHit, type SlideCast,
    type MoveAndSlideParams, type MoveAndSlideResult,
} from './CharacterController2D';
