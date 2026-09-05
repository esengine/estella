#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-transform-seam.mjs — the generated editor API announces exactly
 *        the writes that make a composed world transform stale.
 *
 * Composition is scheduled by a staleness epoch, so a producer that writes a
 * Transform's inputs and says nothing is invisible: the world composes once and
 * answers every later question with the first answer. The editor's generated
 * setter was that producer, and nobody saw it — an editor always has a renderer,
 * and something else bumped the epoch every frame.
 *
 * EHT rewrites that file wholesale, so the seam cannot be defended by reviewing a
 * hand edit. Three grounds are compared instead: `Transform.hpp` says which
 * fields are composition INPUT (writable) and which are its OUTPUT (`readonly`),
 * `tools/eht/data.py` says which component announces and with what call, and
 * EditorAPI.generated.cpp says what was emitted.
 *
 * Under-announcing is a false negative. OVER-announcing is the opposite failure
 * and just as real — a hook on every component recomposes the whole world on any
 * edit, and no test of the composition can tell. Both are refused.
 *
 *   node tools/check-transform-seam.mjs   (exit 1 on either)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS_DIR = path.join(ROOT, 'src', 'esengine', 'ecs', 'components');
const GENERATED = path.join(ROOT, 'src', 'esengine', 'bindings', 'EditorAPI.generated.cpp');
const DATA_PY = path.join(ROOT, 'tools', 'eht', 'data.py');

const errors = [];
const fail = (msg) => errors.push(msg);
const read = (p) => readFileSync(p, 'utf8');

// ── What the generator declares ──
// Parsed from the literal rather than restated here: a second table would be a
// second authority, and the one that drifted would be this one.
const hooksBlock = /WRITE_HOOKS\s*:\s*Dict\[str,\s*str\]\s*=\s*\{([^}]*)\}/.exec(read(DATA_PY));
if (!hooksBlock) {
    console.error('check-transform-seam: no WRITE_HOOKS literal in tools/eht/data.py — the generator\'s declaration moved.');
    process.exit(1);
}
const HOOKS = new Map([...hooksBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
if (HOOKS.size === 0) {
    console.error('check-transform-seam: WRITE_HOOKS is empty — nothing announces that a composition went stale.');
    process.exit(1);
}

// ── What the component header says each field IS ──
/** The struct body of `name`, brace-matched from its ES_COMPONENT declaration. */
function structBody(name) {
    for (const file of readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.hpp'))) {
        const text = read(path.join(COMPONENTS_DIR, file));
        const decl = new RegExp(String.raw`ES_COMPONENT\s*\([^)]*\)\s*struct\s+${name}\s*\{`).exec(text);
        if (!decl) continue;
        let depth = 0;
        for (let i = decl.index + decl[0].length - 1; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}' && --depth === 0) {
                return { file: path.relative(ROOT, path.join(COMPONENTS_DIR, file)), body: text.slice(decl.index, i) };
            }
        }
    }
    return null;
}

