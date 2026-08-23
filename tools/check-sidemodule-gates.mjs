#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-sidemodule-gates.mjs
 * @brief   A side module's build option must not decide how the core compiles.
 * @details The core links none of these runtimes, so a door one of them opens is
 *          one every other runtime of its kind comes through.
 *
 * Run: node tools/check-sidemodule-gates.mjs   (exit 1 on violation)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/esengine';

/** Options that select which side modules to build — never how the core compiles. */
const SIDE_MODULE_FLAGS = [
    'ES_ENABLE_SPINE',
    'ES_ENABLE_DRAGONBONES',
    'ES_ENABLE_BOX2D',
    'ES_ENABLE_JOLT',
    'ES_ENABLE_BASIS',
];

// A module's own translation units compile only when its option is on, so they
// have nothing to ask — but they are its code, not the core's, and are skipped
// rather than judged.
const MODULE_SOURCES = 'src/esengine/bindings/modules/';

const SOURCE_EXT = /\.(cpp|cc|cxx|hpp|hxx|h)$/;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (SOURCE_EXT.test(entry)) out.push(p);
    }
    return out;
}

const pattern = new RegExp(`\\b(${SIDE_MODULE_FLAGS.join('|')})\\b`);
const violations = [];
for (const file of walk(ROOT)) {
    const rel = file.replace(/\\/g, '/');
    if (rel.startsWith(MODULE_SOURCES)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (pattern.test(line)) violations.push(`  ${rel}:${i + 1}: ${line.trim()}`);
    });
}

if (violations.length > 0) {
    console.error('A side module\'s build option is deciding how the core compiles:\n');
    console.error(violations.join('\n'));
    console.error('\nThe core links none of these runtimes. What they hand it — geometry,'
        + ' a physics world, a transcoded texture — arrives through a door that is'
        + ' always there, so every runtime of that kind can come through it.');
    process.exit(1);
}

console.log(`check-sidemodule-gates: the core compiles one way; ${SIDE_MODULE_FLAGS.length}`
    + ' side-module option(s) decide only what is built beside it.');
