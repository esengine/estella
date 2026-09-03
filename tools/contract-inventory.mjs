#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  contract-inventory.mjs — what Estella's runtime contract facts are,
 *        who authors each, and what would notice if one changed.
 *
 * `EsEventOut` shipped for as long as it existed with no word count of its own,
 * no compile-time check and no term in any digest. That was not thin test
 * coverage — the ABI compatibility system did not know a fact lived there. The
 * two are different severities and nothing could tell them apart, because
 * nothing enumerated the facts.
 *
 * This enumerates them. It is DESCRIPTIVE on purpose: no authority moves, no
 * artifact is generated from here. First answer what exists, then decide what is
 * worth canonicalising — the reverse builds a central schema and then goes
 * looking for things to put in it.
 *
 * Two kinds of finding, and the second is the one that keeps this honest:
 *
 *   - A CLAIM that no longer holds. Every citation carries a probe, so an entry
 *     pointing at a fact that has moved is red rather than stale documentation.
 *   - GROUND with no claim over it. A generated artifact no fact projects, or a
 *     `C++ contract:` pin no fact names, is a fact nobody wrote down. This is
 *     the same comparison `check-verification-authority` makes, and it is why a
 *     longer list would not have done.
 *
 * Sabotaged in four directions before it was trusted, each red on its own line
 * and nothing else: a probe pointed at a moved fact, a verification that was
 * also a projection, an unattributed `*.generated.*`, and a `C++ contract:` pin
 * no fact named.
 *
 *   node tools/contract-inventory.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { FACTS, NOT_CONTRACT } from './lib/contractFacts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const findings = [];
const notes = [];

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Every file under a directory, so a directory author can be probed. */
function walk(dir, out = []) {
    for (const name of readdirSync(path.join(ROOT, dir))) {
        const child = `${dir}/${name}`;
        if (statSync(path.join(ROOT, child)).isDirectory()) walk(child, out);
        else out.push(child);
    }
    return out;
}

/**
 * Does the fact still live where the entry says? A citation is only worth
 * having if it fails when the thing it points at moves.
 */
function probeHolds(cite) {
    const at = path.join(ROOT, cite.path);
    if (!existsSync(at)) return 'no such path';
    if (cite.dir) {
        const files = walk(cite.path);
        if (!files.length) return 'directory is empty';
        for (const f of files) {
            try {
                if (cite.probe.test(read(f))) return null;
            } catch { /* binary or unreadable; the next file may match */ }
        }
        return `no file under it matches ${cite.probe}`;
    }
    return cite.probe.test(read(cite.path)) ? null : `does not match ${cite.probe}`;
}

/**
 * Authority, projection and verification are three roles, and the third has to
 * be INDEPENDENT of the first two or the green means nothing. A file that is
 * both a projection and the verification of the same fact is a generator being
 * asked whether it generated correctly.
 */
function checkRoleSeparation(fact) {
    const projected = new Set(fact.projections);
    for (const v of fact.verification) {
        if (projected.has(v.path)) {
            findings.push(`${fact.id}: ${v.path} is cited as BOTH a projection and a`
                + ' verification. A derivation cannot verify itself.');
        }
    }
}

/** Computed, never declared: the status is what the citations add up to. */
function statusOf(fact) {
    const semantic = fact.authors.filter((a) => a.kind === 'semantic');
    const impl = fact.authors.filter((a) => a.kind === 'implementation');
    const verified = fact.verification.length > 0;
    if (impl.length > 1) {
        return verified ? 'multi-implementation-differential' : 'multi-implementation-unbound';
    }
    if (semantic.length > 1) {
        return verified ? 'multi-author-machine-verified' : 'multi-author-unbound';
    }
    if (fact.digest) return 'single-author-covered';
    return verified ? 'single-author-verified' : 'single-author-unverified';
}

const RED_STATUS = new Set(['multi-author-unbound', 'multi-implementation-unbound', 'single-author-unverified']);

