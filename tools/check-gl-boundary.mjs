#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// =============================================================================
// GL boundary guard (RC5)
//
// Enforces the keystone invariant: raw OpenGL/WebGL calls (`glXxx(...)`) may
// appear ONLY in the single backend implementation (renderer/GLDevice.cpp).
// Every other translation unit must reach the GPU through GfxDevice/StateTracker.
//
// Run: node tools/check-gl-boundary.mjs   (exit 1 on violation)
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/esengine';

// The one file allowed to call gl* — the concrete GfxDevice backend.
const ALLOWED = new Set([
    'src/esengine/renderer/GLDevice.cpp',
]);

// A gl call: `gl` + uppercase letter + identifier + `(`. Does not match `glm::`
// (lowercase m) or `GL_CONSTANT` macros.
const GL_CALL = /\bgl[A-Z]\w*\s*\(/;
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
        if (GL_CALL.test(line)) {
            violations.push(`  ${rel}:${i + 1}: ${line.trim()}`);
        }
    });
}

if (violations.length > 0) {
    console.error('GL boundary violation — raw gl* calls must live only in GLDevice.cpp:\n');
    console.error(violations.join('\n'));
    console.error(`\n${violations.length} violation(s). Route GPU work through GfxDevice / StateTracker.`);
    process.exit(1);
}

console.log('GL boundary OK: no gl* calls outside GLDevice.cpp.');
