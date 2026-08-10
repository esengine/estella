// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  goldenProjects.mjs — the certification corpus, as a registry.
 *
 * Every stage verifier already exists and every one picked its own corpus:
 * editor-checks builds synthetic fixtures, verify-native-boot takes all 42
 * examples, verify-desktop-render takes one. So no single project was ever
 * carried from the editor through a package and back, and the seams between
 * stages are exactly where the shipping bugs live — configuration lost at
 * package time, input never wired to the host, export defaults wrong.
 *
 * A golden entry names a project that must survive the WHOLE chain, what it
 * certifies, and which tier pays for it. The gate over this file
 * (check-golden.mjs) refuses a capability nobody covers unless the gap is
 * declared here in the open.
 */
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'examples');

/** Cheapest tier a project runs at; each tier also runs everything cheaper. */
export const TIERS = ['pr', 'nightly', 'release'];

/** Export targets a golden project can be asked to package + launch for. */
export const TARGETS = ['web', 'playable', 'desktop', 'wechat', 'android', 'ios'];

/**
 * How far a packaged frame may sit from the editor's frame of the same game.
 * Measured: the same game scores ~0.01 and two different games 0.37–0.48, so
 * this sits an order of magnitude below anything that is actually a difference.
 */
export const DEFAULT_PARITY = 0.06;

/**
 * How much the most-changed region must move for input to count as having
 * reached the game. Measured: two undriven runs of one package differ by 0.04
 * and a driven one by 0.38, so this sits between them with room on both sides.
 */
export const DEFAULT_RESPONDS = 0.15;

/**
 * What the suite claims to cover. A capability here with no project behind it
 * is a hole in the release argument, so the gate fails on one that is not in
 * {@link KNOWN_GAPS}.
 */
export const CAPABILITIES = [
  'physics', 'input', 'animation',
  'ecs', 'particles', 'audio',
  'ui-layout', 'text', 'localization',
  'spine', 'material', 'asset-lifecycle',
  'tilemap', 'tile-collision',
  'touch', 'safe-area', 'pause-resume',
  'texture-atlas',
  'single-file', 'startup-size',
  'hot-update', 'rollback',
  'networking',
  'persistence', 'save-versioning',
  // What a game needs and no sample carried end to end. Each holds a gap below
  // until the phase covering it lands, so the gate prints how much of a game the
  // corpus still cannot certify. See docs/REARCH_CELESTIAL_HEIGHTS.md.
  'navigation', 'behavior-tree', 'scene-transition', 'y-sort',
  'settings', 'controller', 'achievements', 'ui-inventory',
];

/**
 * Capabilities the corpus does NOT cover yet, each with the reason. Declared so
 * the hole is visible in the gate's output instead of being mistaken for
 * coverage — the same bargain check-project-settings strikes.
 */
export const KNOWN_GAPS = {
  // Present in the engine and shown by non-golden samples, but never carried
  // through the chain by a project the release argues from.
  settings: 'Celestial Heights persists language, effects and key bindings and reads them back at boot; volume waits on the game having sound',
  // Measured: hello-world exports a 2.82MB single file, video-puzzle 3.22MB — so
  // the floor is the runtime, not the game, and no project reaches the 2MB cap.
  'startup-size': 'the playable runtime floor (~2.8MB) exceeds the 2MB default profile cap; see REARCH_EXPORT',
};

/**
 * The corpus. `certifies` is the claim, `targets` the packages that must build
 * AND launch, `tier` the cheapest run that pays for it. Existing examples on
 * purpose — a parallel suite would be a second set of games to keep alive.
 *
 * `parity` overrides {@link DEFAULT_PARITY} for a game whose opening seconds
 * move too much to compare that tightly; `parityGap` opts out with a reason.
 * `interact` is the input a package must visibly answer; `interactGap` opts out.
 * A pointer target is a FRACTION of the surface and therefore tied to the layout
 * it was aimed at: when one moves, the check fails loudly and names both frames.
 */
