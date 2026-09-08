// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-residency-authority.mjs — existence has one author.
 *
 * Residency decides what is in the world. The moment a second thing can decide
 * it — a renderer that loads a place to draw it, a report that reconciles while
 * reading, gameplay calling loadCell — the answer to "why does this entity
 * exist" stops having one owner, and every lifetime bug after that is a bug
 * about who asked. None of that is stopped by the language, so it is checked.
 *
 *   node tools/check-residency-authority.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESIDENCY = path.join(ROOT, 'sdk', 'src', 'residency');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Who may name the residency resource, and why. A file not here that reaches for
 * it is a second author, which is the whole thing this file exists to refuse.
 */
const MAY_NAME_THE_STREAMER = {
    'sdk/src/core-content.ts': 'the public surface exports it',
    'sdk/src/runtime/runtimeLoader.ts': 'adopts the cooked manifest once the persistent scene is up',
};

const problems = [];
const say = (file, what) => problems.push(`${file}: ${what}`);

// 1. The decision is pure. A module that can reach a loader is a module that can
//    load, and then "which cells should exist" and "bring one in" are one thing.
const cells = read('sdk/src/residency/cells.ts');
const imports = [...cells.matchAll(/^\s*import\b[^;]*;/gm)].map((m) => m[0]);
if (imports.length > 0) {
    say('sdk/src/residency/cells.ts',
        `the residency decision imports ${imports.length} module(s) — it answers from geometry alone`);
}

const streamer = read('sdk/src/residency/WorldStreamer.ts');

// 2. Unloading is a real destroy. A flag looks the same from a camera and is the
//    difference between a place being gone and a place being invisible.
for (const flag of ['sleep(', 'wake(', 'Disabled', 'setEntityVisible', '.visible =']) {
    if (streamer.includes(flag)) {
        say('sdk/src/residency/WorldStreamer.ts',
            `unloading reaches for "${flag}" — a cell leaves by being destroyed, not hidden`);
    }
}

// 3. …and takes what the cell brought. Scene persistence answers a different
//    question, and honouring it here leaves exactly what residency removes.
if (!/keepPersistent:\s*false/.test(streamer)) {
    say('sdk/src/residency/WorldStreamer.ts',
        'a cell is unloaded without keepPersistent: false, so something it brought can survive it');
}

// 4. One author. Everything else may READ the report.
for (const dir of ['sdk/src', 'pipeline/src']) {
    for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (rel.startsWith('sdk/src/residency/')) continue;
        const text = readFileSync(file, 'utf8');
        if (!/\bWorldStreaming\b(?!Source)/.test(text)) continue;
        if (!(rel in MAY_NAME_THE_STREAMER)) {
            say(rel, 'names the residency resource — declare why in MAY_NAME_THE_STREAMER or read the report instead');
        }
    }
}

// 5. One place installs it, so there is one schedule slot residency runs in.
const installs = [...walk(path.join(ROOT, 'sdk', 'src'))].filter((file) =>
    /addSystemToSchedule\([^)]*worldResidencySystem/.test(readFileSync(file, 'utf8')));
if (installs.length !== 1) {
    say('sdk/src', `${installs.length} place(s) schedule the residency system — exactly one may`);
}

// 6b. The editor READS residency and never derives it. A panel classifying a
//     cell from a source's radius is a second author of existence, so the
//     report's lists become a word in ONE editor file.
const DERIVES = /\b(residentCells|preparedCells|loadingCells|unloadingCells)\b/;
const DECIDES = /\b(desiredResidency|distanceToCell)\b/;
const EDITOR_STATE_AUTHOR = 'desktop/src/engine/worldRuntimeStore.ts';
/** Whether the editor half of the rule was read at all. The editor is an
 *  optional submodule, and without it this scanned nothing and still printed
 *  "one reader names it" — a claim about a directory it never opened. */
const editorRead = existsSync(path.join(ROOT, 'desktop', 'src'));
if (editorRead) {
    for (const file of walk(path.join(ROOT, 'desktop', 'src'), /\.tsx?$/)) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const text = readFileSync(file, 'utf8');
        if (DECIDES.test(text)) {
            say(rel, 'runs the residency decision — the editor shows what the streamer decided, it does not decide');
        }
        if (rel !== EDITOR_STATE_AUTHOR && DERIVES.test(text)) {
            say(rel, `reads the report's cell lists directly — import cellState from ${EDITOR_STATE_AUTHOR}`);
        }
    }
    // …and the author has to exist, or the rule above is satisfied by a codebase
    // that dropped the reader entirely.
    if (!existsSync(path.join(ROOT, EDITOR_STATE_AUTHOR))) {
        say(EDITOR_STATE_AUTHOR, 'the editor\'s one residency reader is missing');
    } else if (!DERIVES.test(read(EDITOR_STATE_AUTHOR))) {
        say(EDITOR_STATE_AUTHOR, 'no longer derives a cell state from the report — the rule above now guards nothing');
    }
}

// 6. Reading residency cannot change it. A report that reconciled would make
//    what exists depend on who looked.
const report = read('sdk/src/residency/report.ts');
for (const mutator of ['.update(', '.loadManifest(', '.clear(']) {
    if (report.includes(mutator)) {
        say('sdk/src/residency/report.ts', `the report calls "${mutator}" — reading must not reconcile`);
    }
}

function* walk(dir, match = /\.ts$/) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full, match);
        else if (match.test(entry.name)) yield full;
    }
}

if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`check-residency-authority: ${problems.length} finding(s).`);
    process.exit(1);
}
if (!editorRead) {
    console.log('check-residency-authority: no editor checkout — desktop/src was not scanned,'
        + ' so nothing was judged about who reads the report. The runtime half holds.');
    process.exit(2);
}
console.log('check-residency-authority: one author decides what exists, one reader names it, and unloading destroys.');
