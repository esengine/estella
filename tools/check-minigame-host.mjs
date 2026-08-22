// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-minigame-host — the stand-in host implements what the engine asks for.
 *
 * launch-minigame boots a WeChat/Douyin package against a shim, and a shim is
 * only worth trusting while it matches the real thing. The engine already says
 * what the real thing must provide: `MiniGameGlobal` in the SDK is documented as
 * "only the subset the engine actually uses".
 *
 * So the two are held together here. A member added to the interface and not to
 * the shim would otherwise surface as a package that "fails to launch" in CI —
 * a harness gap wearing a product bug's clothes, which is the worst way to find
 * out. Optional members (`name?()`) may be skipped; required ones may not.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIM_MEMBERS } from './launchers/minigameHost.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'sdk/src/platform/minigame/api.ts';

const src = readFileSync(path.join(ROOT, API), 'utf8');
const block = /export interface MiniGameGlobal\s*\{([\s\S]*?)\n\}/.exec(src);
if (!block) {
  console.error(`check-minigame-host: no MiniGameGlobal interface in ${API} — has it moved?`);
  process.exit(1);
}

// One member per declaration line: `name(...)` or `name?(...)`. Comment lines and
// blanks carry no member, so they simply do not match.
const required = [];
const optional = [];
for (const line of block[1].split('\n')) {
  const m = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*[(:]/.exec(line);
  if (!m) continue;
  (m[2] ? optional : required).push(m[1]);
}

if (required.length === 0) {
  console.error('check-minigame-host: parsed no required members — the interface shape changed');
  process.exit(1);
}

const shim = new Set(SHIM_MEMBERS);
const missing = required.filter((n) => !shim.has(n));
// A shim member the interface has never heard of is dead weight at best, and at
// worst a name the engine stopped calling while the shim kept pretending.
const known = new Set([...required, ...optional]);
const stale = SHIM_MEMBERS.filter((n) => !known.has(n));

if (missing.length || stale.length) {
  console.error('check-minigame-host: the stand-in host no longer matches the engine.\n');
  for (const n of missing) console.error(`  the engine requires "${n}" and the shim does not provide it`);
  for (const n of stale) console.error(`  the shim provides "${n}", which MiniGameGlobal does not declare`);
  console.error('\n  Both live in tools/launchers/minigameHost.mjs (SHIM_MEMBERS beside the page).');
  process.exit(1);
}

console.log(
  `check-minigame-host: the stand-in host covers ${required.length} required`
  + ` and ${SHIM_MEMBERS.length - required.length} optional member(s) of MiniGameGlobal — ok`,
);
