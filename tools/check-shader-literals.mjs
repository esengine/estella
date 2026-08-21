#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/**
 * @file  check-shader-literals.mjs — no embedded twin outgrows MSVC's cap.
 *
 * One string literal may be 16380 bytes; past it MSVC truncates and says C2026
 * at the line the literal ENDS on, nowhere near the function that grew it. The
 * shader twins grow a function at a time, and CI builds no Windows host — so
 * without this the first to know is whoever runs `native --target windows`.
 *
 *   node tools/check-shader-literals.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** MSVC's own number. A literal AT the cap is already truncated, so this is `>=`. */
const MSVC_LIMIT = 16380;
/** Headroom to report on, so a twin lands here before it lands on a compiler. */
const WARN_AT = 0.85;

function sources(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) sources(full, out);
        else if (/\.(cpp|hpp|h)$/.test(name)) out.push(full);
    }
    return out;
}

/** Every raw string literal in `src`, as [name, byteLength, endLine]. */
function literals(src) {
    const out = [];
    const open = /R"\(/g;
    let m;
    while ((m = open.exec(src))) {
        const end = src.indexOf(')"', m.index + 3);
        if (end < 0) continue;
        const body = src.slice(m.index + 3, end);
        const before = src.slice(0, m.index);
        const name = before.match(/(\w+)\s*=\s*$/)?.[1]
            ?? before.match(/(\w+)[^=\w]*$/)?.[1] ?? '(unnamed)';
        out.push([name, Buffer.byteLength(body, 'utf8'), src.slice(0, end).split('\n').length]);
        open.lastIndex = end + 2;
    }
    return out;
}

let over = 0;
let near = 0;
for (const file of sources(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const [name, bytes, line] of literals(readFileSync(file, 'utf8'))) {
        if (bytes >= MSVC_LIMIT) {
            console.error(`✗ ${rel}:${line} — ${name} is ${bytes} bytes; MSVC truncates one literal at `
                + `${MSVC_LIMIT} (C2026). Split it: adjacent literals concatenate with no cap.`);
            over++;
        } else if (bytes >= MSVC_LIMIT * WARN_AT) {
            console.log(`  ${rel}:${line} — ${name} is ${bytes} bytes, `
                + `${MSVC_LIMIT - bytes} short of the cap`);
            near++;
        }
    }
}

if (over) process.exit(1);
console.log(`check-shader-literals: no embedded literal reaches MSVC's ${MSVC_LIMIT}-byte cap`
    + (near ? ` (${near} within ${Math.round((1 - WARN_AT) * 100)}% of it)` : ''));
