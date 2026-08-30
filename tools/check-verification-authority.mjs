#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-verification-authority.mjs — "the full gate suite is green" has
 *        to mean every suite.
 *
 * On 2026-08-30 the gate list reported 76/76 green while four SDK suites did not
 * compile against the source they test. Nothing was wrong with the gates and
 * nothing was wrong with the tests: no gate had ever invoked them, so the
 * sentence everyone was saying meant less than everyone thought it did. A
 * checkout could delete every SDK test and stay green.
 *
 * The fix is not a longer list — a longer list goes stale the same way. It is a
 * comparison between two DIFFERENT kinds of thing: the directories that hold
 * tests (the ground), and the `covers` a gate declares (the claim). A suite
 * nobody runs shows up as ground with no claim over it; a claim over ground that
 * no longer exists shows up as stale.
 *
 *   node tools/check-verification-authority.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES } from './gates.mjs';
import { listTrackedSources, hasEditor } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every directory that actually holds a test file, editor included. */
function directoriesHoldingTests() {
    const roots = ['sdk', 'pipeline', 'tools', 'compiler', 'plugins', 'desktop'];
    const { files } = listTrackedSources(roots);
    const dirs = new Set();
    for (const rel of files) {
        if (!/\.test\.(ts|tsx|mts)$/.test(rel)) continue;
        // The directory a suite is named by — `sdk/tests`, not every subfolder
        // under it, so a nested helper folder is not a suite of its own.
        const parts = rel.split('/');
        const at = parts.lastIndexOf('tests');
        dirs.add(at > 0 ? parts.slice(0, at + 1).join('/') : path.posix.dirname(rel));
    }
    return dirs;
}

const claimed = new Map();
for (const gate of GATES) {
    for (const dir of gate.covers ?? []) {
        if (claimed.has(dir)) {
            console.error(`check-verification-authority: ${dir} is claimed by both `
                + `${claimed.get(dir)} and ${gate.id} — one suite, one runner.`);
            process.exit(1);
        }
        claimed.set(dir, gate.id);
    }
}

const findings = [];
const ground = directoriesHoldingTests();

for (const dir of [...ground].sort()) {
    // Without an editor checkout its suites are not on the ground to judge; the
    // gate that runs them declares `needs: 'editor'` and run-gates says so.
    if (!hasEditor() && dir.startsWith('desktop/')) continue;
    if (!claimed.has(dir)) {
        findings.push(`${dir} holds tests and no gate runs them — `
            + `"the full gate suite is green" would not include it`);
    }
}

for (const [dir, gate] of claimed) {
    if (!existsSync(path.join(ROOT, dir))) {
        if (!hasEditor() && dir.startsWith('desktop/')) continue;
        findings.push(`${gate} claims to cover ${dir}, which does not exist`);
    }
}

// The summary is part of the authority: "76/76 gates" reads as static checks.
// ASKED of the reporter rather than grepped out of it — a rule looking for a
// word is satisfied by a mention that prints nothing.
const plan = spawnSync(process.execPath,
                       [path.join(ROOT, 'tools', 'run-gates.mjs'), '--scope', 'local', '--plan'],
                       { cwd: ROOT, encoding: 'utf8' });
const reported = plan.stdout ?? '';
for (const gate of GATES) {
    if (!gate.covers?.length) continue;
    if (!hasEditor() && gate.needs === 'editor') continue;
    if (!reported.includes(gate.id)) {
        findings.push(`run-gates does not name ${gate.id} among the suites it runs — `
            + 'a green line that names no suite is what made this necessary');
    }
}
if (!/test suites run:/.test(reported)) {
    findings.push('run-gates reports no test suites at all');
}

if (findings.length === 0) {
    console.log(`check-verification-authority: ${ground.size} test director(ies), `
        + `each run by exactly one gate.`);
    process.exit(0);
}
for (const f of findings) console.error(`✗ ${f}`);
console.error('\nDeclare the suite in tools/gates.mjs (`covers`), or delete the tests.');
process.exit(1);
