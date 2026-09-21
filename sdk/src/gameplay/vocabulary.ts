// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  vocabulary.ts — the names authored content uses to reach gameplay.
 *
 * Strings, and its own module because of who reads them: an AnimatorController
 * asset names the parameters, an input map names the keys, and an event binding
 * names the combat events — none of which needs a controller, a health bar or a
 * melee solver. These stay on `esengine`; the runtime behind them is
 * `esengine/gameplay`.
 */

/**
 * Animator parameters a controller writes, and the triggers it sets. Names, not
 * clips — and shared with the hunter, so one graph drives a player and an enemy
 * and neither can drift into a private vocabulary.
 */
export const TPC_SPEED = 'speed';
export const TPC_GROUNDED = 'grounded';
/** Set the frame a jump was ACCEPTED, not the frame one was asked for. */
export const TPC_JUMP = 'jump';
export const TPC_DODGE = 'dodge';
export const TPC_ATTACK = 'attack';

/** The key a dodge is asked for on; the animator decides whether there is one. */
export const DODGE_KEY = 'ShiftLeft';

/** The key an attack is asked for on. Same rule: a request, not a clip name. */
export const ATTACK_KEY = 'KeyJ';

/**
 * The events a clip declares that melee reads. Names rather than times: a state
 * that re-times its swing re-times the hit, and nothing else has to be told.
 */
export const COMBAT_ATTACK_START = 'attack-start';
export const COMBAT_HIT = 'hit';
export const COMBAT_ATTACK_END = 'attack-end';
