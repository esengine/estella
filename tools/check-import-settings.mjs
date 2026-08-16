// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-import-settings.mjs — a declared import setting has a reader.
 *
 * The sibling of check-component-fields, one layer out: an `IMPORTER_SCHEMAS`
 * entry is a knob in the asset inspector, written into every fresh `.meta`, and
 * one nothing reads looks exactly like one that works. A model's `scale` was the
 * first that did anything after being saved; the ones this found had never been
 * read at all.
 *
 * A reader is a file that mentions the key AND the importer block it comes from
 * — `importer?.maxSize`, a `readXxxSettings` destructure, an import that reads
 * its own `.meta`. That pairing is what keeps `Transform.scale` from passing as
 * a reader of a model's `scale`.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join('pipeline', 'src', 'project', 'importSettings.ts');

/**
 * Settings with no reader because the feature behind them is not built. Each
 * entry says what is missing, so the list reads as work rather than permission.
 */
const DECLARED_GAPS = {
    'spine.defaultSkin': 'nothing applies it when a SpineAnimation is created from the asset',
    'dragonbones.defaultArmature': 'nothing applies it when a DragonBonesAnimation is created',
    'dragonbones.defaultAnimation': 'nothing applies it when a DragonBonesAnimation is created',
};

const source = readFileSync(path.join(ROOT, SPECS), 'utf8');

/** type → the keys its schema declares, read off the one file that defines them. */
function schemas() {
    const arrays = new Map();
    for (const match of source.matchAll(/const (\w+): ImporterFieldSpec\[\] = \[([\s\S]*?)\n\];/g)) {
        arrays.set(match[1], [...match[2].matchAll(/key: '([^']+)'/g)].map((m) => m[1]));
    }
    const table = source.match(/IMPORTER_SCHEMAS: Record<string, ImporterFieldSpec\[\]> = \{([\s\S]*?)\n\};/);
    const out = new Map();
    for (const [, type, name] of (table?.[1] ?? '').matchAll(/(\w+): (\w+),/g)) {
        out.set(type, arrays.get(name) ?? []);
    }
    return out;
}

// Every place a setting can be READ: the pipeline (cook + import), the SDK
// (loaders) and the editor. The file that declares them is not a reader.
const files = execFileSync('git', ['ls-files', 'pipeline/src', 'sdk/src', 'desktop/src', 'desktop/electron'],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const readers = files
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('generated') && f !== SPECS.split(path.sep).join('/'))
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'))
    .filter((text) => /\bimporter\b/i.test(text))
    .join('\n');

const problems = [];
const unusedGaps = new Set(Object.keys(DECLARED_GAPS));
let declared = 0;
for (const [type, keys] of schemas()) {
    for (const key of keys) {
        declared++;
        const name = `${type}.${key}`;
        // The leaf of a dotted path is what a reader names (`sliceBorder.left`).
        const leaf = key.slice(key.lastIndexOf('.') + 1);
        if (new RegExp(`[.>'"\\[]${leaf}\\b`).test(readers)) {
            if (DECLARED_GAPS[name]) {
                problems.push(`${name} is listed as a gap but something reads it — drop the entry`);
                unusedGaps.delete(name);
            }
            continue;
        }
        unusedGaps.delete(name);
        if (DECLARED_GAPS[name]) continue;
        problems.push(`${name} has no reader — an import knob that does nothing`);
    }
}
for (const name of unusedGaps) {
    problems.push(`${name} is listed as a gap but is not a setting any more — drop the entry`);
}

if (problems.length) {
    console.error('check-import-settings: a declared import setting has no reader.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nGive it one, remove the setting, or record it in DECLARED_GAPS with what is missing.');
    process.exit(1);
}

console.log(`check-import-settings: ${declared} setting(s) across ${schemas().size} asset type(s)`
    + ` all have a reader; ${Object.keys(DECLARED_GAPS).length} declared gap(s).`);
