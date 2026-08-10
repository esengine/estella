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
    id: 'particles-simulate-but-do-not-draw',
    hurts:
      'Hits throw no sparks. The emitter is played, the particles exist and they age '
      + 'out on schedule — read back from the running package, getAliveCount goes 64, 60, '
      + '33, 9, 0 over about thirty frames — and not one pixel changes. Three captures '
      + 'taken while they were alive differ by 0 in the box around the player.',
    workaround:
      'None available: the game does the correct thing and the frame does not show it, '
      + 'so the slice currently ships without hit feedback.',
    fix:
      'Root-cause the draw. THE EMITTER IS NOT THE VARIABLE: the identical component '
      + 'data draws 761 warm pixels in a probe project and 0 in this game\'s scene. Built '
      + 'up one feature at a time, a probe still draws with physics, a tilemap, a '
      + 'Canvas + UI, the same sortingLayers and ySortLayers, and a camera with '
      + 'FollowTarget plus a sprite on the y-sorted layer. Also excluded: burst vs '
      + 'continuous emission, the emitter\'s position, layers 2, 3 and 4, the blend mode, '
      + 'and asset packaging (the texture ships; the emitter reads back texture=1, '
      + 'enabled=true). So the cause is elsewhere in this scene or project — go the other '
      + 'way and bisect by DELETING halves of the game scene until a burst appears.',
  },
];
