// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-native-script-modules.mjs — the SDK's module vocabulary and the
 *        native exporter's answer for it are one list, checked both ways.
 *
 * `sdk/package.json`'s `exports` is what a project may import. Every one of them
 * needs a disposition in tools/nativeScriptModules.mjs, and every disposition
 * needs an export still standing behind it. Either half alone rots: a list of
 * excuses nobody prunes, or a rule that silently stops covering what it names.
 *
 * The failure this exists to prevent is specific. The exporter matched
 * `/^esengine(\/.*)?$/` and handed every match the core global, so a subpath
 * meant "esengine" and its own exports were undefined — found on a phone, four
 * frames into a packaged game, as `cannot read property '_id' of undefined`.
 * A new `./navmesh` would have been swallowed exactly the same way.
 *
 *   node tools/check-native-script-modules.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES, DISPOSITIONS, NATIVE_MODULE_REGISTRY, subpathOf, specifierOf, nativeSubpaths }
    from './nativeScriptModules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'sdk', 'package.json');
const NATIVE_ENTRY = path.join(ROOT, 'sdk', 'src', 'index.native.ts');

const problems = [];
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const published = Object.keys(pkg.exports ?? {});

// 1. Every published subpath has an answer. No default: a new export is RED
//    until somebody decides what it means to a packaged native game.
for (const subpath of published) {
    const specifier = specifierOf(subpath);
    if (!MODULES[specifier]) {
        problems.push(
            `sdk/package.json publishes "${subpath}" and tools/nativeScriptModules.mjs has no `
            + `disposition for "${specifier}".\n`
            + `    Say what a natively packaged game script gets when it imports it — `
            + `${Object.keys(DISPOSITIONS).join(', ')}.`);
    }
}

// 2. Every disposition still names something the SDK publishes.
for (const specifier of Object.keys(MODULES)) {
    const subpath = subpathOf(specifier);
    if (!published.includes(subpath)) {
        problems.push(
            `"${specifier}" has a disposition but sdk/package.json no longer publishes `
            + `"${subpath}" — the rule outlived the module it was written for.`);
    }
}

// 3. A class that owes a reason gives one.
for (const [specifier, m] of Object.entries(MODULES)) {
    const klass = DISPOSITIONS[m.disposition];
    if (!klass) {
        problems.push(`"${specifier}" claims unknown disposition "${m.disposition}".`);
        continue;
    }
    if (m.disposition === 'forbidden-native-script' && !m.why) {
        problems.push(
            `"${specifier}" is forbidden to a native game script and says no why. `
            + `A refusal without a reason is the kind of rule the next person deletes.`);
    }
}

// 5. Every native-subpath has a namespace in the registry the native entry
//    installs. Skipped with a word — not silently — while that entry is being
//    written, since a check that cannot see its subject must say so.
const subs = nativeSubpaths();
if (existsSync(NATIVE_ENTRY)) {
    const entry = readFileSync(NATIVE_ENTRY, 'utf8');
    if (!entry.includes(NATIVE_MODULE_REGISTRY)) {
        console.log(`check-native-script-modules: sdk/src/index.native.ts does not install `
            + `${NATIVE_MODULE_REGISTRY} yet — ${subs.length} native-subpath namespace(s) unchecked.`);
    } else {
        for (const specifier of subs) {
            if (!entry.includes(`'${specifier}'`) && !entry.includes(`"${specifier}"`)) {
                problems.push(
                    `"${specifier}" is a native-subpath and ${NATIVE_MODULE_REGISTRY} does not `
                    + `publish a namespace for it — a game importing it would resolve to nothing.`);
            }
        }
    }
}

if (problems.length) {
    console.error('check-native-script-modules: the module vocabulary and its native answer disagree.\n');
    for (const p of problems) console.error(`  ✗ ${p}\n`);
    process.exit(1);
}

const counts = {};
for (const m of Object.values(MODULES)) counts[m.disposition] = (counts[m.disposition] ?? 0) + 1;
console.log(`check-native-script-modules: ${published.length} published specifier(s), each with a `
    + `disposition — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
