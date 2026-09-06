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
 *         → the CI caller that runs without the capability
 *
 * The last link was missing, and it broke exactly the way the others would: a
 * commit taught the suites to demand a declaration and did not teach the
 * workflow to make one, so a lane that deliberately installs no emsdk died
 * before collecting a test while this gate stayed green.
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
    { what: 'an activated emsdk', probe: 'emccPath', prover: 'proveEmcc',
      owner: 'build-tools/utils/emscripten.js',
      // What INSTALLS it in CI. A job matching this provides the capability; a
      // job that runs the gate list without it owes the declaration.
      ciProvider: /setup-emsdk/ },
];

const WORKFLOW = '.github/workflows/build.yml';

/** The workflow's jobs, by name, as raw text. Enough YAML for this question:
 *  jobs are the two-space keys under `jobs:` and steps the four-space dashes. */
function jobsOf(yaml) {
    const body = yaml.slice(yaml.indexOf('\njobs:'));
    const heads = [...body.matchAll(/^  ([A-Za-z0-9_-]+):$/gm)];
    return heads.map((h, i) => [h[1],
        body.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : body.length)]);
}

function stepsOf(job) {
    const heads = [...job.matchAll(/^ {4}- /gm)];
    return heads.map((h, i) =>
        job.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : job.length));
}

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

/**
 * Whether a workflow step runs one of those suites, and so fires their provers.
 *
 * Two doors: the gate list, and vitest aimed at the package directly. Only the
 * first was recognised, and the second is how a lane that downloads the wasm
 * instead of building it ran the SDK suite with no emsdk and no declaration.
 */
function runsASuite(step) {
    if (/run-gates\.mjs/.test(step)) return true;
    if (!/\bvitest\b/.test(step)) return false;
    return SUITES.some((d) => new RegExp(`\\b${d.split('/')[0]}\\b`).test(step));
}
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

    // 3. And the callers: knowing the env var exists says nothing about whether
    //    the machine that lacks the capability actually sets it. A caller is any
    //    step that RUNS one of these suites — through the gate list or straight
    //    at vitest — because the prover fires either way.
    if (!cap.ciProvider || !declared) continue;
    if (!existsSync(path.join(ROOT, WORKFLOW))) {
        // Loudly, not by throwing: a gate whose subject moved has to say which
        // link it stopped checking, and a stack trace says only that it died.
        problems.push(`${WORKFLOW} is not there, so nothing checks whether a CI lane without`
            + ` ${cap.what} declares ${declared[1]}.`);
        continue;
    }
    const workflow = read(WORKFLOW);
    let callers = 0;
    for (const [job, text] of jobsOf(workflow)) {
        const provides = cap.ciProvider.test(text);
        for (const step of stepsOf(text)) {
            if (!runsASuite(step)) continue;
            callers++;
            const declares = new RegExp(`^\\s*${declared[1]}\\s*:`, 'm').test(step);
            if (!provides && !declares) {
                problems.push(`${WORKFLOW}: job "${job}" runs a suite that proves`
                    + ` ${cap.what}, has none, and does not declare ${declared[1]} —`
                    + ' the suite refuses to start, and nothing here said so.');
            }
            // The other way round is a lie in the other direction: a lane that
            // HAS the capability reporting a hole hides real coverage.
            if (provides && declares) {
                problems.push(`${WORKFLOW}: job "${job}" installs ${cap.what} and still`
                    + ` declares ${declared[1]} — it would report coverage it has as a gap.`);
            }
        }
    }
    if (callers === 0) {
        problems.push(`${WORKFLOW}: no job runs the gate list, or this gate can no longer find`
            + ' one — either way the caller half of the chain is unchecked.');
    }
}

if (problems.length) {
    console.error(`check-suite-preconditions: ${problems.length} finding(s).`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`check-suite-preconditions: ${CAPABILITIES.length} capability/capabilities,`
    + ` ${checked} suite(s) prove what their skips depend on.`);
