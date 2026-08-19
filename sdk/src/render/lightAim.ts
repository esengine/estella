// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lightAim.ts
 * @brief   A light aims along its entity's forward.
 * @details Where a light points is its Transform's rotation, the same fact a
 *          camera's orientation is — so a light turns with its parent, a rotate
 *          gizmo aims it, and an animation track can swing it. Naming a direction
 *          instead is a way IN, and this is the one place on this side of the
 *          boundary that says which direction "no rotation" means; the engine's is
 *          `lightForward` in RenderFrame.cpp.
 */

import { q } from '../math/quat';
import type { Quat, Vec3 } from '../types';

/** The direction an unrotated light aims: into the screen, where a 2D scene's
 *  light has always come from. */
export const LIGHT_FORWARD: Readonly<Vec3> = { x: 0, y: 0, z: -1 };

/**
 * The rotation that aims a light along `aim` (any length; zero gives no turn).
 * Roll about the aim is left at none — a cone and parallel rays have nothing to
 * say about it.
 *
 * @experimental
 */
export function lightAimRotation(aim: Vec3): Quat {
    return q.rotationTo(LIGHT_FORWARD, aim);
}

/**
 * Where a light with this rotation aims — the unit vector the engine lights along.
 *
 * @experimental
 */
export function lightAimOf(rotation: Quat): Vec3 {
    return q.rotate(rotation, LIGHT_FORWARD);
}
