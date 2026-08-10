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
      + '33, 9, 0 over about thirty frames — and not one pixel changes. Bisected by '
      + 'deleting halves of the scene, it comes down to ONE entity: with Lyra present a '
      + 'burst at her position draws 0 warm pixels, without her 23, and with her present '
      + 'but the emitter moved 300 units away, 41. Particles are drawn beneath a sprite '
      + 'even from a HIGHER sorting layer — which is why only the bright young ones, the '
      + 'ones still inside her silhouette, go missing.',
    workaround:
      'None available: the game does the correct thing and the frame does not show it, '
      + 'so the slice currently ships without hit feedback.',
    fix:
      'Find why a particle draw loses to a sprite on a LOWER layer. By the key it cannot: '
      + 'buildSortKey puts stage and layer above y, depth and blend, so layer 3 must draw '
      + 'after layer 2. So the next step is not the ordering rule but whether that command '
      + 'reaches the GPU at all — dump the particle DrawCommand\'s sort_key and its '
      + 'survival through DrawList, and compare against the sprite it disappears behind. '
      + 'Already excluded by measurement: the emitter data (identical data draws in a '
      + 'probe), burst against continuous, position, layers 2/3/4, blend mode, asset '
      + 'packaging, and — added one at a time to a probe that kept drawing — physics, a '
      + 'tilemap, a Canvas with UI, the same sortingLayers/ySortLayers, and a following '
      + 'camera with a sprite on the y-sorted layer.',
  },
];
