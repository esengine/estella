// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-wgsl-twin.mjs — a WGSL twin that writes its own vertex stage
 *        declares everything its fragment stage names.
 *
 * A fragment-only twin is assembled with the domain's canonical vertex stage,
 * and the engine injects the matching `VSOut` and the eight batch texture
 * bindings alongside it. **A twin that writes its own vertex stage gets neither**
 * — the engine cannot know what interface that stage produces — so its fragment
 * stage has to declare the varying struct and every texture it reaches, its own
 * and the ones the injected lighting helpers sample through it.
 *
 * Miss one and nothing says so. The stage is not an error to the parser, and it
 * reaches whoever runs the second backend as "Invalid RenderPipeline", with the
 * log carrying no mention of a shader at all. That has now happened four times:
 * a mesh twin without `t3`, an environment atlas nobody declared, a shadow map
 * the same, and a sky twin that named the `VSOut` from its own vertex block.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARSER = path.join('src', 'esengine', 'resource', 'ShaderParser.cpp');

const parser = readFileSync(path.join(ROOT, PARSER), 'utf8');

/** The injected WGSL, as the shader receives it: raw strings plus literal runs. */
function injectedWgsl() {
    const raws = [...parser.matchAll(/const char\* k\w*WGSL\s*=\s*R"\(([\s\S]*?)\)";/g)].map((m) => m[1]);
    const runs = [...parser.matchAll(/const char\* k\w*WGSL\s*=\s*((?:\s*"(?:[^"\\]|\\.)*"\s*)+);/g)]
        .map((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
            .map((l) => l[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')).join(''));
    return [...raws, ...runs].join('\n');
}

const injected = injectedWgsl();

/** Injected helper → the texture/sampler names its body reaches, directly. */
function helperBindings(source) {
    const out = new Map();
    for (const m of source.matchAll(/\bfn\s+(\w+)\s*\([^)]*\)\s*->[^{]*\{([\s\S]*?)\n\}/g)) {
        const body = m[2];
        const names = new Set([...body.matchAll(/\b([ts]\d+)\b/g)].map((b) => b[1]));
        const calls = new Set([...body.matchAll(/\b(\w+)\s*\(/g)].map((c) => c[1]));
        const prev = out.get(m[1]);
        // Several helpers are defined once per feature branch; a caller may reach
        // either, so what it needs is the union of them.
        if (prev) {
            for (const n of names) prev.names.add(n);
            for (const c of calls) prev.calls.add(c);
        } else {
            out.set(m[1], { names, calls });
        }
    }
    return out;
}

const HELPERS = helperBindings(injected);

/** Everything calling `name` can end up sampling, following calls transitively. */
function bindingsReachedBy(name, seen = new Set()) {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const helper = HELPERS.get(name);
    if (!helper) return new Set();
    const out = new Set(helper.names);
    for (const call of helper.calls) {
        for (const n of bindingsReachedBy(call, seen)) out.add(n);
    }
    return out;
}

const files = execFileSync('git', ['ls-files', '*.esshader'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);

/** `#pragma <stage> wgsl` … `#pragma end` for one stage, or null. */
function wgslStage(text, stage) {
    const m = new RegExp(`^#pragma\\s+${stage}\\s+wgsl\\s*$([\\s\\S]*?)^#pragma\\s+end\\s*$`, 'm').exec(text);
    return m ? m[1] : null;
}

const problems = [];
let checked = 0;

for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
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

    // Textures it samples itself, plus the ones the injected helpers it calls do.
    const needed = new Set([...frag.matchAll(/\b([ts]\d+)\b/g)].map((m) => m[1]));
    for (const [, call] of frag.matchAll(/\b(\w+)\s*\(/g)) {
        for (const n of bindingsReachedBy(call)) needed.add(n);
    }
    for (const name of [...needed].sort()) {
        if (declaredBindings.has(name)) continue;
        problems.push(`${file}: the fragment twin reaches \`${name}\` and does not declare it`
            + ' — an injected helper samples it, and only this stage can bind it');
    }
}

if (problems.length > 0) {
    console.error('check-wgsl-twin: a WGSL twin names what nothing declares for it:');
    for (const p of [...new Set(problems)]) console.error(`  ${p}`);
    process.exit(1);
}

console.log(`check-wgsl-twin: ${checked} twin(s) with their own vertex stage declare every`
    + ` struct and texture they reach (${HELPERS.size} injected helpers followed)`);
