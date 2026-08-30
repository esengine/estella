#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-spine-panel.mjs — the spine diagnostic surfaces render facts and
 *        never manufacture them.
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
const CLIP = 'desktop/src/spine/clipComplexity.ts';
const DETAILS = 'desktop/src/panels/Details.tsx';
const FILES = [VIEW, SECTION, HOLDER, REALM, CLIP, DETAILS];

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

/** One function's body, to the next top-level `function` — enough to judge it. */
function component(file, signature) {
    const text = strip(read(file));
    const at = text.indexOf(signature);
    if (at < 0) return null;
    const rest = text.slice(at + signature.length);
    const end = rest.indexOf('\nfunction ');
    return end < 0 ? rest : rest.slice(0, end);
}

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
    {
        rule: 'The clipping scan runs when somebody asks and at no other time. The counted walk IS a clip pass, so a panel that ran it to fill itself in would be paying the exact cost it exists to explain.',
        holds: () => {
            const body = component(DETAILS, 'function SpineClipComplexity');
            if (!body) return 'Details has no SpineClipComplexity section';
            if (/useEffect|useMemo|useLayoutEffect/.test(body)) {
                return 'the clipping section scans from a hook rather than from a click';
            }
            const calls = body.match(/spineClipComplexity\s*\(/g) ?? [];
            return calls.length === 1 ? null
                : `the clipping section scans ${calls.length} time(s) — it may ask once, when asked`;
        },
    },
    {
        rule: 'A clipping scan diagnoses; it does not author. It stores nothing, writes no `.meta`, and proposes no import edit — unlike the culling contract beside it, which is a promise somebody makes.',
        holds: () => {
            const body = component(DETAILS, 'function SpineClipComplexity');
            if (!body) return 'Details has no SpineClipComplexity section';
            const authoring = /\bwrite\s*\(|useAsFixedBounds|removeFixedBounds|setImportSettings/;
            return authoring.test(body) ? 'the clipping section authors an asset' : null;
        },
    },
    {
        rule: 'Clipping notes fire on STRUCTURE, never on size. Nothing here has been calibrated across real projects, so a number crossing a line somebody picked would be an opinion wearing a measurement\'s clothes.',
        holds: () => {
            const text = strip(read(CLIP));
            if (/\b(score|grade|poor|excellent|rating)\b/i.test(text)) {
                return 'the clipping diagnosis grades the asset';
            }
            // A threshold is always a literal. 0 and 1 are structural boundaries
            // — "is there a region", "did it decompose" — and nothing else is.
            const thresholds = [...text.matchAll(/[<>]=?\s*(\d+)/g)]
                .map((m) => Number(m[1])).filter((n) => n > 1);
            return thresholds.length === 0 ? null
                : `the clipping diagnosis compares against ${thresholds.join(', ')} — a threshold, not a structure`;
        },
    },
    {
        rule: 'The scene report never computes a clip budget. Pricing clipping means posing and extracting, so a profiler that did it to explain extraction would be manufacturing the extraction it is explaining.',
        holds: () => {
            for (const file of [VIEW, SECTION, HOLDER]) {
                if (/clipBudget|spineClipComplexity/.test(strip(read(file)))) {
                    return `${file} prices clipping from the scene report`;
                }
            }
            return null;
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
