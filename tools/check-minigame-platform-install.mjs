#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mini-game profile says how its platform gets installed.
 *
 * The generated entry is the only thing that runs before the game does, so the
 * platform has to be installed from there: `platformInit` names a function it
 * calls, or `runtimeProfileHost`/`runtimeProfileModule` names a profile it
 * hands to `installMiniGamePlatform`.
 *
 * WeChat named neither, and relied on `index.wechat.base` doing it as a module
 * side effect. Then the lean entry arrived — pure re-exports, with the call now
 * in a shared chunk that `sideEffects` does not list — and every WeChat package
 * booted to "[ESEngine] Platform not initialized". It built clean, it passed
 * every test, and only a device said so.
 *
 *   node tools/check-minigame-platform-install.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'pipeline/src/export/miniGameExportProfile.ts';

const src = readFileSync(path.join(ROOT, FILE), 'utf8');
const profiles = [...src.matchAll(/export const (\w+)ExportProfile: MiniGameExportProfile = \{([\s\S]*?)\n\};/g)];

if (profiles.length === 0) {
  console.error(`check-minigame-platform-install: no profiles in ${FILE} — they moved.`);
  process.exit(1);
}

/** Any one of these makes the install explicit; none of them leaves it to chance. */
const DOORS = ['platformInit', 'runtimeProfileHost', 'runtimeProfileModule'];

const problems = [];
const answered = [];
for (const [, vendor, body] of profiles) {
  const named = DOORS.filter((d) => new RegExp(`^\\s{4}${d}:`, 'm').test(body));
  if (named.length === 0) {
    problems.push(`${vendor} names none of ${DOORS.join(' / ')} — its package would rely on an SDK `
      + 'entry installing the platform as a module side effect, which a bundler may drop');
  } else answered.push(`${vendor}: ${named.join(' + ')}`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${FILE}: ${p}`);
  console.error(`check-minigame-platform-install: ${problems.length} profile(s) leave the platform to a side effect.`);
  process.exit(1);
}

console.log(`check-minigame-platform-install: ${profiles.length} profile(s) — ${answered.join(', ')}.`);
