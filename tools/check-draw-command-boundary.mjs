#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// =============================================================================
// Render-command boundary guard
//
// Enforces the unified-pipeline invariant: DrawCommand assembly and DrawList
// submission may appear ONLY in the single submission face
// (renderer/BatchBuilder.cpp). Every renderer — plugin or direct submit —
// describes its draw as a BatchDrawKey + geometry and produces the command
// through that face; sort/merge/submit stay unified in DrawList.
//
// Run: node tools/check-draw-command-boundary.mjs   (exit 1 on violation)
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/esengine';

// The one translation unit allowed to build + push DrawCommands.
const ALLOWED = new Set([
    'src/esengine/renderer/BatchBuilder.cpp',
]);

// A DrawCommand local/member being assembled (`DrawCommand cmd{...}`, `= DrawCommand{...}`),
// and a command being pushed into the queue. References/params (`const DrawCommand&`) and
// the struct definition itself don't match.
const PATTERNS = [
    [/\bDrawCommand\s+\w+\s*[{;=]/, 'DrawCommand assembly'],
    [/\bdraw_?[lL]ist_?\s*\.\s*push\s*\(/, 'DrawList push'],
];

const SOURCE_EXT = /\.(cpp|cc|cxx|hpp|hxx|h)$/;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (SOURCE_EXT.test(entry)) out.push(p);
    }
    return out;
}

const violations = [];
for (const file of walk(ROOT)) {
    const rel = file.replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        for (const [pattern, what] of PATTERNS) {
            if (pattern.test(line)) {
                violations.push(`  ${rel}:${i + 1}: [${what}] ${line.trim()}`);
            }
        }
    });
}

if (violations.length > 0) {
    console.error('Render-command boundary violation — DrawCommands are built only by BatchBuilder:\n');
    console.error(violations.join('\n'));
    console.error(`\n${violations.length} violation(s). Submit through pushBatchDraw / appendIndexedDraw (renderer/BatchBuilder.hpp).`);
    process.exit(1);
}

console.log('Render-command boundary OK: DrawCommand assembly only in BatchBuilder.cpp.');
