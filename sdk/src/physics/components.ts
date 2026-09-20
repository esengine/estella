// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  components.ts — 2D physics as a scene DECLARES it: components, shapes
 *        and the arithmetic over them. No solver.
 *
 * Not a build entry: making it one cost 1,794 bytes, because rolldown copies the
 * shared declarations into a second chunk rather than splitting the first. It is
 * the AUTHORITY on where the line falls — check-core-carries-options reads this
 * list to tell a declaration from a solver — and that is worth a file on its own.
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
