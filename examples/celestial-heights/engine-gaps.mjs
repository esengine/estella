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
 *   issue      tracker link, when there is one
 *   allows     import specifiers this gap permits outside the `esengine` surface
 */

/** @type {Array<{id: string, hurts: string, workaround: string, fix: string, issue?: string, allows?: string[]}>} */
export const GAPS = [
  {
    id: 'ui-visual-written-at-runtime',
    hurts:
      'A UIVisual written by a system renders in the wrong colour; the same component '
      + 'left alone is pixel-exact. Measured on the packaged HUD meter: authored '
      + '(231,90,105) stays exact while nothing writes it, and turns (51,28,43) under a '
      + 'Mut write-back or (44,26,38) under an insert — the bar\'s LENGTH stays correct '
      + 'either way, so it is the composite, not the value. The JS side reads the right '
      + 'colour every frame. A probe project ruled out the node shape, the flex parent, '
      + 'the Text sibling, the parent\'s alpha and the project\'s y-sort setting: standalone '
      + 'and nested UIVisuals are all exact there — and nothing writes them.',
    workaround:
      'Write through world.insert and only when the value actually changed (what the '
      + 'engine\'s own createProgress.setValue does). That keeps the untouched full-health '
      + 'bar exact and leaves only a changed bar dim, rather than every frame of it.',
    fix:
      'Reproduce it in the probe by adding a system that writes a UIVisual — that isolates '
      + 'it from the game — then root-cause it. Both write paths are suspect against UI '
      + 'draw order, which C++ recomputes in uiRenderOrder_update during PostUpdate, the '
      + 'same phase a gameplay system writes in.',
  },
];
