// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorRootMotion.ts
 * @brief   How far the animation asks the character to move — a request, never a
 *          result.
 *
 * @details A clip that animates the entity it is played ON is not posing a
 *          skeleton; it is saying where the character travels. Writing that to
 *          the Transform would put the animator in charge of movement, and an
 *          animator in charge of movement walks through walls: the world's
 *          answer is the character controller's to give.
 *
 *          So the animator states the request here and touches nothing. Gameplay
 *          reads it, hands it to whatever moves the character, and the character
 *          ends up wherever collision allowed — which is what the pattern beside
 *          it already does with the stick.
 *
 *          The deltas come with the SECONDS they cover because the animator runs
 *          on the frame clock and a character controller usually steps on a fixed
 *          one. A consumer forms a rate from the pair; a consumer that just added
 *          the delta would move twice on a frame with two steps and not at all on
 *          a frame with none.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import type { Quat, Vec3 } from '../types';

/** The fields of the `AnimatorRootMotion` component. @experimental */
export interface AnimatorRootMotionData {
    /** Whether the animator publishes this entity's root motion at all. */
    enabled: boolean;
    /**
     * Engine-written: whether a state that DECLARES root motion is driving this
     * frame. The switch a consumer reads — not "is the delta non-zero", which is
     * also true of the still moment in the middle of a dodge.
     */
    active: boolean;
    /** Engine-written: the displacement asked for, in world space. */
    deltaPosition: Vec3;
    /** Engine-written: the turn asked for, in the character's own frame. */
    deltaRotation: Quat;
    /** Engine-written: seconds the deltas cover; 0 when nothing was asked. */
    deltaTime: number;
}

/**
 * Publishes what the active animation asks to move, for gameplay to hand to a
 * character controller. Add it to a character whose animations drive movement;
 * without it, a root-motion state still refuses to pose the character's own
 * Transform — it simply plays on the spot.
 *
 * @experimental
 */
export const AnimatorRootMotion: ComponentDef<AnimatorRootMotionData> =
    defineComponent<AnimatorRootMotionData>('AnimatorRootMotion', {
        enabled: true,
        active: false,
        deltaPosition: { x: 0, y: 0, z: 0 },
        deltaRotation: { w: 1, x: 0, y: 0, z: 0 },
        deltaTime: 0,
    }, {
        readonlyFields: ['active', 'deltaPosition', 'deltaRotation', 'deltaTime'],
        fields: {
            active: { advanced: true },
            deltaPosition: { advanced: true },
            deltaRotation: { advanced: true },
            deltaTime: { advanced: true, unit: 's' },
        },
    });
