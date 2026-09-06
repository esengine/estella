// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Playthrough.ts
 * @brief   What a game says about its own progress, for automation that must
 *          prove a run can be finished.
 *
 * @details The observation seam a packaged game already had could see the
 *          ENGINE's side of a run — where a character stands, what an animator
 *          plays, whether a swing landed. It could not see the game's: a
 *          checkpoint armed, three cores taken, a gate opened, a victory. So no
 *          level's completion could be confirmed from outside, and a playthrough
 *          driver had to infer one from an entity going missing.
 *
 *          Published, not read. The engine does not reach into a game's
 *          resources and guess which field means "won" — the game states it, in
 *          its own words, and that statement is the contract. Read-only from
 *          outside: this is how a run is OBSERVED, never how it is driven.
 */
import { defineResource } from '../ecs/resource';

/** What a fact may be. Enough for a count, a flag, or a named place. */
export type PlaythroughValue = string | number | boolean;

/**
 * The facts a game publishes about itself, by its own names. Open rather than a
 * fixed set: `cores` and `gate` belong to one game, and an engine that named
 * them would be designing every other game's progression.
 */
export interface PlaythroughData {
    facts: Record<string, PlaythroughValue>;
}

export const Playthrough = defineResource<PlaythroughData>({ facts: {} }, 'Playthrough');
