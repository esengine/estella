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
  'single-file', 'startup-size',
  'hot-update', 'rollback',
  'networking',
  'persistence', 'save-versioning',
];

/**
 * Capabilities the corpus does NOT cover yet, each with the reason. Declared so
 * the hole is visible in the gate's output instead of being mistaken for
 * coverage — the same bargain check-project-settings strikes.
 */
export const KNOWN_GAPS = {
  localization: 'no example swaps locale at runtime; rich-text covers glyphs, not translation',
  touch: 'no example drives synthetic touch; input-actions is keyboard + gamepad',
  'safe-area': 'safe-area insets are exercised by the UI mode viewport, not by a project',
  'pause-resume': 'lifecycle suspend/resume is covered by native hosts, not by a golden project',
  rollback: 'hot-update-demo swaps forward; nothing exercises a failed manifest rolling back',
  // Measured: hello-world exports a 2.82MB single file, video-puzzle 3.22MB — so
  // the floor is the runtime, not the game, and no project reaches the 2MB cap.
  'startup-size': 'the playable runtime floor (~2.8MB) exceeds the 2MB default profile cap; see REARCH_EXPORT',
};

/**
 * The corpus. `certifies` is the claim, `targets` the packages that must build
 * AND launch, `tier` the cheapest run that pays for it. Existing examples on
 * purpose — a parallel suite would be a second set of games to keep alive.
 */
export const GOLDEN = [
  {
    id: 'platformer',
    certifies: ['physics', 'input', 'animation'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
  },
  {
    id: 'space-shooter',
    certifies: ['ecs', 'particles', 'audio'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
  },
  {
    id: 'ui-controls',
    certifies: ['ui-layout', 'text'],
    targets: ['web', 'desktop'],
    tier: 'pr',
  },
  {
    id: 'tilemap-demo',
    certifies: ['tilemap', 'tile-collision'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
  },
  {
    id: 'spine-demo',
    certifies: ['spine', 'material', 'asset-lifecycle'],
    targets: ['web', 'desktop', 'android', 'ios'],
    tier: 'nightly',
  },
  {
    id: 'save-load',
    certifies: ['persistence', 'save-versioning'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
  },
  {
    id: 'hot-update-demo',
    certifies: ['hot-update'],
    targets: ['web', 'android'],
    tier: 'nightly',
  },
  {
    id: 'multiplayer-arena',
    certifies: ['networking'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
  },
  {
    id: 'video-puzzle',
    certifies: ['single-file'],
    targets: ['playable', 'web'],
    tier: 'nightly',
  },
  {
    id: 'input-actions',
    certifies: ['input'],
    targets: ['web', 'desktop', 'wechat'],
    tier: 'release',
  },
];

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

/** Absolute path to a golden project's directory. */
export function projectDir(id) {
  return path.join(EXAMPLES, id);
}