const report = [];
for (const fact of FACTS) {
    for (const [role, cites] of [['author', fact.authors], ['verification', fact.verification]]) {
        for (const cite of cites) {
            const why = probeHolds(cite);
            if (why) findings.push(`${fact.id}: ${role} ${cite.path} — ${why}`);
        }
    }
    for (const p of fact.projections) {
        if (!existsSync(path.join(ROOT, p))) findings.push(`${fact.id}: projection ${p} — no such path`);
    }
    if (fact.digest) {
        const why = probeHolds(fact.digest);
        if (why) findings.push(`${fact.id}: digest ${fact.digest.name} at ${fact.digest.path} — ${why}`);
    }
    checkRoleSeparation(fact);

    const status = statusOf(fact);
    if (RED_STATUS.has(status) && !fact.owed) {
        findings.push(`${fact.id}: ${status} — more than one author and nothing compares them,`
            + ' and no `owed` says why that is accepted.');
    }
    // The debt is paid the day the gate says so, not the day someone remembers.
    // Keyed on a FIELD, not on how the sentence was worded: a rule that greps its
    // own prose is dodged by a rephrase, which is the failure it exists to stop.
    if (fact.owedUntil === 'digest' && fact.digest) {
        findings.push(`${fact.id}: its gap says it closes when a digest covers the fact, and`
            + ` one does now (${fact.digest.name}). Rewrite or delete \`owed\` — a gap that`
            + ' reads as open after it closed is worse than none.');
    }
    if (fact.owedUntil && !fact.owed) {
        findings.push(`${fact.id}: declares owedUntil with no \`owed\` saying what is missing.`);
    }
    report.push({ ...fact, status });
}

// ── Ground: every generated artifact belongs to a fact ────────────────────────
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !/^(third_party|build)\//.test(f));

const GENERATED_NAME = /\.generated\.|\/generated\//;
const DECLARES_GENERATED = /auto-generated|GENERATED by|@generated|generatedBy|DO NOT EDIT|do not edit/i;
const generated = tracked.filter((f) => {
    if (!/\.(ts|tsx|js|mjs|c|h|hpp|cpp|json|d\.ts)$/.test(f)) return false;
    if (GENERATED_NAME.test(f)) return true;
    try {
        return DECLARES_GENERATED.test(read(f).slice(0, 400));
    } catch {
        return false;
    }
});

const projected = new Set(FACTS.flatMap((f) => f.projections));
for (const g of generated) {
    if (projected.has(g) || NOT_CONTRACT[g]) continue;
    findings.push(`GROUND: ${g} is generated, and no fact projects it. Either it derives`
        + ' from an authority (add it) or it is not a contract (say so in NOT_CONTRACT).');
}
for (const [p, why] of Object.entries(NOT_CONTRACT)) {
    if (!existsSync(path.join(ROOT, p))) findings.push(`NOT_CONTRACT names ${p}, which is gone — ${why}`);
}

// ── Ground: every hand-copied cross-language pin belongs to a fact ────────────
const PIN_FILE = 'sdk/tests/cpp-contract.test.ts';
if (existsSync(path.join(ROOT, PIN_FILE))) {
    const src = read(PIN_FILE);
    const titles = [...src.matchAll(/describe\('C\+\+ contract: ([^']*?) \(([^)]*)\)'/g)].map((m) => m[1]);
    const probes = FACTS.flatMap((f) => f.verification.filter((v) => v.path === PIN_FILE).map((v) => v.probe));
    for (const title of titles) {
        if (!probes.some((p) => p.test(title))) {
            findings.push(`GROUND: "${PIN_FILE}" pins "${title}", and no fact names that pin.`
                + ' A constant hand-copied across the boundary is a fact whether or not it is written down.');
        }
    }
    notes.push(`${titles.length} cross-language pin(s) in ${PIN_FILE}, each claimed by a fact.`);
} else {
    findings.push(`GROUND: ${PIN_FILE} is gone; the cross-language pins it held are now unclaimed.`);
}

// ── Say it ───────────────────────────────────────────────────────────────────
if (JSON_OUT) {
    const shape = report.map((f) => ({
        id: f.id,
        what: f.what,
        surface: f.surface,
        status: f.status,
        authors: f.authors.map((a) => ({ path: a.path, kind: a.kind })),
        projections: f.projections,
        verification: f.verification.map((v) => ({ path: v.path, how: v.how })),
        digest: f.digest ? f.digest.name : null,
        owed: f.owed ?? null,
    }));
    console.log(JSON.stringify({ facts: shape, findings }, null, 2));
} else {
    const width = Math.max(...report.map((f) => f.id.length));
    for (const f of report) {
        const digest = f.digest ? f.digest.name : '—';
        console.log(`  ${f.id.padEnd(width)}  ${f.status.padEnd(33)} digest: ${digest}`);
    }
    const owed = report.filter((f) => f.owed);
    if (owed.length) {
        console.log(`\n${owed.length} declared gap(s) — work, not permission:`);
        for (const f of owed) console.log(`  ${f.id}: ${f.owed}`);
    }
    for (const n of notes) console.log(`\n${n}`);
    console.log(`\n${generated.length} generated artifact(s), each attributed.`);
}

if (findings.length) {
    console.error(`\ncontract-inventory: ${findings.length} finding(s).`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
}
if (!JSON_OUT) console.log(`\ncontract-inventory: ${FACTS.length} fact(s), every claim held against the tree.`);
