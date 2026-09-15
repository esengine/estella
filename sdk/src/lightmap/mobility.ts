// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    mobility.ts
 * @brief   Whether a bake can hold an object still.
 *
 * @details A bake writes light into a PLACE, so an object the simulation moves
 *          wears the light of where it started. Which things move is the physics
 *          components' to say; a second declaration of it would be a second
 *          answer free to disagree. Two collectors read the same rule from here,
 *          each having got the facts from the shape it reads (a document, or a
 *          world).
 */

import { BodyType } from '../wasm/wasm.generated';

/** What an entity's physics components say about whether it stays put. */
export interface BakeMobility {
    /** It carries a CharacterController3D, which exists to walk. */
    characterController?: boolean;
    /** Its RigidBody3D's `bodyType`, when it has one. */
    bodyType?: BodyType;
}

/**
 * True where a bake may light this object and false where a probe volume must.
 *
 * Nothing said is a yes: a scene's walls and floors carry no physics at all.
 */
export function bakeHoldsStill(mobility: BakeMobility): boolean {
    if (mobility.characterController) return false;
    return mobility.bodyType === undefined || mobility.bodyType === BodyType.Static;
}
