#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-suite-preconditions.mjs — a suite that CANNOT run its
 *        differentials has to say so, and be counted as not having run them.
 *
 * `it.skipIf(!CC)` reads in a summary exactly like a test that ran, and one
 * suite did worse: an early `return` left twenty-two tests unregistered, so a
 * machine with no compiler reported a smaller suite passing.
 *
 * The honest shape is a chain, and every link of it can be removed on its own
 * without anything going red — which is what this holds together:
 *
 *   probe → prover (once per suite) → declaration env var → the gate runner
 *
 * Run: node tools/check-suite-preconditions.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/**
 * A machine capability a test may be unable to exercise. `probe` answers
 * whether the machine has it; `prover` is what a suite calls ONCE so a skip
 * below it means "not applicable" rather than "never looked".
 */
const CAPABILITIES = [
    { what: 'a host C compiler', probe: 'findHostCC', prover: 'proveHostCC', owner: 'compiler/src/hostCC.ts' },
];

/** Test files, by the package that owns them. */
function testFiles(dir, out = []) {
    for (const name of readdirSync(path.join(ROOT, dir))) {
        if (name === 'node_modules') continue;
        const child = `${dir}/${name}`;
        if (statSync(path.join(ROOT, child)).isDirectory()) testFiles(child, out);
        else if (name.endsWith('.test.ts')) out.push(child);
    }
    return out;
}

const SUITES = ['compiler/tests', 'pipeline/tests', 'sdk/tests'].filter((d) => existsSync(path.join(ROOT, d)));
const problems = [];
let checked = 0;

for (const cap of CAPABILITIES) {
    const owner = read(cap.owner);
    // Word-bounded, and a CALL rather than a mention: `proveHostCCX` contains
    // the name, and an import line contains it without anything invoking it.
    if (!new RegExp(`export function ${cap.prover}\\b`).test(owner)) {
        problems.push(`${cap.owner} no longer exports ${cap.prover}() — nothing proves ${cap.what}.`);
        continue;
    }

    // 1. Every suite whose tests ask for the capability proves it once.
    const users = new Set();
    for (const dir of SUITES) {
        for (const file of testFiles(dir)) {
            if (read(file).includes(cap.probe)) users.add(dir.split('/')[0]);
        }
    }
    if (users.size === 0) {
        problems.push(`no test uses ${cap.probe} — this capability's rule has nothing to hold.`);
    }
    for (const pkg of [...users].sort()) {
        checked++;
        const config = `${pkg}/vitest.config.ts`;
        const setup = /globalSetup:\s*\[\s*'([^']+)'/.exec(existsSync(path.join(ROOT, config)) ? read(config) : '');
        if (!setup) {
            problems.push(`${pkg} skips on ${cap.probe} but ${config} runs no globalSetup —`
                + ` a machine without ${cap.what} reports those tests as a pass.`);
            continue;
        }
        const at = `${pkg}/${setup[1]}`;
        const calls = new RegExp(`\\b${cap.prover}\\s*\\(`);
        if (!existsSync(path.join(ROOT, at)) || !calls.test(read(at))) {
            problems.push(`${at} does not call ${cap.prover}() — ${pkg}'s skips on ${cap.probe} are silent.`);
        }
    }

    // 2. The declaration a machine without it makes is one the gate runner counts
    //    as a hole. Two spellings of the env var and `--complete` stops seeing it.
    const declared = /const NO_[A-Z_]+ = '([A-Z_]+)'/.exec(owner);
    if (!declared) {
        problems.push(`${cap.owner} does not name the env var a checkout without ${cap.what} declares.`);
    } else if (!read('tools/run-gates.mjs').includes(`'${declared[1]}'`)) {
        problems.push(`run-gates does not count ${declared[1]} as a gap, so declaring it would`
            + ' hide the hole from --complete rather than report it.');
    }
}

if (problems.length) {
    console.error(`check-suite-preconditions: ${problems.length} finding(s).`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`check-suite-preconditions: ${CAPABILITIES.length} capability/capabilities,`
    + ` ${checked} suite(s) prove what their skips depend on.`);
