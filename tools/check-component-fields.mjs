// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-component-fields.mjs — a declared field has a reader.
 *
 * A component field is a knob in the inspector. One nothing reads is a knob that
 * does nothing, and it looks exactly like one that works: `Mesh2D.lit` sat there
 * for five bricks while the mesh path picked its shader from the geometry
 * instead, so imported models could not be drawn unlit and geometry without
 * normals could not be lit at all.
 *
 * Reflection and serialization name every field by construction, so those are
 * not readers: the generated code and the scene codec are excluded. What is left
 * is the engine, its side modules, the SDK and the editor — wherever a field can
 * actually change what happens.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fields with no reader because the feature behind them is not built. Each one is
 * a promise the inspector currently makes and the engine does not keep; the entry
 * says which, so the list reads as work rather than as permission. Empty is the
 * intended state: a field that earns an entry here is work, not permission.
 */
const DECLARED_GAPS = {};

const components = JSON.parse(
    readFileSync(path.join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json'), 'utf8'),
).components;

// Every source a field can be READ from. Generated files name every field by
// construction, so including them would make this gate vacuous.
const files = execFileSync('git', ['ls-files', 'src', 'sdk/src', 'desktop/src', 'native', 'plugins'],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const blob = files
    .filter((f) => /\.(cpp|hpp|h|ts|tsx)$/.test(f) && !f.includes('generated'))
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');

const problems = [];
const unusedGaps = new Set(Object.keys(DECLARED_GAPS));
for (const component of components) {
    for (const field of component.fields ?? []) {
        const name = `${component.name}.${field.key}`;
        // `.key`, `->key`, or the key quoted (a TS projection writes it by name).
        if (new RegExp(`[.>'"]${field.key}\\b`).test(blob)) {
            if (DECLARED_GAPS[name]) {
                problems.push(`${name} is listed as a gap but something reads it — drop the entry`);
                unusedGaps.delete(name);
            }
            continue;
        }
        unusedGaps.delete(name);
        if (DECLARED_GAPS[name]) continue;
        problems.push(`${name} has no reader — an inspector knob that does nothing`);
    }
}
for (const name of unusedGaps) {
    problems.push(`${name} is listed as a gap but is not a field any more — drop the entry`);
}

if (problems.length) {
    console.error('check-component-fields: a declared field has no reader.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nGive it one, remove the field, or record it in DECLARED_GAPS with what is missing.');
    process.exit(1);
}

const fields = components.reduce((n, c) => n + (c.fields?.length ?? 0), 0);
console.log(`check-component-fields: ${fields} field(s) across ${components.length} components`
    + ` all have a reader; ${Object.keys(DECLARED_GAPS).length} declared gap(s).`);
