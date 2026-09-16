// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-shader-conditionals.mjs — a WGSL twin uses conditionals the
 *        engine can actually resolve.
 *
 * A GLSL stage is preprocessed by the DRIVER, which has a full C preprocessor.
 * A WGSL twin is expanded by the engine (ShaderParser::preprocessConditionals), which
 * understands `#ifdef`, `#ifndef`, `#elif defined(X)`, `#else` and `#endif` —
 * and nothing else. A `#if defined(A) && !defined(B)` there is not an error: the
 * line is emitted verbatim into the WGSL, which then fails to compile, and what
 * reaches anyone is an invalid pipeline with no mention of a shader.
 *
 * The two halves of a file therefore do NOT have the same powers, which is the
 * kind of asymmetry nothing else would state.
 *
 * And a second claim, on the same expander: every `#ifdef` closes. An unclosed
 * one swallows the whole rest of the module for the variants that take the dead
 * branch — silently, because this expander does not report one.
 */
import { readFileSync, existsSync } from 'node:fs';
import { corpusRoots, censusFindings, sourceFiles } from './lib/sourceCensus.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
// The census, which spans the submodules holding our source and the files not yet
// tracked: a shader that is NEW is the one whose conditionals nobody has read.
const ROOTS = corpusRoots();
for (const finding of censusFindings(ROOTS)) problems.push(`census: ${finding}`);
const files = ROOTS.flatMap((r) => sourceFiles(r, /\.esshader$/))
    .filter((f) => existsSync(path.join(ROOT, f)));
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

/**
 * The conditional directives of a text, in order, as `{ line, kind }`.
 */
function directives(text, firstLine) {
    const out = [];
    text.split('\n').forEach((raw, i) => {
        const lead = raw.trim();
        if (!lead.startsWith('#if') && !lead.startsWith('#else')
            && !lead.startsWith('#elif') && !lead.startsWith('#endif')) return;
        out.push({ line: firstLine + i, kind: lead.split(/[\s(]/)[0] });
    });
    return out;
}

/** What @p text leaves open, as a list of the lines that opened it. */
function unclosed(text, firstLine) {
    const open = [];
    for (const d of directives(text, firstLine)) {
        if (d.kind === '#ifdef' || d.kind === '#ifndef' || d.kind === '#if') open.push(d.line);
        else if (d.kind === '#endif') open.pop();
    }
    return open;
}

for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const block of text.matchAll(/^#pragma\s+\w+\s+wgsl\s*$([\s\S]*?)^#pragma\s+end\s*$/gm)) {
        const before = text.slice(0, block.index).split('\n').length;
        for (const line of unclosed(block[1], before + 1)) {
            problems.push(`${file}:${line}  opens a conditional this block never closes`);
        }
    }
}

// The stages the engine BUILDS are shader sources too, and they run through the
// same expander. Their conditionals live in C++ string literals, so the text a
// variant sees is not one anybody reads whole.
const BUILDER = 'src/esengine/resource/ShaderParser.cpp';
let builders = 0;
{
    const cpp = readFileSync(path.join(ROOT, BUILDER), 'utf8');
    // Literal contents, by the function that holds them. A hand-rolled scan
    // because a comment on the way may carry a quote of its own.
    for (const fn of cpp.matchAll(/^std::string (\w+)\([^)]*\)\s*\{$([\s\S]*?)^\}$/gm)) {
        let text = '';
        const body = fn[2];
        for (let i = 0; i < body.length; ++i) {
            if (body[i] === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') ++i; continue; }
            if (body[i] !== '"') continue;
            for (++i; i < body.length && body[i] !== '"'; ++i) {
                if (body[i] !== '\\') { text += body[i]; continue; }
                text += body[++i] === 'n' ? '\n' : body[i];
            }
        }
        if (!/#if(def|ndef)?\b/.test(text)) continue;
        ++builders;
        if (unclosed(text, 0).length) {
            problems.push(`${BUILDER} ${fn[1]}() leaves `
                + `${unclosed(text, 0).length} conditional(s) open — every variant that takes`
                + ' the dead branch loses the rest of the stage');
        }
    }
}

if (problems.length) {
    console.error('check-shader-conditionals: a WGSL block uses a conditional the engine'
        + " does not resolve — it reaches the compiler verbatim.\n");
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nUse nested #ifdef / #ifndef, or #elif defined(X), and close every one.');
    process.exit(1);
}

console.log(`check-shader-conditionals: ${wgslBlocks} WGSL block(s) across ${files.length}`
    + ` shader(s) and ${builders} built stage(s) — every conditional is one the engine`
    + ' expands, and every one of them closes.');
