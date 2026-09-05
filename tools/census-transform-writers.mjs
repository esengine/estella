// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Who can change a Transform's local inputs, and who can see them do it.
 *
 * A composed world transform is a function of `position`, `rotation`, `scale`
 * and the hierarchy. Anything that wants to know "has the composition gone
 * stale" needs every producer of those to reach one seam — so the first
 * question is how many producers there are, and which side of the wasm boundary
 * each one is observable from.
 *
 *   node tools/census-transform-writers.mjs
 *
 * Reports; asserts nothing. `worldPosition` and friends are excluded: they are
 * composition OUTPUT, not input.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Producers already understood, and what sees them. A scan finding something
 * outside this list is the point of running it: a new writer nobody classified.
 */
const KNOWN = [
    ['world.set / world.update (TS)', 'ptr setter → wasm heap', 'recordChanged', 'no'],
    ['Query(Mut(Transform)) (TS)', 'ptr setter → wasm heap', 'recordChanged', 'no'],
    ['Web AOT Mut(Transform)', 'compiled code → component address', 'markChanged_', 'no'],
    ['Native AOT Mut(Transform)', 'compiled code → component address', 'markChanged_', 'no'],
    ['setParent (C++)', 'hierarchy + TransformDirty', 'no', 'yes'],
    ['UILayoutSystem (C++)', 'writes position.x/y from Yoga', 'no', 'yes'],
    ['TweenSystem (C++)', 'writes position/scale/rotation', 'no', 'yes'],
    ['physics transform sync (C++)', 'writes local AND composes world itself', 'no', 'yes'],
    ['EditorAPI setField (C++)', 'writes position/rotation/scale', 'no', 'yes'],
];

const FIELDS = String.raw`(position|rotation|scale)`;
/** A write to a local field through something typed `Transform`. */
const WRITE = new RegExp(String.raw`\b(\w+)\s*(?:\.|->)\s*${FIELDS}\s*(?:\.\w+\s*)?=[^=]`);
const OUTPUT = /world(Position|Rotation|Scale)|cachedMatrix_|decomposed_/;
/** Doc comments show the API; they do not write it. */
const COMMENT = /^\s*(\*|\/\/)/;

const { files, missing } = listTrackedSources(['src']);
const cpp = files.filter((f) => /\.(cpp|hpp)$/.test(f));

const hits = [];
for (const rel of cpp) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    const lines = text.split('\n');
    // Names bound to a Transform in this file, so `t->position = …` counts only
    // where `t` is one. Cheap and per-file, which is where these bindings live.
    const bound = new Set();
    for (const line of lines) {
        const m = /\b(\w+)\s*=\s*[^;]*\b(?:get|tryGet|emplace)<(?:ecs::)?Transform>/.exec(line)
            ?? /(?:ecs::)?Transform&\s+(\w+)\s*=/.exec(line)
            ?? /(?:ecs::)?Transform\*\s+(\w+)\s*=/.exec(line);
        if (m) bound.add(m[1]);
    }
    if (bound.size === 0) continue;
    lines.forEach((line, i) => {
        if (OUTPUT.test(line) || COMMENT.test(line)) return;
        const m = WRITE.exec(line);
        if (m && bound.has(m[1])) hits.push({ file: rel, line: i + 1, code: line.trim().slice(0, 84) });
    });
}

const say = (s = '') => console.log(s);
say('');
say('Producers of a Transform\'s LOCAL inputs, and who observes them');
say('');
const w = Math.max(...KNOWN.map((k) => k[0].length));
say(`  ${'producer'.padEnd(w)}  ${'writes through'.padEnd(38)}  TS sees  C++ sees`);
say(`  ${'-'.repeat(w)}  ${'-'.repeat(38)}  -------  --------`);
for (const [who, how, ts, cpp_] of KNOWN) {
    say(`  ${who.padEnd(w)}  ${how.padEnd(38)}  ${ts.padEnd(7)}  ${cpp_}`);
}
say('');
say('  No layer sees all of them. A TS write reaches the component heap through a');
say('  ptr setter and calls no C++; a C++ system writes the same bytes and reports');
say('  nothing to the tracker. An epoch invalidated from either side alone is');
say('  therefore incomplete by construction.');
say('');
say(`  ${hits.length} C++ write site(s) found by scanning ${cpp.length} file(s):`);
for (const h of hits) say(`    ${h.file}:${h.line}  ${h.code}`);
if (missing.length) say(`  NOT scanned: ${missing.join(', ')}`);
say('');
