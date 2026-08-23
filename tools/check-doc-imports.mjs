#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-doc-imports.mjs
 * @brief   Anything the manual imports from the SDK has to be exported by it.
 * @details A reader copies an import line verbatim, so one naming a symbol the
 *          package does not export is a broken first step. `facingFromQuat` was
 *          taught in four pages after the perception rewrite removed it.
 *
 * Run: node tools/check-doc-imports.mjs   (exit 1 on an unexported symbol)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ETC = path.join(ROOT, 'sdk', 'etc');
const DOCS = path.join(ROOT, 'docs', 'astro', 'src', 'content', 'docs');

// The public surface, as the api-surface gate keeps it. Every entry at once: a
// page names the module it imports from, and the snapshots are per entry.
const exported = new Set();
for (const f of readdirSync(ETC)) {
    if (!f.endsWith('.api.md')) continue;
    for (const m of readFileSync(path.join(ETC, f), 'utf8').matchAll(/^## (\w+)/gm)) exported.add(m[1]);
}

function pages(dir, out = []) {
    for (const e of readdirSync(dir)) {
        const p = path.join(dir, e);
        // api-ts is generated FROM the surface, so it cannot disagree with it.
        if (statSync(p).isDirectory()) { if (e !== 'api-ts') pages(p, out); }
        else if (/\.mdx?$/.test(e)) out.push(p);
    }
    return out;
}

const problems = [];
for (const file of pages(DOCS)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](esengine[^'"]*)['"]/g)) {
        for (let name of m[1].split(',')) {
            name = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
            if (!name || !/^[A-Za-z_]\w*$/.test(name)) continue;
            if (exported.has(name)) continue;
            problems.push(`  ${path.relative(ROOT, file)} imports ${name} from '${m[2]}'`);
        }
    }
}

if (problems.length > 0) {
    console.error(`${problems.length} import(s) in the manual name a symbol the SDK does not export:\n`);
    console.error([...new Set(problems)].join('\n'));
    console.error('\nExport it, or teach the name that exists. A reader copies the line.');
    process.exit(1);
}

console.log(`check-doc-imports: every symbol the manual imports is exported (${exported.size} public names).`);
