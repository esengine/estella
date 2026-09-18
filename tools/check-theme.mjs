#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether the editor's colour ramps hold the contracts they were built on.
 *
 * Every invariant here has a gate except the visual layer, which is why the
 * visual layer is the one that drifted: `--text-faint` shipped at 3.26:1 on a
 * panel — under the floor for body text, as the colour of most labels in the
 * editor — and a chart series ran on a 100%-saturated viewport colour.
 *
 * Two claims, both read off the token file: text stays readable on the surfaces
 * it sits on, and a panel label stays quieter than the viewport. Deliberately
 * NOT the off-grid spacings or the hard-coded hexes (counted in RM-092): a gate
 * that reddens on a thousand call sites gets switched off.
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

/**
 * `--cat-*` labels content on a PANEL; `--gizmo-*` draws over a scene and has to
 * win against it. A seventh chart series took `--gizmo-particle` at 100% for want
 * of a `--cat-` member. Whether a panel borrows one ON PURPOSE (streamed-cell
 * labels do, to match the viewport) is intent — a rule for people, RM-092.
 */
const saturation = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (hi === lo) return 0;
  const l = (hi + lo) / 2;
  return Math.round(((hi - lo) / (l > 0.5 ? 2 - hi - lo : hi + lo)) * 100);
};

/**
 * Only the panel ramp is held. The reverse — "a gizmo must be vivid" — was
 * written here and measured false: `--gizmo-shadow` is 19%, `--gizmo-stream-cell`
 * 17%, grey on purpose. A gizmo's saturation follows what it draws.
 */
const PANEL_CEILING = 80;

const content = [...css.matchAll(/^\s*(--cat-[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/gm)]
  .map(([, name, hex]) => ({ name, hex, sat: saturation(hex) }));

if (content.length === 0) problems.push(`${TOKENS}: no --cat-* tokens found — the content ramp cannot be read`);
for (const { name, hex, sat } of content) {
  if (sat >= PANEL_CEILING) {
    problems.push(`${TOKENS}: ${name} (${hex}) is ${sat}% saturated — a panel label stays under ${PANEL_CEILING}%, that is viewport brightness`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-theme: ${problems.length} finding(s).`);
  process.exit(1);
}

const worst = reported.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
const loudest = content.reduce((a, b) => (a.sat >= b.sat ? a : b));
console.log(
  `check-theme: ${textTokens.length} text token(s) over ${READING_SURFACES.length} reading surface(s) — `
  + `all >= ${FLOOR}:1, closest is ${worst.name} at ${worst.ratio.toFixed(2)}:1 on ${worst.surface}. `
  + `${content.length} content label(s) under ${PANEL_CEILING}% saturation, loudest is ${loudest.name} at ${loudest.sat}%.`,
);
