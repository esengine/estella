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
/** A bool: the character is sprinting, so a graph can pick a sprint gait apart from a run at the same speed. */
export const TPC_SPRINT = 'sprint';
/** Set the frame a blow broke the character's poise (Health.poise): the flinch that interrupts what it was doing. */
export const TPC_STAGGER = 'stagger';

/**
 * The key a dodge is asked for on; the animator decides whether there is one. With a `sprintSpeed` on the controller it
 * is also the sprint: a tap dodges when it is let go, and held it sprints.
 */
export const DODGE_KEY = 'ShiftLeft';

/** The key an attack is asked for on. Same rule: a request, not a clip name. */
export const ATTACK_KEY = 'KeyJ';

/** The key a ThirdPersonCamera with a `lockRange` locks onto the nearest foe in front with, and lets go with. */
export const LOCK_KEY = 'KeyQ';

/**
 * The events a clip declares that melee reads. Names rather than times: a state
 * that re-times its swing re-times the hit, and nothing else has to be told.
 */
export const COMBAT_ATTACK_START = 'attack-start';
export const COMBAT_HIT = 'hit';
export const COMBAT_ATTACK_END = 'attack-end';
/**
 * The window a clip declares for the frames its swing can land in, its active
 * frames: a custom event with a duration. While it is open the swing sweeps the
 * space its anchor passes through each frame, so a blade moving faster than its
 * own reach per frame still meets what it passed; when it closes, or the clip is
 * left before it does, the swing is over.
 */
export const COMBAT_ATTACK_ACTIVE = 'attack-active';
/**
 * The window a clip declares for where the next attack of a combo may be taken:
 * a transition with `{ param: 'combo', op: 'window' }` chains only inside it.
 */
export const COMBAT_COMBO_WINDOW = 'combo';
/**
 * The window a clip declares for the frames no blow lands on its character, a dodge's invulnerable frames: a custom
 * event with a duration, as `attack-active` is. Re-timing the roll re-times them.
 */
export const COMBAT_INVULNERABLE = 'invulnerable';
