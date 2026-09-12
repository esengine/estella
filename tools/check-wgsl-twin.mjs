// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-wgsl-twin.mjs — a WGSL twin that writes its own vertex stage
 *        declares the structs its fragment stage names.
 *
 * A fragment-only twin is assembled with the domain's canonical vertex stage and
 * gets the matching `VSOut` with it. **A twin that writes its own vertex stage
 * gets neither** — the engine cannot know what interface that stage produces —
 * so its fragment stage has to declare the varying struct itself.
 *
 * Miss one and nothing says so. The stage is not an error to the parser, and it
 * reaches whoever runs the second backend as "Invalid RenderPipeline", with the
 * log carrying no mention of a shader at all — which is how a sky twin naming the
 * `VSOut` of its own vertex block cost an afternoon.
 *
 * TEXTURES are not this file's question: a stage's `tN`/`sN` are completed by the
 * assembler from what it reaches, and the backend refuses by name what it cannot
 * complete. See ShaderParser's wgslReachedTextureDecls, WebGPUDevice::createProgram.
 *
 * Not every dual-language shader is a file. The SDK writes some of its own into
 * template literals, and those reach the same parser and the same backend.
 */
import { readFileSync, existsSync } from 'node:fs';
import { corpusRoots, censusFindings, sourceFiles } from './lib/sourceCensus.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Every template literal in `text` that carries shader source, labelled by line. */
function embedded(file, text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '`') continue;
        let j = i + 1;
        while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
        const body = text.slice(i + 1, j);
        if (body.includes('#pragma')) {
            out.push({ label: `${file}:${text.slice(0, i).split('\n').length}`, text: body });
        }
        i = j;
    }
    return out;
}

const problems = [];
const sources = [];
// The census rather than a listing of this repo: it spans the submodules that hold our
// source AND the files not yet tracked, and a shader that is NEW is the one most likely
// to be missing a binding.
const ROOTS = corpusRoots();
for (const finding of censusFindings(ROOTS)) problems.push(`census: ${finding}`);
for (const file of ROOTS.flatMap((r) => sourceFiles(r, /\.(esshader|ts)$/))) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    if (file.endsWith('.esshader')) sources.push({ label: file, text });
    else if (text.includes('#pragma fragment wgsl')) sources.push(...embedded(file, text));
}

/** `#pragma <stage> wgsl` … `#pragma end` for one stage, or null. */
function wgslStage(text, stage) {
    // `full` included: a self-contained stage is the one the assembler does NOT
    // complete, so it is the one this file most has to read.
    const m = new RegExp(`^#pragma\\s+${stage}\\s+wgsl(\\s+full)?\\s*$([\\s\\S]*?)^#pragma\\s+end\\s*$`,
                         'm').exec(text);
    return m ? m[2] : null;
}

let checked = 0;

for (const { label: file, text } of sources) {
    const frag = wgslStage(text, 'fragment');
    // No twin at all, or a fragment-only one: the engine supplies the interface.
    if (!frag || wgslStage(text, 'vertex') === null) continue;
    checked++;

    const declaredStructs = new Set([...frag.matchAll(/\bstruct\s+(\w+)\s*\{/g)].map((m) => m[1]));
    const declaredBindings = new Set([...frag.matchAll(/@binding\(\d+\)\s*var\s+(\w+)\s*:/g)].map((m) => m[1]));

    // A struct named in a signature or a constructor, that this stage does not declare.
    for (const [, name] of frag.matchAll(/:\s*([A-Z]\w*)\s*[),]/g)) {
        if (declaredStructs.has(name) || /^(f32|i32|u32|bool)$/.test(name)) continue;
        if (/^vec[234][fiu]?$|^mat[234]x[234]f$|^array$|^texture_|^sampler$/.test(name)) continue;
        problems.push(`${file}: the fragment twin names \`${name}\` and does not declare it`
            + ' — its own vertex stage means nothing injects one');
    }

}

if (problems.length > 0) {
    console.error('check-wgsl-twin: a WGSL twin names what nothing declares for it:');
    for (const p of [...new Set(problems)]) console.error(`  ${p}`);
    process.exit(1);
}

console.log(`check-wgsl-twin: ${checked} of ${sources.length} twin(s) write their own vertex`
    + ' stage and declare every struct they name (their textures are the assembler\'s,'
    + ' and the backend names what it cannot complete)');
