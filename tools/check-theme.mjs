#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether the editor's text is readable on the surfaces it sits on.
 *
 * Every invariant in this repository has a gate except the visual layer, which
 * is why the visual layer is the one that drifted: `--text-faint` shipped at
 * 3.26:1 on a panel — under the 4.5:1 floor for body text — as the colour of
 * most labels in the editor, and nothing said so for as long as it took a person
 * to compute it by hand.
 *
 * Scope is deliberately one claim: the text ramp against the surface ramp, read
 * from the token file. Not the 963 off-grid spacings or the 74 hard-coded hexes
 * — those are real and counted in docs/local/, but a gate that reddens on a
 * thousand call sites gets switched off, and one that cannot go green teaches
 * nothing. This one is green when the ramp is right and red the moment a value
 * is darkened past the floor.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = 'desktop/src/theme/tokens.css';

/** WCAG 2.x relative luminance, then the contrast ratio between two sRGB hexes. */
const channel = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Body text, per WCAG AA and Unity's own editor accessibility page. */
const FLOOR = 4.5;
/**
 * The surfaces text is READ on: the panel body and the raised strip above it.
 * `--srf-4` and up are hover and popover fills, where the ramp is lower by
 * construction — holding those to the body floor would mean one flat text
 * colour, so they are counted and reported, not enforced.
 */
const READING_SURFACES = ['--srf-2', '--srf-3'];

const css = readFileSync(path.join(ROOT, TOKENS), 'utf8');
const valueOf = (name) => {
  const hit = new RegExp(`^\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\b`, 'm').exec(css);
  return hit ? hit[1] : null;
};

const textTokens = [...css.matchAll(/^\s*(--text(?:-[a-z]+)?):\s*(#[0-9a-fA-F]{6})\b/gm)]
  .map(([, name, hex]) => ({ name, hex }));

const problems = [];
if (textTokens.length === 0) problems.push(`${TOKENS}: no --text* tokens found — the ramp cannot be read`);

const reported = [];
for (const surface of READING_SURFACES) {
  const bg = valueOf(surface);
  if (!bg) { problems.push(`${TOKENS}: ${surface} is not a hex value — the ramp cannot be judged against it`); continue; }
  for (const { name, hex } of textTokens) {
    const ratio = contrast(hex, bg);
    reported.push({ surface, name, ratio });
    if (ratio < FLOOR) {
      problems.push(`${TOKENS}: ${name} (${hex}) is ${ratio.toFixed(2)}:1 on ${surface} (${bg}) — body text needs ${FLOOR}:1`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-theme: ${problems.length} finding(s).`);
  process.exit(1);
}

const worst = reported.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
console.log(
  `check-theme: ${textTokens.length} text token(s) over ${READING_SURFACES.length} reading surface(s) — `
  + `all >= ${FLOOR}:1, closest is ${worst.name} at ${worst.ratio.toFixed(2)}:1 on ${worst.surface}.`,
);
