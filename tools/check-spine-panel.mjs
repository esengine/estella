#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-spine-panel.mjs — the profiler's spine section renders a report
 *        and never becomes a second one.
 *
 * The whole value of the spine diagnostics is that ONE side computes them: the
 * realm that ran the frame. An editor panel that starts a clock, keeps a
 * counter, or holds a rolling window is a second authority about the same frame,
 * and the first thing to go wrong with one is that it disagrees with the thing
 * it is displaying — with no way for a reader to tell which half is lying.
 *
 * That is a boundary, not a preference, so it is frozen here rather than left to
 * whoever edits the panel next. Each rule names the shape a regression takes.
 *
 *   node tools/check-spine-panel.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEW = 'desktop/src/panels/spineDiagnosticsView.ts';
const SECTION = 'desktop/src/panels/SpineDiagnosticsSection.tsx';
const HOLDER = 'desktop/src/engine/spineDiagnosticsStore.ts';
const REALM = 'desktop/src/playHost.ts';
const FILES = [VIEW, SECTION, HOLDER, REALM];

// The panel IS the subject, so an absent editor is refused rather than passed:
// an empty scan finds nothing wrong with nothing. run-gates skips it by
// `needs: 'editor'`; run directly, this says why.
if (!existsSync(path.join(ROOT, 'desktop', 'package.json'))) {
    console.error('check-spine-panel: the editor is not checked out, and its profiler');
    console.error('  panel is the subject of this check.');
    console.error('  git submodule update --init desktop   (private; you need access)');
    process.exit(2);
}
const missing = FILES.filter((f) => !existsSync(path.join(ROOT, f)));
if (missing.length > 0) {
    console.error(`check-spine-panel is stale: ${missing.join(', ')} does not exist.`);
    process.exit(1);
}

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** Comments out, so a rule reads code and not the prose describing it. */
const strip = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/** What the realm's answer to `query { kind: 'spine' }` is made of. */
function realmAnswer() {
    const text = strip(read(REALM));
    const at = text.indexOf('async function spineDiagnostics(');
    if (at < 0) return null;
    // To the next top-level declaration — enough of the body to judge.
    const rest = text.slice(at);
    const end = rest.indexOf('\nwindow.addEventListener');
    return end < 0 ? rest : rest.slice(0, end);
}

const MEASURING = [
    [/\b(performance|Date)\.now\s*\(/, 'reads a clock'],
    [/\+\+|--(?![-])|\+=/, 'accumulates'],
    [/\.push\s*\(/, 'keeps a history'],
    [/\bpercentile\b|\bp95\b\s*[:=]/, 'computes a percentile'],
];

const RULES = [
    {
        rule: 'The spine section renders the realm\'s report. It may not measure: no clock, no counter, no history — the realm that ran the frame already answered all of it.',
        holds: () => {
            const bad = [];
            for (const file of [VIEW, SECTION]) {
                const text = strip(read(file));
                for (const [pattern, what] of MEASURING) {
                    if (pattern.test(text)) bad.push(`${file} ${what}`);
                }
            }
            return bad.length ? bad.join('; ') : null;
        },
    },
    {
        rule: 'The spine section reaches nothing that could answer a question — no realm, no engine host, no profiler. Its whole input is the DTO it is handed, which is what makes every number on screen come from ONE frame of ONE game.',
        holds: () => {
            const reached = [];
            for (const file of [VIEW, SECTION]) {
                for (const m of strip(read(file)).matchAll(/from\s+'([^']+)'/g)) {
                    const spec = m[1];
                    if (/^@\/engine\//.test(spec) || /PerfMonitor|EngineHost|PlayRealm/.test(spec)) {
                        reached.push(`${file} imports ${spec}`);
                    }
                }
            }
            return reached.length ? reached.join('; ') : null;
        },
    },
    {
        rule: 'The realm answers with what the engine reported. It translates asset REFS into the editor\'s vocabulary and computes nothing else — a number the editor derives is a number the game never had.',
        holds: () => {
            const body = realmAnswer();
            if (!body) return 'playHost has no spineDiagnostics() — the realm answers the spine query from somewhere else now';
            if (!/\.diagnostics\(\)/.test(body)) return 'the realm\'s answer no longer comes from Spine.diagnostics()';
            for (const [pattern, what] of MEASURING) {
                if (pattern.test(body)) return `the realm's spine answer ${what}`;
            }
            return null;
        },
    },
    {
        rule: 'Findings route by the PAIR. A spine asset is a skeleton AND the atlas it is drawn with, and the same skeleton under two atlases is two assets — routing on a path would send both to whichever came first.',
        holds: () => {
            const view = strip(read(VIEW));
            if (!/a\.era === f\.assets\[0\]/.test(view)) {
                return 'routableAsset no longer matches the finding to an asset by era';
            }
            const section = strip(read(SECTION));
            return /onOpenAsset\(asset\.pair\)/.test(section)
                ? null : 'the section no longer opens the asset by its pair';
        },
    },
    {
        rule: 'Profiler finds, Inspector fixes. The section routes to an asset and does not author one: scanning and certifying live where the contract is written.',
        holds: () => {
            const section = strip(read(SECTION));
            return /useAsFixedBounds|removeFixedBounds|observedSpineBounds/.test(section)
                ? 'the section authors a culling contract' : null;
        },
    },
];

const findings = [];
for (const { rule, holds } of RULES) {
    const broken = holds();
    if (broken) findings.push(`${broken}\n    the boundary: ${rule}`);
}

if (findings.length === 0) {
    console.log(`check-spine-panel: ${RULES.length} frozen boundaries — the panel renders the realm's report and computes none of it.`);
    process.exit(0);
}
for (const f of findings) console.error(f);
console.error('\nChanging one of these is allowed — with a counterexample. Edit this file and say why.');
process.exit(1);
