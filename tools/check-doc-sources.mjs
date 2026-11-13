#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-doc-sources.mjs
 * @brief   What breaks the manual's build, found without building it: a data file that does not parse, a link with no /docs in front.
 * @details The site is built and its links checked only by the docs workflow, which runs on a release. 0.104.0 published with the
 *          manual not deployed: an apostrophe in one summary of src/data/componentDocs.ts ended its string, and five links were
 *          written from the site's root, where no page lives. Both are a second's reading of the sources.
 *
 * Run: node tools/check-doc-sources.mjs   (exit 1 on a finding)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'docs', 'astro');
const ts = createRequire(path.join(ROOT, 'sdk', 'package.json'))('typescript');
const problems = [];

const walk = (dir, test, out = []) => {
    for (const e of readdirSync(dir)) {
        const full = path.join(dir, e);
        if (statSync(full).isDirectory()) walk(full, test, out);
        else if (test(e)) out.push(full);
    }
    return out;
};
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// The data the pages are built from: hand-written tables a typo in a string takes down whole.
const data = walk(path.join(SITE, 'src', 'data'), (name) => /\.(ts|mjs|js)$/.test(name));
for (const file of data) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
    for (const d of source.parseDiagnostics ?? []) {
        const at = source.getLineAndCharacterOfPosition(d.start ?? 0);
        problems.push(`${rel(file)}:${at.line + 1}:${at.character + 1} does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
}

// Every page is served under /docs: a link written from the root names a page that is not there.
const pages = walk(path.join(SITE, 'src', 'content', 'docs'), (name) => /\.mdx?$/.test(name));
for (const file of pages) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\]\((\/(?!docs\/|\/)[^)\s]*)\)/g)) problems.push(`${rel(file)}:${i + 1} links to ${m[1]}, and every page is under /docs`);
    });
}

if (problems.length > 0) {
    console.error(`check-doc-sources: ${problems.length} finding(s) that fail the manual's build.\n`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`check-doc-sources: ${data.length} data file(s) parse and ${pages.length} page(s) link under /docs.`);
