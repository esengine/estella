// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-shader-conditionals.mjs — a WGSL twin uses conditionals the
 *        engine can actually resolve.
 *
 * A GLSL stage is preprocessed by the DRIVER, which has a full C preprocessor.
 * A WGSL twin is expanded by the engine (ShaderParser::preprocessWGSL), which
 * understands `#ifdef`, `#ifndef`, `#elif defined(X)`, `#else` and `#endif` —
 * and nothing else. A `#if defined(A) && !defined(B)` there is not an error: the
 * line is emitted verbatim into the WGSL, which then fails to compile, and what
 * reaches anyone is an invalid pipeline with no mention of a shader.
 *
 * The two halves of a file therefore do NOT have the same powers, which is the
 * kind of asymmetry nothing else would state.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = execFileSync('git', ['ls-files', '*.esshader'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);

const problems = [];
let wgslBlocks = 0;
for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    // Every `#pragma <stage> wgsl` block up to its `#pragma end`.
    const blocks = [...text.matchAll(/^#pragma\s+\w+\s+wgsl\s*$([\s\S]*?)^#pragma\s+end\s*$/gm)];
    wgslBlocks += blocks.length;
    for (const block of blocks) {
        const before = text.slice(0, block.index).split('\n').length;
        block[1].split('\n').forEach((line, i) => {
            const lead = line.trim();
            if (!lead.startsWith('#if')) return;
            if (/^#if(def|ndef)\b/.test(lead)) return;
            problems.push(`${file}:${before + i + 1}  ${lead}`);
        });
    }
}

if (problems.length) {
    console.error('check-shader-conditionals: a WGSL block uses a conditional the engine'
        + " does not resolve — it reaches the compiler verbatim.\n");
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nUse nested #ifdef / #ifndef, or #elif defined(X).');
    process.exit(1);
}

console.log(`check-shader-conditionals: ${wgslBlocks} WGSL block(s) across ${files.length}`
    + ' shader(s) — every conditional is one the engine expands.');
