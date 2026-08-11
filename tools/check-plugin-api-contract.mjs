#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-plugin-api-contract.mjs — the editor plugin API says what it is.
 *
 * The worst state for an extension API is not "unstable" — it is unstated: authors
 * read it as settled, maintainers treat it as internal, and neither finds out
 * until something breaks. 0.50 settles the question the other way (experimental,
 * outside the 1.x contract) and this is what stops that answer from decaying.
 *
 * A verdict decays in one of two ways, so both are checked. It can go MISSING from
 * somewhere a reader looks: the shipped `.d.ts`, the policy, or the docs — three
 * audiences, and a promise absent from one of them is not made. Or it can go
 * INCONSISTENT: the promises the shipped typings offer drift from the ones the
 * policy commits to, which is worse than silence because both look authoritative.
 *
 * So {@link PROMISES} is the one list, and each entry must be findable in all
 * three places.
 *
 *   node tools/check-plugin-api-contract.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the verdict has to hold, who reads each one, and the passage it has to
 * hold IN. Scoping is load-bearing: VERSIONING.md already promises "at least one
 * MINOR release" about the SDK, so a whole-file search reads the plugin promise as
 * kept by prose about something else.
 */
const SURFACES = {
    typings: {
        path: 'desktop/src/plugins/types.ts',
        who: 'the plugin author, in the .d.ts the editor writes into their project',
        from: /^ \* STABILITY:/m,
        to: /^ \*\/$/m,
    },
    policy: {
        path: 'VERSIONING.md',
        who: 'anyone deciding whether to build on this',
        from: /^## The Editor Plugin API$/m,
        to: /^## /m,
    },
    docs: {
        path: 'docs/astro/src/content/docs/extending/editor-plugins.mdx',
        who: 'a reader of the guide',
        from: /^## What this API promises$/m,
        to: /^## /m,
    },
    docsZh: {
        path: 'docs/astro/src/content/docs/zh-cn/extending/editor-plugins.mdx',
        who: 'a reader of the Chinese guide',
        from: /^## 这套 API 承诺什么$/m,
        to: /^## /m,
    },
};

/**
 * The verdict itself. Two claims, not one: that the tier is experimental, and
 * that this is what places it outside the compatibility contract — a document
 * saying only the first leaves the second to be assumed either way.
 */
const VERDICT = [
    { id: 'tier', of: { typings: /STABILITY: EXPERIMENTAL/, policy: /\*\*experimental\*\*/i, docs: /\*\*experimental(（实验性）)?\*\*/i } },
    {
        id: 'outside-the-contract',
        of: {
            typings: /NOT part of Estella's 1\.x\s+\*?\s*compatibility contract/,
            policy: /not covered by the MAJOR-line promise/,
            docs: /(not part of Estella's 1\.x|Estella 1\.x 的兼容契约)/,
        },
    },
];

/**
 * What is promised in exchange. Each is a real, cheap-to-keep commitment, and
 * each must reach all three audiences — an author who never learns that
 * `engines.editor` protects them reads "experimental" as "unusable".
 */
const PROMISES = [
    {
        id: 'engines-range-honoured',
        says: 'a plugin outside its declared engines.editor range is refused, never half-loaded',
        of: { typings: /engines\.editor/, policy: /`engines\.editor` is honoured/, docs: /engines\.editor/ },
    },
    {
        id: 'breaking-changes-recorded',
        says: 'every breaking change is in the CHANGELOG under an Editor plugin API heading',
        of: { typings: /CHANGELOG under "Editor plugin API"/, policy: /\*\*Editor plugin API\*\* heading/, docs: /Editor plugin\s+\*?\s*API\*?\*?/ },
    },
    {
        id: 'removal-deprecates-first',
        says: 'a contribution point is deprecated for one MINOR before removal',
        of: { typings: /deprecated for one MINOR/, policy: /at least one MINOR release/, docs: /(one minor release|一个次版本)/ },
    },
];

/** A surface's whole text, and just the passage the claims must be made in. */
const whole = {};
const passage = {};
for (const [key, s] of Object.entries(SURFACES)) {
    const text = readFileSync(join(ROOT, s.path), 'utf8').replace(/\r\n?/g, '\n');
    whole[key] = text;
    const start = s.from.exec(text);
    if (!start) { passage[key] = ''; continue; }
    // `to` is sought after the marker, so a heading cannot end its own section;
    // the marker itself is then kept, since it carries the claim in the typings.
    const after = text.slice(start.index + start[0].length);
    const end = s.to.exec(after);
    passage[key] = start[0] + (end ? after.slice(0, end.index) : after);
}

/** Both locales read as `docs`: a claim made in one language only is not published. */
const LOCALES = { docs: ['docs', 'docsZh'] };
const audiences = (surface) => LOCALES[surface] ?? [surface];

const failures = [];

for (const [kind, claims] of [['verdict', VERDICT], ['promise', PROMISES]]) {
    for (const claim of claims) {
        for (const [surface, pattern] of Object.entries(claim.of)) {
            for (const where of audiences(surface)) {
                if (pattern.test(passage[where])) continue;
                failures.push(`${kind} '${claim.id}' is not stated in ${SURFACES[where].path}`
                    + `\n      ${SURFACES[where].who} would not learn it${claim.says ? ` — ${claim.says}` : ''}`);
            }
        }
    }
}

/**
 * The typings ship as TEXT, copied verbatim into the author's project. An import
 * would resolve in our tree and dangle in theirs, so the file being import-free
 * is load-bearing rather than a style preference.
 */
const imports = whole.typings.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b)/.test(l));
for (const [line, l] of imports) {
    failures.push(`${SURFACES.typings.path}:${line} imports — the file ships verbatim as the author's .d.ts, so it must stay self-contained`
        + `\n      ${l.trim()}`);
}

/**
 * `@public` here would be a freeze nothing enforces: the SDK's tiers are backed
 * by a snapshot, a baseline and the freeze bar, and none of those look at this
 * file. Freezing part of this surface means giving it that machinery first.
 */
for (const [i, l] of whole.typings.split('\n').entries()) {
    if (/^\s*\*\s*@public\b/.test(l)) {
        failures.push(`${SURFACES.typings.path}:${i + 1} claims @public — this surface is experimental, and no baseline guard reads this file`);
    }
}

if (failures.length === 0) {
    console.log(`check-plugin-api-contract: the verdict and ${PROMISES.length} promise(s) hold in all ${Object.keys(SURFACES).length} places.`);
    process.exit(0);
}

for (const f of failures) console.error(`  ${f}`);
console.error(`\ncheck-plugin-api-contract: ${failures.length} finding(s).`);
console.error('The editor plugin API is experimental and outside the 1.x contract — every reader has to be told, and told the same thing.');
process.exit(1);