export const GOLDEN = [
  {
    id: 'platformer',
    certifies: ['physics', 'input', 'animation'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
    interact: { keys: ['ArrowRight'], frames: 40 },
  },
  {
    id: 'space-shooter',
    certifies: ['ecs', 'particles', 'audio', 'texture-atlas'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
    interact: { keys: ['ArrowLeft'], frames: 40 },
    // Its small sprites live in a `<name>.atlas/` folder, so the cook packs them
    // into one page and the package samples frames the editor never sees. The
    // count is the claim: packing that quietly stops still passes parity.
    atlas: { packed: 7 },
  },
  {
    id: 'ui-controls',
    certifies: ['ui-layout', 'text'],
    targets: ['web', 'desktop'],
    tier: 'pr',
    // Opens the modal — a whole-panel change, so the response is unmistakable.
    interact: { pointer: { x: 0.625, y: 0.675 }, frames: 40 },
  },
  {
    id: 'tilemap-demo',
    certifies: ['tilemap', 'tile-collision'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
    // Measured: the scene's own patrolling enemy moves as much as the player
    // does (drift 0.041 against a driven 0.100), so a pixel A/B cannot say the
    // key caused it. The keyboard is covered by platformer and input-actions.
    interactGap: 'an autonomous enemy moves as much as the input does; the A/B cannot attribute it',
  },
  {
    id: 'spine-demo',
    certifies: ['spine', 'material', 'asset-lifecycle'],
    targets: ['web', 'desktop', 'android', 'ios'],
    tier: 'nightly',
    interactGap: 'a showcase that cycles its own animations; nothing to press',
  },
  {
    id: 'save-load',
    certifies: ['persistence', 'save-versioning'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    interactGap: 'pointer-driven; no stable slot target pinned yet',
  },
  {
    id: 'hot-update-demo',
    certifies: ['hot-update', 'rollback'],
    targets: ['web', 'android'],
    tier: 'nightly',
    interactGap: 'swaps an asset on a timer; no input path',
    // Packaging cannot see either claim: one needs a second build served as a
    // CDN, the other a manifest that lies about its bytes. check-golden refuses
    // a runBy that no release criterion schedules.
    runBy: 'pnpm --filter @estella/editor run verify:render:hotupdate',
  },
  {
    id: 'multiplayer-arena',
    certifies: ['networking'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    interactGap: 'needs a listen server up before input means anything',
  },
  {
    id: 'video-puzzle',
    certifies: ['single-file'],
    targets: ['playable', 'web'],
    tier: 'nightly',
    // Measured: this package scores 0.0763 against ITSELF — it shuffles the tiles
    // per run and the video is at a different timestamp each time. Nothing the
    // comparison says about it would be about the packaging.
    parityGap: 'shuffles per run and plays video; two runs of one build do not match either',
    interactGap: 'pointer-driven; no stable tile target pinned yet',
  },
  {
    id: 'celestial-heights',
    certifies: [
      'tilemap', 'tile-collision', 'navigation', 'behavior-tree',
      'scene-transition', 'y-sort', 'localization', 'ui-layout', 'text',
      'persistence', 'ui-inventory', 'achievements', 'touch', 'controller',
      'pause-resume', 'safe-area',
    ],
    targets: ['web', 'desktop'],
    // Nightly, not pr: a project earns the release gate by having run, and this
    // one has not run anywhere yet. It is also the biggest thing in the corpus.
    tier: 'nightly',
    // The thumb drags the on-screen stick a touch device gets. Stricter than
    // the default because this game moves on its own: a thumb on the stick
    // measures 0.65, a thumb on empty background 0.40.
    interact: {
      keys: ['KeyD'],
      frames: 60,
      responds: 0.55,
      touches: [{ from: 4, to: 58, x: 0.13, y: 0.78, toX: 0.30, toY: 0.78 }],
      // Left stick east. The map binds it beside WASD, and nothing but a run
      // that holds a pad proves the binding is more than a line of code.
      pad: [{ from: 2, to: 58, axes: { 0: 1 } }],
    },
    // Backgrounded, the world stops; brought back, it carries on. Read as where
    // Lyra got to, because a frame comparison saturates the moment her sprite
    // stops overlapping itself and cannot tell 30 frames from 60.
    suspend: { entity: 'Lyra_Player', keys: ['KeyD'], frames: 80, hideFrom: 20, hideTo: 50, moves: 60 },
    // The HUD has to come out from UNDER a notch, on the axis it came from. The
    // two edges carry different insets on purpose, so the run also says the move
    // scales with the inset instead of being one hardcoded nudge.
    safeArea: { entity: 'HUD', reference: 'Canvas', top: 44, left: 88, moves: 40 },
  },
  {
    id: 'input-actions',
    certifies: ['input'],
    targets: ['web', 'desktop', 'wechat'],
    tier: 'release',
    interact: { keys: ['KeyD'], frames: 40 },
  },
];

/**
 * Projects as they were RELEASED — what a golden project cannot ask, since every
 * example is re-saved by whoever last touched it. Git history rather than
 * fixtures: an invented "old project" is only old in imitated ways. The risk is
 * component data; the envelope has not changed since v0.20.0.
 */
export const LEGACY = [
  { tag: 'v0.20.0', id: 'platformer', tier: 'pr' },
  { tag: 'v0.30.0', id: 'platformer', tier: 'nightly' },
  { tag: 'v0.30.0', id: 'ui-controls', tier: 'nightly' },
  { tag: 'v0.40.0', id: 'tilemap-demo', tier: 'nightly' },
  { tag: 'v0.46.0', id: 'space-shooter', tier: 'release' },
];

/** Released projects a tier must still be able to open. */
export function legacyAtTier(tier) {
  const want = TIERS.indexOf(tier);
  if (want < 0) throw new Error(`unknown tier "${tier}" (have: ${TIERS.join(', ')})`);
  return LEGACY.filter((l) => TIERS.indexOf(l.tier) <= want);
}

const rank = (tier) => TIERS.indexOf(tier);

/** Golden projects that run at `tier` — cheaper tiers included (they are cumulative). */
export function atTier(tier) {
  const want = rank(tier);
  if (want < 0) throw new Error(`unknown tier "${tier}" (have: ${TIERS.join(', ')})`);
  return GOLDEN.filter((g) => rank(g.tier) <= want);
}

/** Every (project, target) pair a tier must package and launch. */
export function matrixAtTier(tier) {
  return atTier(tier).flatMap((g) => g.targets.map((target) => ({ id: g.id, target })));
}

/** Capabilities claimed by no project and not declared as a gap. */
export function uncoveredCapabilities() {
  const covered = new Set(GOLDEN.flatMap((g) => g.certifies));
  return CAPABILITIES.filter((c) => !covered.has(c) && !(c in KNOWN_GAPS));
}

/** Examples that exist on disk but are not part of the certification corpus. */
export function nonGoldenExamples() {
  if (!existsSync(EXAMPLES)) return [];
  const golden = new Set(GOLDEN.map((g) => g.id));
  return readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(EXAMPLES, e.name, 'project.esproject')))
    .map((e) => e.name)
    .filter((n) => !golden.has(n))
    .sort();
}

/** The parity tolerance in force for a project, or null when it opted out. */
export function parityFor(g) {
  if (g.parityGap) return null;
  return typeof g.parity === 'number' ? g.parity : DEFAULT_PARITY;
}

/** The input a project's package must answer, or null when it opted out. */
export function interactFor(g) {
  if (g.interactGap || !g.interact) return null;
  return {
    keys: g.interact.keys ?? [],
    pointer: g.interact.pointer ?? null,
    touches: g.interact.touches ?? null,
    pad: g.interact.pad ?? null,
    frames: g.interact.frames ?? 40,
    responds: g.interact.responds ?? DEFAULT_RESPONDS,
  };
}

/**
 * What a project asks of a run that goes to the background and comes back, or
 * null when it makes no claim. `entity` is read three times — never hidden,
 * hidden and left there, hidden and brought back — and how far it got has to
 * order itself the same way.
 */
export function suspendFor(g) {
  if (!g.suspend) return null;
  return {
    entity: g.suspend.entity,
    keys: g.suspend.keys ?? [],
    frames: g.suspend.frames ?? 80,
    hideFrom: g.suspend.hideFrom ?? 20,
    hideTo: g.suspend.hideTo ?? 50,
    moves: g.suspend.moves ?? 60,
  };
}

/**
 * What a project asks of a screen with a notch, or null when it claims nothing.
 * `entity` is a node anchored top-left, read against a `reference` that rides the
 * camera so the game's own drift cancels. `moves`: measured 88 world units on a
 * 540-tall surface, 103 on a 461-tall one — 40 is under both, over an ignored 0.
 */
export function safeAreaFor(g) {
  if (!g.safeArea) return null;
  return {
    entity: g.safeArea.entity,
    reference: g.safeArea.reference,
    top: g.safeArea.top,
    left: g.safeArea.left,
    moves: g.safeArea.moves ?? 40,
  };
}

/**
 * What a project asks of the texture cook, or null when it claims nothing.
 * `packed` is how many of its textures must come out of the cook inside an atlas
 * page — a count, because packing that silently stops still draws the same frame
 * and therefore still passes parity.
 */
export function atlasFor(g) {
  if (!g.atlas) return null;
  return { packed: g.atlas.packed };
}

/** Absolute path to a golden project's directory. */
export function projectDir(id) {
  return path.join(EXAMPLES, id);
}
