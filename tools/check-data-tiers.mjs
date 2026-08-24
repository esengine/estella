#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-data-tiers.mjs — a component's promise covers the shape you write.
 * @details `@beta` on a component says "shipping and supported; the shape may still
 *          adjust". Fourteen components carried that while the `<Name>Data` interface
 *          describing their fields carried `@experimental` — "may change or disappear
 *          in any release". Together those are not two verdicts, they are one empty
 *          one: a component IS its fields, and a creator promised the component and
 *          not the shape has been promised nothing.
 *
 *          None of the fourteen was a decision. Untagged is Experimental by design,
 *          so a Data interface reached that tier by nobody writing a line — which is
 *          exactly the drift the tier system exists to make impossible, arriving
 *          through the one door it left open.
 *
 * Run: node tools/check-data-tiers.mjs   (exit 1 on a promise that does not cover)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ETC, ENTRIES } from './lib/sdkProgram.mjs';
import { parseSnapshot, TIERS } from './lib/apiSnapshot.mjs';

/** Symbol -> the strongest tier any entry gives it, matching how the surface reads. */
const rank = Object.fromEntries(TIERS.map((t, i) => [t, i]));
const tier = new Map();
for (const entry of Object.keys(ENTRIES)) {
    const file = join(ETC, `${entry}.api.md`);
    if (!existsSync(file)) continue;
    for (const [name, s] of parseSnapshot(readFileSync(file, 'utf8'))) {
        const seen = tier.get(name);
        if (!seen || (rank[s.tier] ?? 9) < (rank[seen] ?? 9)) tier.set(name, s.tier);
    }
}

const problems = [];
let pairs = 0;
for (const [name, t] of tier) {
    if (!name.endsWith('Data')) continue;
    const component = name.slice(0, -4);
    const owner = tier.get(component);
    if (!owner) continue;
    pairs++;
    if ((rank[t] ?? 9) > (rank[owner] ?? 9)) {
        problems.push(`${component} is @${owner} but ${name} — the fields you write into it — is @${t}`);
    }
}

if (problems.length) {
    console.error('check-data-tiers: a promise that does not cover the shape it is about.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nTag the interface to match (`stability=` at the ES_COMPONENT site for a '
        + 'generated one), or lower the component to what its shape can back.');
    process.exit(1);
}

console.log(`check-data-tiers: ${pairs} component/Data pair(s), each promised as one thing.`);
