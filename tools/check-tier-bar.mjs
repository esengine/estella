#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-tier-bar.mjs — what a subsystem must have before it may leave
 *        `experimental`.
 *
 * `check-subsystem-tiers` holds the table against the tags: a verdict and the
 * code that carries it are one answer. It cannot say whether the verdict was
 * EARNED, and nothing could — so a promotion was a judgement made once, argued
 * in prose, and never re-asked. Two rows said only "the runtime surface has not
 * been read for a tier yet", which is a note to self, not a criterion.
 *
 * The bar is the one `check-freeze-bar` already applies to a @public symbol,
 * asked of the `entry` a subsystem publishes its verdict on:
 *   documented   the contract is readable without the implementation
 *   tested       something pins the shape
 *   exercised    a golden project imports it (values only — a type carries no
 *                runtime behaviour a package can certify)
 *
 * **It is a floor, not a promotion.** Clearing it makes a tier permissible;
 * whether the evidence is BROAD enough to promise on is a judgement, and stays
 * in `why`. What the bar removes is the other case — a claim that could not have
 * been earned, made because nobody had a way to ask.
 *
 * Calibration: all six `public` subsystems clear it, which is how we know it is
 * the bar already in force rather than a new one invented here.
 *
 * A row published before this existed and still short goes in {@link OWED} with
 * what it lacks, checked to STILL lack it — so the day the gap closes the gate
 * says so instead of the entry quietly becoming a lie.
 *
 *   node tools/check-tier-bar.mjs
 *   node tools/check-tier-bar.mjs --report   every subsystem and its shortfall
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ETC, ENTRIES } from './lib/sdkProgram.mjs';
import { parseSnapshot } from './lib/apiSnapshot.mjs';
import {
    VALUE_KINDS, BLIND, hasDocProse, testedIdentifiers, exercisedByGolden,
    declarationsOf, createSdkProgram,
} from './lib/apiEvidence.mjs';
import { SUBSYSTEMS } from './apiSubsystems.mjs';

/**
 * Rows that claimed a tier before the bar was asked, and what each still owes.
 * `needs` is the bar's own wording; an entry whose row now clears is an error,
 * because a list of debts nobody pays down reads like a list of exemptions.
 */
const OWED = {
    'input-raw': ['TouchPoint is named by no SDK test'],
    scene: [
        'SceneConfig is named by no SDK test',
        'transitionTo is named by no SDK test',
        'SceneManagerState is called by no golden project',
    ],
    prefab: [
        'Prefabs is named by no SDK test',
        'SpawnOverride is named by no SDK test',
        'PrefabServer is called by no golden project',
    ],
    assets: ['AssetsData is named by no SDK test'],
    camera: ['CameraData is named by no SDK test'],
    animation: ['SpriteAnimator is called by no golden project'],
};

const REPORT = process.argv.includes('--report');

/** Every exported symbol's snapshot kind, so a type is not asked to be called. */
function kinds() {
    const out = new Map();
    for (const entryName of Object.keys(ENTRIES)) {
        const file = join(ETC, `${entryName}.api.md`);
        if (!existsSync(file)) continue;
        for (const [name, s] of parseSnapshot(readFileSync(file, 'utf8'))) {
            if (!out.has(name)) out.set(name, s.kind);
        }
    }
    return out;
}

const kindOf = kinds();
const tested = testedIdentifiers();
const exercised = exercisedByGolden();
const wanted = new Set(SUBSYSTEMS.flatMap((s) => s.entry ?? []));
const { program, checker } = createSdkProgram();
const declarations = declarationsOf(wanted, program, checker);

/** What the bar still wants from a subsystem, in its own wording. */
function shortfall(sub) {
    const missing = [];
    for (const name of sub.entry ?? []) {
        if (BLIND[name]) continue;
        const decl = declarations.get(name);
        // Unresolvable is "cannot tell", and check-subsystem-tiers already fails
        // a verdict resting on a name no entry exports. Not counted twice here.
        if (!decl) continue;
        if (!hasDocProse(decl)) missing.push(`${name} carries no doc prose`);
        if (!tested.has(name)) missing.push(`${name} is named by no SDK test`);
        if (VALUE_KINDS.has(kindOf.get(name)) && !exercised.has(name)) {
            missing.push(`${name} is called by no golden project`);
        }
    }
    return missing;
}

const problems = [];
const rows = [];
for (const sub of SUBSYSTEMS) {
    const missing = shortfall(sub);
    rows.push({ id: sub.id, tier: sub.tier, missing });
    const owed = OWED[sub.id];
    if (sub.tier === 'experimental') {
        if (owed) problems.push(`"${sub.id}" is experimental and in OWED — nothing is owed below the bar`);
        continue;
    }
    if (owed) {
        if (!missing.length) {
            problems.push(`"${sub.id}" now clears the bar — take it out of OWED, it is not owed anything`);
            continue;
        }
        const gone = owed.filter((n) => !missing.includes(n));
        if (gone.length) problems.push(`"${sub.id}" no longer owes: ${gone.join('; ')} — OWED is stale`);
        const unlisted = missing.filter((n) => !owed.includes(n));
        if (unlisted.length) {
            problems.push(`"${sub.id}" is ${sub.tier} and short of the bar in a way OWED does not admit: `
                + unlisted.join('; '));
        }
        continue;
    }
    if (missing.length) {
        problems.push(`"${sub.id}" is published as ${sub.tier} without clearing the bar: ${missing.join('; ')}`);
    }
}

if (REPORT) {
    for (const tier of ['public', 'beta', 'experimental']) {
        console.log(`\n## ${tier}\n`);
        for (const r of rows.filter((x) => x.tier === tier)) {
            console.log(r.missing.length ? `  ${r.id}\n      ${r.missing.join('\n      ')}` : `  ${r.id} — clears the bar`);
        }
    }
    process.exit(0);
}

if (problems.length) {
    console.error('check-tier-bar: a published tier is a promise, and these are not backed.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nEarn it — document the entry, name it in a test, have a golden project call it —'
        + ' or say it is experimental, which is the honest verdict for something nobody has held up yet.');
    process.exit(1);
}

const clears = rows.filter((r) => r.tier !== 'experimental' && !r.missing.length).length;
const above = rows.filter((r) => r.tier !== 'experimental').length;
console.log(`check-tier-bar: ${above} subsystem(s) above experimental — ${clears} clear the bar,`
    + ` ${Object.keys(OWED).length} owe what they were published short of.`);
