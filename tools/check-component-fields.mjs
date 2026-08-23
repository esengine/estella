// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-component-fields.mjs — a declared field has a reader.
 *
 * A component field is a knob in the inspector. One nothing reads is a knob that
 * does nothing, and it looks exactly like one that works: `MeshRenderer.lit` sat there
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
import path from 'node:path';
import { listTrackedSources } from './lib/sourceRoots.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fields with no reader because the feature behind them is not built. Each one is
 * a promise the inspector currently makes and the engine does not keep; the entry
 * says which, so the list reads as work rather than as permission. Empty is the
 * intended state: a field that earns an entry here is work, not permission.
 */
const DECLARED_GAPS = {
    'CacheAsBitmap.enabled': 'the component is declared and nothing renders a subtree to a'
        + ' texture to draw it as one quad — the four fields below are the same gap',
    'CacheAsBitmap.dirty': 'see CacheAsBitmap.enabled',
    'CacheAsBitmap.width': 'see CacheAsBitmap.enabled',
    'CacheAsBitmap.height': 'see CacheAsBitmap.enabled',
};

const components = JSON.parse(
    readFileSync(path.join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json'), 'utf8'),
).components;

// Every source a field can be READ from. Generated files name every field by
// construction, so including them would make this gate vacuous.
//
// `examples` is in the list because some fields exist to be read by a GAME:
// Perception writes what it saw and the engine never looks at it again, so
// judging that one by engine sources alone would call an output a dead knob.
const { files, missing } = listTrackedSources(['src', 'sdk/src', 'desktop/src', 'native', 'plugins', 'examples']);
// A reader this gate cannot see is a field it will call dead. Naming the gap
// beats judging a smaller corpus and printing the same green either way.
if (missing.length) {
    console.log(`check-component-fields: no editor checkout — ${missing.join(', ')} not scanned for readers.`);
}
/** Fields with no reader HERE, which only a checkout that sees the editor can judge. */
const unverified = [];
const sources = files
    .filter((f) => /\.(cpp|hpp|h|ts|tsx)$/.test(f) && !f.includes('generated'))
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'));

/**
 * A reader is a file naming the FIELD and the COMPONENT it belongs to. One
 * concatenated blob let anything anywhere vouch for a common key — the counter
 * `'physics.joints'` read as a reader of `MeshSkin.joints`. Reaching a field
 * means getting its component, so the name is in the same file by construction.
 */
function hasReader(component, key) {
    const spelled = new RegExp(`[.>'"]${key}\\b`);
    return sources.some((text) => text.includes(component) && spelled.test(text));
}

const problems = [];
const unusedGaps = new Set(Object.keys(DECLARED_GAPS));
for (const component of components) {
    for (const field of component.fields ?? []) {
        const name = `${component.name}.${field.key}`;
        // `.key`, `->key`, or the key quoted (a TS projection writes it by name).
        if (hasReader(component.name, field.key)) {
            if (DECLARED_GAPS[name]) {
                problems.push(`${name} is listed as a gap but something reads it — drop the entry`);
                unusedGaps.delete(name);
            }
            continue;
        }
        unusedGaps.delete(name);
        if (DECLARED_GAPS[name]) continue;
        (missing.length ? unverified : problems)
            .push(`${name} has no reader — an inspector knob that does nothing`);
    }
}
for (const name of unusedGaps) {
    problems.push(`${name} is listed as a gap but is not a field any more — drop the entry`);
}

// Without the editor's sources a field whose only reader is the inspector looks
// dead. That is a verdict this checkout cannot reach, not a defect — report it
// and leave the judgement to a run that can see both sides.
if (unverified.length) {
    console.log(`check-component-fields: ${unverified.length} field(s) have no reader in the sources scanned here;`
        + ' an editor checkout is needed to judge them:');
    for (const u of unverified) console.log(`  ${u}`);
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