// Same annotation grammar as the parser EHT itself uses: runs of non-paren chars
// OR whole quoted strings, so a `)` inside a tooltip does not end the list.
const PROPERTY = /ES_PROPERTY\s*\(\s*((?:[^)"]|"[^"]*")*?)\s*\)\s*([^;{=]+?)\s+(\w+)\s*(?:\{|=|;)/g;

/** A component's fields, split the way the composition splits them. */
function classify(name) {
    const found = structBody(name);
    if (!found) return null;
    const inputs = new Set();
    const outputs = new Set();
    for (const m of found.body.matchAll(PROPERTY)) {
        // Quoted values are stripped before looking for a bare key, so a tooltip
        // that happens to contain the word does not annotate anything.
        const keys = m[1].replace(/"[^"]*"/g, '');
        (/\breadonly\b/.test(keys) ? outputs : inputs).add(m[3]);
    }
    return { ...found, inputs, outputs };
}

// ── What the generator emitted ──
const generated = read(GENERATED).split('\n');
const FUNCTION = /^[A-Za-z_][\w:<>&*\s]*\s(editor_\w+)\s*\(/;
const BRANCH = /^\s{4}(?:\}\s*else\s*)?if\s*\((?:comp|name)\s*==\s*"(\w+)"\)/;
const ASSIGN = /\bc\.(\w+)(?:\.\w+)*\s*=[^=]/;
const EMPLACE = /\bemplace<[\w:]*\b(\w+)>/;

/** Every `comp == "X"` arm of every editor_* function, with what it does. */
const branches = [];
let fn = null;
let current = null;
for (const [i, line] of generated.entries()) {
    const f = FUNCTION.exec(line);
    if (f) { fn = f[1]; current = null; continue; }
    if (!fn) continue;
    const b = BRANCH.exec(line);
    if (b) {
        current = { fn, comp: b[1], line: i + 1, assigns: new Set(), emplaces: false, hooks: [] };
        branches.push(current);
        continue;
    }
    if (!current) continue;
    const a = ASSIGN.exec(line);
    if (a) current.assigns.add(a[1]);
    const e = EMPLACE.exec(line);
    if (e && e[1] === current.comp) current.emplaces = true;
    for (const [comp, hook] of HOOKS) if (line.includes(hook.trim())) current.hooks.push(comp);
}

// ── The three, against each other ──
for (const [comp, hook] of HOOKS) {
    const fields = classify(comp);
    if (!fields) { fail(`WRITE_HOOKS names "${comp}", which declares no ES_COMPONENT struct under ${path.relative(ROOT, COMPONENTS_DIR)}.`); continue; }
    if (fields.inputs.size === 0) fail(`${comp} has no writable field, so a write hook on it announces nothing (${fields.file}).`);
    if (fields.outputs.size === 0) fail(`${comp} has no readonly field, so it composes nothing a hook could make stale (${fields.file}).`);

    // The call has to BE something. A renamed seam leaves a hook string that
    // matches every branch equally well and defends nothing.
    const called = /(\w+)\s*\(\s*\)\s*;/.exec(hook);
    if (!called) fail(`the hook for ${comp} is not a call: ${hook}`);
    else if (!new RegExp(String.raw`\b${called[1]}\s*\(`).test(read(path.join(ROOT, 'src', 'esengine', 'ecs', 'TransformSystem.hpp')))) {
        fail(`the hook for ${comp} calls ${called[1]}(), which src/esengine/ecs/TransformSystem.hpp does not declare.`);
    }

    for (const b of branches) {
        const writes = b.comp === comp && (b.assigns.size > 0 || b.emplaces);
        const announces = b.hooks.includes(comp);
        if (writes && !announces) {
            fail(`${b.fn} writes ${comp} at EditorAPI.generated.cpp:${b.line} and does not announce it.`);
        }
        if (!writes && announces) {
            fail(`${b.fn}'s "${b.comp}" arm announces ${comp} at EditorAPI.generated.cpp:${b.line} without writing it.`);
        }
        if (b.comp !== comp) continue;
        for (const field of b.assigns) {
            if (fields.outputs.has(field)) fail(`${b.fn} assigns ${comp}.${field}, which is the composition's OUTPUT (EditorAPI.generated.cpp:${b.line}).`);
            else if (!fields.inputs.has(field)) fail(`${b.fn} assigns ${comp}.${field}, which ${fields.file} does not declare as a property (EditorAPI.generated.cpp:${b.line}).`);
        }
    }
}

if (errors.length) {
    console.error('The generated editor API and the composition authority disagree:\n');
    for (const e of errors) console.error(`  ${e}`);
    console.error('\nThe seam is emitted by tools/eht/generators/editor_api.py from WRITE_HOOKS in tools/eht/data.py.');
    console.error('Regenerate with `node build-tools/cli.js eht --no-cache` — the file is never edited by hand.');
    process.exit(1);
}

const announcing = branches.filter((b) => b.hooks.length > 0);
console.log(`transform seam OK: ${HOOKS.size} hooked component(s), ${announcing.length} announcing arm(s) of ${branches.length}.`);
