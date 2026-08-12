#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-subsystem-tiers.mjs — the published verdict per subsystem is the
 *        one the code carries.
 *
 * A table of what is safe to build on is worth having and worth nothing if it can
 * drift: the moment a symbol's tag moves and the table does not, the table is the
 * confident wrong answer a creator reads instead of the right one nobody surfaces.
 *
 * So every subsystem's `entry` symbols are looked up in the snapshots and must
 * carry the tier it claims — and each must still be an exported symbol, because a
 * verdict resting on a name that no longer exists rests on nothing.
 *
 *   node tools/check-subsystem-tiers.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ETC, ENTRIES } from './lib/sdkProgram.mjs';
import { parseSnapshot, TIERS } from './lib/apiSnapshot.mjs';
import { SUBSYSTEMS } from './apiSubsystems.mjs';

/** Every symbol across every entry, keeping the strongest tier any entry gives it. */
function surface() {
    const rank = Object.fromEntries(TIERS.map((t, i) => [t, i]));
    const out = new Map();
    for (const entryName of Object.keys(ENTRIES)) {
        const file = join(ETC, `${entryName}.api.md`);
        if (!existsSync(file)) continue;
        for (const [name, s] of parseSnapshot(readFileSync(file, 'utf8'))) {
            const seen = out.get(name);
            if (!seen) { out.set(name, s.tier); continue; }
            if ((rank[s.tier] ?? 9) < (rank[seen] ?? 9)) out.set(name, s.tier);
        }
    }
    return out;
}

const api = surface();
const problems = [];
const seen = new Set();

for (const sub of SUBSYSTEMS) {
    if (seen.has(sub.id)) problems.push(`"${sub.id}" is listed twice`);
    seen.add(sub.id);
    if (!sub.title || !sub.titleZh) {
        problems.push(`"${sub.id}" is missing a title in one locale — half a translation is English leaking onto the Chinese page`);
    }
    if (!TIERS.includes(sub.tier)) {
        problems.push(`"${sub.id}" claims tier "${sub.tier}" (have: ${TIERS.join(', ')})`);
        continue;
    }
    // Frozen speaks for itself; anything else is a decision, and a decision with
    // no reason beside it reads as an oversight — which is the whole disease.
    if (sub.tier !== 'public' && !(sub.why?.trim() && sub.whyZh?.trim())) {
        problems.push(`"${sub.id}" is ${sub.tier} without a reason in both locales — say what decided it, twice`);
    }
    if (!sub.entry?.length) {
        problems.push(`"${sub.id}" names no entry symbols — then nothing in the code carries its verdict`);
        continue;
    }
    for (const name of sub.entry) {
        const tier = api.get(name);
        if (!tier) problems.push(`"${sub.id}" rests on "${name}", which no entry exports`);
        else if (tier !== sub.tier) {
            problems.push(`"${sub.id}" is published as ${sub.tier} but "${name}" is @${tier}`);
        }
    }
}

if (problems.length) {
    console.error('check-subsystem-tiers: the published verdicts and the tags disagree.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nMove the tag, or move the verdict — but they are one answer.');
    process.exit(1);
}

const by = (t) => SUBSYSTEMS.filter((s) => s.tier === t).length;
console.log(`check-subsystem-tiers: ${SUBSYSTEMS.length} subsystem(s) — `
    + `${by('public')} frozen, ${by('beta')} beta, ${by('experimental')} experimental, each backed by its tags.`);
