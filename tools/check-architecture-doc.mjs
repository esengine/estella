#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-architecture-doc.mjs
 * @brief   The document that says what the engine IS names things that exist.
 * @details `docs/ARCHITECTURE.md` calls itself descriptive of the current code,
 *          and nothing checked that. It drifted for six weeks: it described a 2D
 *          engine shipping only to browsers and WeChat, said the native seam had
 *          been closed by deletion while `native/` was building for three
 *          platforms, and named `Lit2D` and `Light2D` after both were renamed.
 *
 *          Every convention in this repo that survives has a gate. This one takes
 *          the checkable half: every path in a backtick exists, and every code
 *          identifier in a backtick is somewhere in the sources. Prose it cannot
 *          judge, but a doc naming only live symbols is a doc someone maintained.
 *
 *          REARCHITECTURE.md is deliberately NOT a subject: a plan names what does
 *          not exist yet, which is the whole point of it.
 *
 * Run: node tools/check-architecture-doc.mjs   (exit 1 on a dead name)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(ROOT, 'docs', 'ARCHITECTURE.md');

/** Where a name is allowed to live. A symbol anywhere in these is alive. */
const SOURCES = ['src', 'sdk/src', 'native', 'pipeline/src', 'editor-api', 'tools', 'build-tools', 'tests'];
const SOURCE_EXT = /\.(cpp|hpp|h|ts|tsx|mjs|js|json|cmake|txt|py)$/;

/** A bare `foo/` in this doc is a subdirectory of one of these. */
const DIR_ROOTS = ['src/esengine', 'sdk/src', 'docs', '.'];

/**
 * Paths the doc may name that are not in this checkout: the companion plans that
 * are gitignored on purpose, the optional editor, a build output, and a package
 * entry specifier that is not a path at all.
 */
const ABSENT_BY_DESIGN = new Set([
    'REARCH_2D_PARITY.md', 'REARCH_WGSL.md', 'desktop/',
    'dist/index.native.bundled.js',
]);

/**
 * `esengine/<name>` is a package entry specifier, not a path — and the set of them
 * is published, so this reads it rather than keeping a second list. The doc can
 * name a subpath only if the package actually exports one.
 */
const ENTRY_SPECIFIERS = new Set(
    Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf8')).exports)
        .filter((k) => k.startsWith('./'))
        .map((k) => `esengine/${k.slice(2)}`));

/**
 * Names the doc mentions BECAUSE they are gone. Asserted in the other direction:
 * if one comes back, the sentence saying it was deleted has quietly become false.
 */
const GONE = new Set(['getTypeId', 'DynamicComponentPool', 'SchemaComponentPool', 'BatchRenderer2D']);

const SELF = path.join(ROOT, 'tools', 'check-architecture-doc.mjs');

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
        // This file names every dead symbol on purpose; reading it would revive them all.
        if (path.join(dir, e.name) === SELF) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (SOURCE_EXT.test(e.name)) out.push(p);
    }
    return out;
}

const haystack = SOURCES
    .filter((d) => existsSync(path.join(ROOT, d)))
    .flatMap((d) => walk(path.join(ROOT, d)))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

const doc = readFileSync(DOC, 'utf8');
const problems = [];
const lineOf = (index) => doc.slice(0, index).split('\n').length;

for (const m of doc.matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1].trim();
    // A path: what it points at has to be there. Line suffixes are how this repo
    // cites code, and a range of them is still one file.
    if (/^[\w./-]+\/[\w./-]*$/.test(raw) || /^[\w-]+\.(md|ts|mjs|cpp|hpp|json|esshader)$/.test(raw)) {
        const bare = raw.replace(/:[\d,\-\s]+$/, '');
        if (ABSENT_BY_DESIGN.has(bare) || ABSENT_BY_DESIGN.has(`${bare}/`)) continue;
        if (ENTRY_SPECIFIERS.has(bare)) continue;
        if (existsSync(path.join(ROOT, bare))) continue;
        if (DIR_ROOTS.some((r) => existsSync(path.join(ROOT, r, bare)))) continue;
        // A bare filename is cited without its directory all over the doc.
        if (!bare.includes('/') && haystack.includes(bare)) continue;
        problems.push(`${lineOf(m.index)}: \`${raw}\` — no such path`);
        continue;
    }
    // An identifier: CamelCase or snake_case, nothing a sentence would contain.
    const bare = raw.replace(/^[&*]+/, '').replace(/[(<].*$/, '').replace(/^.*::/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(bare)) continue;
    if (!/[a-z][A-Z]|_/.test(bare)) continue;
    if (GONE.has(bare)) continue;
    if (haystack.includes(bare)) continue;
    problems.push(`${lineOf(m.index)}: \`${raw}\` — names nothing in the sources`);
}

// The other direction: a name the doc says is gone, that is back.
for (const name of GONE) {
    if (!doc.includes(name)) {
        problems.push(`GONE lists \`${name}\`, which the doc no longer mentions — drop it from the list`);
    // Declared or called, not merely named: a comment recalling why something went
    // is exactly the trace a deletion leaves behind.
    } else if (new RegExp(`\\b(class|struct|interface|enum|type)\\s+${name}\\b|\\b${name}\\s*[(<]`).test(haystack)) {
        problems.push(`\`${name}\` is in the sources again; the doc says it was removed`);
    }
}

if (problems.length > 0) {
    console.error('docs/ARCHITECTURE.md describes code that is not there:\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nThe file says it is descriptive of the current code. Update it, or'
        + ' move the claim to REARCHITECTURE.md, where a plan belongs.');
    process.exit(1);
}

const names = (doc.match(/`[^`\n]+`/g) ?? []).length;
console.log(`check-architecture-doc: ${names} name(s) in docs/ARCHITECTURE.md — every path exists`
    + ' and every identifier is in the sources.');
