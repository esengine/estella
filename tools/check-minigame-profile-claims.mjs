#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mini-game profile says where each claim about a vendor came from.
 *
 * Four of a profile's fields decide what the package CONTAINS on the strength of
 * what a vendor is said to accept, and getting one wrong fails nowhere near the
 * mistake: a packer suffix it does not take is refused at upload, a `.wasm.br`
 * its loader cannot read is a package that boots into nothing, a syntax level
 * its runtime predates throws on a device, and a suffix wrongly called native
 * leaves a staged file the runtime cannot open. Every one of those is a build
 * that goes green.
 *
 * So each is answerable: cite the vendor's own page, or say what the value is
 * assumed from and what it costs if the assumption is wrong. Saying "not
 * claimed until a device settles it" IS an answer — it is how Douyin ships
 * without a packer whitelist.
 *
 *   node tools/check-minigame-profile-claims.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'pipeline/src/export/miniGameExportProfile.ts';

/** The fields whose wrong answer is a package that builds clean and then fails. */
const CLAIMS = ['esTarget', 'nativeSuffixes', 'packerSuffixes', 'wasmBrotli'];

const src = readFileSync(path.join(ROOT, FILE), 'utf8');
const profiles = [...src.matchAll(/export const (\w+)ExportProfile: MiniGameExportProfile = \{([\s\S]*?)\n\};/g)];

if (profiles.length === 0) {
  console.error(`check-minigame-profile-claims: no profiles in ${FILE} — they moved.`);
  process.exit(1);
}

const problems = [];
let answered = 0;
for (const [, vendor, body] of profiles) {
  const lines = body.split('\n');
  for (const field of CLAIMS) {
    const at = lines.findIndex((l) => new RegExp(`^\\s{4}${field}:`).test(l));
    // A profile that does not set an optional field claims nothing by it.
    if (at < 0) continue;
    let above = at - 1;
    let reason = 0;
    while (above >= 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[above])) { reason += 1; above -= 1; }
    if (reason === 0) {
      problems.push(`${FILE}: ${vendor}'s ${field} says nothing about where it came from — `
        + 'cite the vendor, or say what it is assumed from and what a wrong guess costs');
    } else answered += 1;
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-minigame-profile-claims: ${problems.length} unexplained claim(s).`);
  process.exit(1);
}

console.log(`check-minigame-profile-claims: ${profiles.length} profile(s), ${answered} vendor claim(s), `
  + 'each one sourced or hedged.');
