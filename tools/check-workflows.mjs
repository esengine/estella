// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-workflows.mjs — a job that runs the repo's tooling installed it first.
 *
 * `node build-tools/cli.js` and `pnpm` are not standalone binaries: they resolve
 * out of the workspace's own `node_modules`. A job that reaches for them without
 * `./.github/actions/setup` does not misbehave subtly — it dies on
 * "Cannot find package 'commander'", and only once a tag is pushed, because the
 * release path has no pull-request run to fail on first.
 *
 * That has now happened twice. `publish-templates` wrote the template index that
 * way, and the fix left a comment saying so; the v0.37.0 publish gate then hand
 * -rolled `actions/setup-node` (which installs nothing) two hundred lines below
 * that comment and stranded a complete, correct release as a draft. A comment
 * cannot fail a build. This can.
 *
 * The rule is deliberately narrow, and holds without exception: if a step runs
 * workspace tooling, the job used the composite setup action, before that step,
 * with its install. Everything else about a workflow is left alone.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES, SCOPES } from './gates.mjs';

const WORKFLOWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const SETUP = './.github/actions/setup';

// Commands that resolve out of the workspace's node_modules. `npm` is absent on
// purpose: docs/ installs its own tree with it and owes this repo's nothing.
const NEEDS_INSTALL = [
    /\bnode\s+build-tools\//,
    /\bnode\s+tools\//,
    /\bpnpm\b/,
    /\bnpx\b/,
];

/**
 * The `run:` scripts of a workflow, as {line, text} where `line` is that of the
 * script's FIRST line — the `run:` itself when inline, the line below it for a
 * block scalar. Block scalars are joined so a command is matched wherever it
 * sits in one, and comments never are.
 */
function runScripts(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
        if (!m) continue;
        const indent = m[1].length + (/^\s*-\s+/.test(lines[i]) ? 2 : 0);
        const rest = m[2].trim();
        if (rest && !/^[|>][-+]?\d*$/.test(rest)) {
            out.push({ line: i + 1, text: rest });
            continue;
        }
        const body = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
            if (lines[j].trim() === '') { body.push(''); continue; }
            const lead = /^\s*/.exec(lines[j])[0].length;
            if (lead <= indent) break;
            body.push(lines[j]);
        }
        out.push({ line: i + 2, text: body.join('\n') });
        i = j - 1;
    }
    return out;
}

/** Jobs of a workflow file, as {id, line, lines} — `jobs:` mapping, one level in. */
function jobs(lines) {
    const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    if (start < 0) return [];
    const found = [];
    for (let i = start + 1; i < lines.length; i++) {
        const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
        if (m) found.push({ id: m[1], line: i + 1, at: i });
    }
    return found.map((job, k) => ({
        ...job,
        lines: lines.slice(job.at, k + 1 < found.length ? found[k + 1].at : lines.length),
    }));
}

/** Line index within a job at which the setup action has run, or -1. */
function setupAt(jobLines) {
    for (let i = 0; i < jobLines.length; i++) {
        if (!new RegExp(`uses:\\s*${SETUP.replace(/[.\\/]/g, '\\$&')}\\s*$`).test(jobLines[i])) continue;
        // `install: 'false'` sets the toolchain up without a node_modules.
        const withBlock = jobLines.slice(i + 1, i + 8).join('\n');
        if (/^\s*install:\s*['"]?false['"]?\s*$/m.test(withBlock)) continue;
        return i;
    }
    return -1;
}

const violations = [];

for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(path.join(WORKFLOWS, file), 'utf8').split('\n');
    const found = jobs(lines);
    // A workflow with no jobs is not a workflow — it means the scan above stopped
    // understanding the file, and a checker that reads nothing passes everything.
    if (found.length === 0) {
        console.error(`✗ .github/workflows/${file}: no jobs found — this check cannot read it`);
        process.exit(1);
    }
    for (const job of found) {
        const installed = setupAt(job.lines);
        for (const script of runScripts(job.lines)) {
            const cmd = NEEDS_INSTALL.find((re) => re.test(script.text));
            if (!cmd) continue;
            if (installed >= 0 && installed < script.line - 1) continue;
            const body = script.text.split('\n');
            const offset = body.findIndex((l) => cmd.test(l));
            violations.push({
                file,
                line: job.line + script.line - 1 + Math.max(offset, 0),
                job: job.id,
                what: (body[offset] ?? script.text).trim(),
                why: installed < 0 ? `job "${job.id}" never runs ${SETUP}` : `${SETUP} runs after this step`,
            });
        }
    }
}

// The gate list is one list only while both scopes read it. A workflow that
// enumerates check-*.mjs steps of its own is the second list growing back.
const gateProblems = [];
for (const g of GATES) {
    if (g.where === undefined) continue;
    if (!SCOPES.includes(g.where)) gateProblems.push(`gate "${g.id}" has scope "${g.where}" (have: ${SCOPES.join(', ')})`);
    if (!(typeof g.why === 'string' && g.why.trim())) {
        gateProblems.push(`gate "${g.id}" runs in ${g.where} only, with no reason — say why the other scope cannot`);
    }
}
const ciYml = readFileSync(path.join(WORKFLOWS, 'build.yml'), 'utf8');
if (!ciYml.includes('run-gates.mjs')) {
    gateProblems.push('build.yml does not run tools/run-gates.mjs — CI would be back to a gate list of its own');
}
for (const g of GATES) {
    const own = g.run.match(/tools\/(check-[\w-]+\.mjs)/);
    if (own && ciYml.includes(own[1]) && g.where !== 'local') {
        gateProblems.push(`build.yml names ${own[1]} directly; run-gates already runs it for the ci scope`);
    }
}
if (gateProblems.length > 0) {
    console.error('\n✗ the static gate list does not hold up:\n');
    for (const p of gateProblems) console.error(`  ${p}`);
    process.exit(1);
}

if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} workflow step(s) run workspace tooling with no install:\n`);
    for (const v of violations) {
        console.error(`  ${path.join('.github/workflows', v.file)}:${v.line}  ${v.what}`);
        console.error(`    ${v.why}\n`);
    }
    console.error(`Add \`- uses: ${SETUP}\` to the job before the step. It is where the`);
    console.error('toolchain versions live, and it installs the workspace frozen.\n');
    process.exit(1);
}

console.log('✓ every workflow step that runs workspace tooling installs it first');
console.log(`✓ ${GATES.length} static gate(s) in one list; CI runs it through run-gates.mjs`);
