// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-verifier-owners — every checker in tools/ is run by something.
 *
 * A verifier nobody runs does not sit still: it rots against the thing it
 * checks and says nothing, because saying something requires being run.
 * `verify:aot` spent two releases failing on `systems.json`, a file the export
 * stopped writing the day the manifest moved inline — and the web road's only
 * "is it actually dispatched" check was gone that whole time.
 *
 * So a checker owes an owner: a workflow, the gate list, an exit criterion, a
 * package script, or another tool that spawns it. Where a machine genuinely
 * cannot run one — a phone in your hand — the owner is a criterion saying who
 * does and why, which is a declaration and not a silence.
 *
 *   node tools/check-verifier-owners.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/check-verifier-owners.mjs';

const read = (rel) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), 'utf8') : '');
const tracked = (glob) => execFileSync('git', ['ls-files', glob], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);

/** Where an owner may be declared. A name here is a claim that something runs it. */
const DECLARATIONS = [
    ...readdirSync(path.join(ROOT, '.github', 'workflows'))
        .filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`),
    'tools/gates.mjs', 'tools/releaseGate.mjs',
    'package.json', 'sdk/package.json', 'pipeline/package.json', 'desktop/package.json',
].map(read).join('\n');

/**
 * The rest of the tooling, with comments stripped: a tool named only in prose is
 * a tool nothing runs, and that is the case this exists to find. Quoted or
 * interpolated is the shape of a spawn, an import or an argv.
 */
const absent = [];
function code(rel) {
    // git names files this checkout does not have: a deletion not yet committed,
    // an unchecked-out submodule. Shrinking the corpus in silence is how a
    // scanner reports green on a smaller world, so they are counted and said.
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) { absent.push(rel); return ''; }
    return readFileSync(abs, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n').map((l) => l.replace(/(^|[^:'"`\w])\/\/.*$/, '$1')).join('\n');
}

const CHECKERS = tracked('tools/*.mjs').filter((f) => /\/(check|verify)-[\w-]+\.mjs$/.test(f));
const CALLERS = [...tracked('tools/*.mjs'), ...tracked('tools/**/*.mjs'), ...tracked('build-tools/**/*.js')]
    .filter((f) => f !== SELF);
const callerCode = CALLERS.map(code).join('\n');

const orphans = [];
for (const rel of CHECKERS) {
    if (rel === SELF) continue;
    if (absent.includes(rel)) continue;
    const base = path.basename(rel);
    if (DECLARATIONS.includes(base)) continue;
    // Named by another tool in CODE — a spawn, an import, an argv — not in prose.
    // Its own file is in the corpus, so a self-mention has to be discounted.
    const mine = code(rel).split(base).length - 1;
    if (callerCode.split(base).length - 1 > mine) continue;
    orphans.push(rel);
}

if (orphans.length) {
    console.error('check-verifier-owners: nothing runs these, so nothing will notice when they rot.\n');
    for (const o of orphans) console.error(`  ${o}`);
    console.error('\nGive each a caller — a workflow, tools/gates.mjs, a package script — or an exit'
        + ' criterion in tools/releaseGate.mjs saying who runs it and why a machine cannot.');
    process.exit(1);
}
if (absent.length) {
    console.log(`check-verifier-owners: ${absent.length} tracked file(s) are not in this checkout`
        + ` and were not read: ${absent.slice(0, 5).join(', ')}${absent.length > 5 ? ' …' : ''}`);
}
console.log(`check-verifier-owners: ${CHECKERS.length - absent.length} checkers, every one of them`
    + ' run by something.');
