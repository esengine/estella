// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-health-authority.mjs — how much is left has one author.
 *
 * `applyDamage` is the seam a blow lands in, and the reason is that a second
 * subtraction somewhere else makes armour, invulnerability and shields
 * unimplementable: there is no one place to put them. Going back up is the same
 * argument — a respawn that assigned the field itself was the second author, and
 * for as long as it was there "full" meant whatever each caller thought.
 *
 * So: nothing outside Health.ts writes `current`. A game restores through
 * `restoreToFull` and damages through the `Damage` bus, and both land here.
 *
 *   node tools/check-health-authority.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The seam itself, which is where the writes are supposed to be. */
const SEAM = 'sdk/src/gameplay/Health.ts';

/** Source with comments gone: a `//` must not be able to satisfy or trip this. */
const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Assignment to a health `current`. Deliberately shaped around the NAME rather
 * than the type: a checker that resolved types would need the compiler, and the
 * field is spelled the same way in every writer worth catching.
 */
const WRITES = [
    /\bh(?:ealth|p)?\.current\s*(?:=[^=]|[-+*/]=|\+\+|--)/,
    /\.current\s*=\s*[^=]/,
];

/** Which of those lines are about Health rather than some other `.current`. */
const ABOUT_HEALTH = /\bhealth\b|\bHealth\b|\bhp\b/;

/**
 * Second authors that are known and not yet dealt with. Each carries WHY, the
 * same bargain every other declared gap in this repo strikes — and each must
 * still be found, or the note is bookkeeping about code that has moved.
 */
const DECLARED = {
    'examples/celestial-heights/src/systems/save.ts':
        'the flagship carries a health value ACROSS scenes and restores a saved one, '
        + 'which is neither a blow nor a reset to full — it needs a verb this seam '
        + 'does not have yet, and inventing one for it here would be designing a '
        + 'save system from a gate',
};

const problems = [];
const declaredHits = new Set();
const { files } = listTrackedSources(['sdk/src', 'examples', 'templates', 'pipeline/src']);
for (const file of files.filter((f) => /\.ts$/.test(f) && !f.endsWith('.d.ts'))) {
    if (file === SEAM) continue;
    const lines = stripComments(readFileSync(path.join(ROOT, file), 'utf8')).split('\n');
    for (const [i, line] of lines.entries()) {
        if (!WRITES.some((re) => re.test(line))) continue;
        if (!ABOUT_HEALTH.test(line)) continue;
        if (DECLARED[file]) { declaredHits.add(file); continue; }
        problems.push(`${file}:${i + 1} writes a health value outside ${SEAM}`
            + ' — damage goes through the Damage bus, a reset through restoreToFull');
    }
}

// ---- 2. and the author of health authors nothing else --------------------
// The seam writes Health. A restore that also cleared a death flag would own a
// fact the game owns, leaving "am I dead" with two authors.
const seamSrc = stripComments(readFileSync(path.join(ROOT, SEAM), 'utf8'));
for (const m of seamSrc.matchAll(/world\.update\(\s*[^,]+,\s*([A-Za-z_]\w*)/g)) {
    if (m[1] !== 'Health') {
        problems.push(`${SEAM} writes ${m[1]} — this seam owns how much is left and nothing else`);
    }
}

// A declaration that no longer names a real writer is a note about code that has
// moved on, and the next reader trusts it.
for (const file of Object.keys(DECLARED)) {
    if (!declaredHits.has(file)) {
        problems.push(`${file} is declared as a second author and writes nothing — drop the entry`);
    }
}

for (const file of declaredHits) console.log(`  declared: ${file} — ${DECLARED[file]}`);
for (const p of problems) console.log(`✗ ${p}`);
console.log(problems.length === 0
    ? `check-health-authority: ${files.length} file(s) — Health.current is written only in ${SEAM}`
    : `check-health-authority: ${problems.length} finding(s)`);
process.exit(problems.length === 0 ? 0 : 1);
