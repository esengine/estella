#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-spine-lifetimes.mjs — the spine lifetime invariants, frozen.
 *
 * Spine spent four cuts becoming one lifetime model instead of two: an era owns
 * what its preparation acquired, a native skeleton retains the era it was parsed
 * from, and a manager owns which runtime poses an entity. What each of those
 * replaced was a PROTOCOL — "tear the entities down before the scene gives its
 * assets back", "the ref is close enough to name a generation" — and a protocol
 * is exactly what comes back silently.
 *
 * So each invariant is declared here with two things behind it: the judgment
 * that proves it, and where one is cheap, the shape a regression would take. A
 * change to any of them is allowed — with a counterexample, which means editing
 * this file and the judgment it names, not letting either quietly stop meaning
 * what it says.
 *
 *   node tools/check-spine-lifetimes.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RUNTIME = 'sdk/src/spine/SpineRuntime.ts';
const MANAGER = 'sdk/src/spine/SpineManager.ts';
const BATCHES = 'src/esengine/bindings/modules/spine/SkeletalModule.hpp';
const SKELETAL_ENTRIES = [
    'src/esengine/bindings/modules/spine/SpineModuleEntry.cpp',
    'src/esengine/bindings/modules/dragonbones/DragonBonesModuleEntry.cpp',
];
const SRC = 'sdk/src';
const TESTS = 'sdk/tests';

const missing = [RUNTIME, MANAGER, BATCHES, ...SKELETAL_ENTRIES]
    .filter((f) => !existsSync(path.join(ROOT, f)));
if (missing.length) {
    console.error(`check-spine-lifetimes is stale: ${missing.join(', ')} does not exist.`);
    process.exit(1);
}

/** Comments out, so a rule reads code and not the prose describing it. */
const strip = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/** Every `it(...)`/`test(...)` title in the SDK's tests. A judgment named by an
 *  invariant below has to be one of these. */
function judgments() {
    const titles = new Set();
    for (const file of readdirSync(path.join(ROOT, TESTS))) {
        if (!file.endsWith('.test.ts')) continue;
        const text = readFileSync(path.join(ROOT, TESTS, file), 'utf8');
        for (const m of text.matchAll(/\b(?:it|test)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
            titles.add(m[2].replace(/\\'/g, "'"));
        }
    }
    return titles;
}

/** Files under sdk/src that name SpineRuntime, other than itself. */
function runtimeHolders() {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) walk(rel);
            else if (entry.name.endsWith('.ts') && rel !== RUNTIME) {
                if (/\bSpineRuntime\b/.test(strip(read(rel)))) found.push(rel);
            }
        }
    };
    walk(SRC);
    return found;
}

const runtime = strip(read(RUNTIME));
const manager = strip(read(MANAGER));

/**
 * `proof` is the judgment that fails when the invariant does; `holds` is the
 * structural half, where a regression has a shape a reader can grep for.
 */
const INVARIANTS = [
    {
        rule: 'A native residency retains exactly the era it was derived from — never a fresh acquire by name, which after an invalidate resolves to another generation.',
        proof: 'the scene giving its receipt back does not take the page being posed',
        holds: () => (
            !/\bacquire[A-Z]\w*\s*\(/.test(runtime)
                ? /era\.retain\s*\(/.test(runtime)
                    ? null
                    : `${RUNTIME} no longer retains the era it parses from`
                : `${RUNTIME} acquires an asset by name; a runtime must retain the exact era it was handed`
        ),
    },
    {
        rule: 'One residency owns one era retain, whatever the entity count — the refcount already knows when the native object is unneeded.',
        proof: 'one claim per residency, however many entities share it',
        holds: () => (/interface SkeletonResidency[\s\S]*?claim: SpineEraClaim/.test(runtime)
            ? null
            : `${RUNTIME}: the claim is no longer part of a residency`),
    },
    {
        rule: 'An era binding is indivisible: id, value and the right to keep it alive travel together, so no caller can pair one generation\'s identity with another\'s bytes.',
        proof: 'the same skeleton with another atlas is another asset',
        holds: () => (/loadEntity\s*\(\s*entity: Entity,\s*era: SpineEraBinding\s*\)/.test(runtime)
            ? null
            : `${RUNTIME}.loadEntity no longer takes one indivisible era binding`),
    },
    {
        rule: 'Rebinding an entity is commit-after-success: the candidate exists before what it replaces is retired.',
        proof: 'a reload whose skeleton will not parse leaves the entity playing',
        holds: () => {
            const body = runtime.slice(runtime.indexOf('loadEntity('), runtime.indexOf('claimSkeleton_(era: SpineEraBinding)'));
            const created = body.indexOf('createInstance(');
            const retired = body.indexOf('this.removeEntity(entity)');
            return created >= 0 && retired > created
                ? null
                : `${RUNTIME}.loadEntity retires the old binding before the new one exists`;
        },
    },
    {
        rule: 'A frame\'s batch storage outlives the frame: slots are reopened, never destroyed, so what one frame grew into is what the next one writes into.',
        proof: 'a steady pose reallocates nothing after the first frame',
        holds: () => {
            const list = strip(read(BATCHES));
            const reset = list.slice(list.indexOf('void reset()'), list.indexOf('MeshBatch& open('));
            if (/slots_\.(clear|resize|shrink_to_fit)/.test(reset)) {
                return `${BATCHES}: reset() gives the slots back; capacity is scoped to the module, not the frame`;
            }
            const destroyed = SKELETAL_ENTRIES.filter((f) => /batches\.clear\s*\(/.test(strip(read(f))));
            return destroyed.length === 0
                ? null
                : `${destroyed.join(', ')} destroys its batch list per frame rather than reopening it`;
        },
    },
    {
        rule: 'SpineManager is the sole authority for which runtime poses an entity: a runtime can only see its own entities, so nothing else may hold one.',
        proof: 'moving to another spine version leaves nothing behind in the old one',
        holds: () => {
            const holders = runtimeHolders().filter((f) => f !== MANAGER && !f.endsWith('/index.ts'));
            return holders.length === 0
                ? null
                : `${holders.join(', ')} holds a SpineRuntime; entity binding is the manager's`;
        },
    },
];

const titles = judgments();
if (titles.size < 100) {
    console.error(`check-spine-lifetimes: found only ${titles.size} judgment title(s) — the parser no longer matches how they are written.`);
    process.exit(1);
}

const findings = [];
for (const { rule, proof, holds } of INVARIANTS) {
    if (!titles.has(proof)) {
        findings.push(`no judgment named "${proof}" — the invariant it proves is:\n    ${rule}`);
    }
    const broken = holds();
    if (broken) findings.push(`${broken}\n    the invariant: ${rule}`);
}

if (findings.length === 0) {
    console.log(`check-spine-lifetimes: ${INVARIANTS.length} frozen invariant(s), each with the judgment that proves it and the shape a regression would take.`);
    process.exit(0);
}
for (const f of findings) console.error(f);
console.error('\nChanging one of these is allowed — with a counterexample. Edit this file and the judgment it names.');
process.exit(1);
