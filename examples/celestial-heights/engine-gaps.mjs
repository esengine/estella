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
    repro:
      'Five entities, no game: a camera, a tilemap, an 84x150 Sprite on sorting layer 2 '
      + 'at the origin, and a looping ParticleEmitter on layer 3 at the same point. '
      + 'Warm particle pixels: 243 with the sprite moved to layer 0 (where the tilemap '
      + 'hides it, so nothing is in the way), 45 with it on layer 2, and 13 with layer 2 '
      + 'also listed in ySortLayers. A draw on layer 3 is losing to one on layer 2, and '
      + 'y-sorting the lower layer makes it lose harder.',
    fix:
      'The sorting DESIGN is not the fault, and that is now checked rather than assumed: '
      + 'buildSortKey and buildSortKeyYSorted share their top two fields — layer at 63:48, '
      + 'stage at 47:44 — precisely so a y-sorted layer and a plain one order against each '
      + 'other, and the header says so. Layer 3 therefore cannot legally sort under layer '
      + '2. So the fault is downstream of the sort: a particle draw is the one instanced '
      + 'command in the list (layoutId ParticleInstance, instanceCount > 0, and '
      + 'canMergeWith refuses to coalesce it), so look at submission and stream handling '
      + 'for instanced draws. Instrument DrawList: dump each command\'s sort_key, layout '
      + 'and instance count in submission order, and see where the particle one goes. '
      + 'Already excluded by measurement: the emitter data (identical data draws in a '
      + 'probe), burst against continuous, position, layers 2/3/4, blend mode, asset '
      + 'packaging, and — added one at a time to a probe that kept drawing — physics, a '
      + 'tilemap, a Canvas with UI, the same sortingLayers/ySortLayers, and a following '
      + 'camera with a sprite on the y-sorted layer.',
  },
];
