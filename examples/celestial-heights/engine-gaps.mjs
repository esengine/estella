// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  engine-gaps.mjs — every place this game had to work around the engine.
 *
 * The point of Celestial Heights is to be a real game built on Estella, so that
 * where Estella is painful, the pain shows up as a fix to Estella rather than a
 * clever file in a game. A rule that says only that decays: the workaround is
 * written under a deadline and nobody ever comes back.
 *
 * So the rule is a ledger instead. Working around the engine is ALLOWED, and
 * costs one entry here plus an `// ENGINE-GAP(<id>): …` marker at the site. What
 * it does not cost is silence — check-engine-gaps.mjs holds the two together in
 * both directions, so a workaround cannot be added without saying so, and an
 * entry cannot outlive the code it excuses.
 *
 * `fix` is the load-bearing field: it names what the ENGINE should do instead.
 * An entry that cannot name one is not a gap in the engine, it is a decision
 * about the game, and it does not belong here.
 *
 * The release gate reads this file with --empty. A non-empty ledger does not
 * ship: every entry is either fixed in the engine or argued away before 0.49.
 *
 * Entry shape:
 *   id         kebab-case, matches the marker at the site
 *   hurts      what the game was trying to do, and where it hurt
 *   workaround what the game does instead, for now
 *   fix        what the engine should do so the workaround can be deleted
 *   repro      the smallest thing that shows it, when one has been found
 *   issue      tracker link, when there is one
 *   allows     import specifiers this gap permits outside the `esengine` surface
 */

/** @type {Array<{id: string, hurts: string, workaround: string, fix: string, repro?: string, issue?: string, allows?: string[]}>} */
export const GAPS = [];
