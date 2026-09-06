#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-mesh-provenance.mjs — every path that mints a persistent
 *        MeshHandle has answered how that handle comes back.
 *
 * A MeshHandle outlives the GPU objects realizing it, so a lost device is
 * supposed to be invisible to whoever holds one. That only works if the geometry
 * can be produced a second time, and nothing downstream can work out where from:
 * by the time recovery runs, the producer is long gone and all that is left is a
 * number. So the answer has to be given where the handle is minted, and this
 * gate is what makes giving it unavoidable.
 *
 * Closed in both directions on purpose. Forwards, a new producer that never
 * registered would inherit whatever recovery happens to do — which is how a
 * third minting path arrives already broken. Backwards, a declaration whose
 * producer is gone is worse than no table: it reads as an answered question. A
 * one-way census becomes a graveyard, and a graveyard is what a reader trusts.
 *
 * The third question is whether the table and the code agree: a producer's class
 * here and the MeshRecovery it hands createMesh are the same answer written
 * twice, and recovery acts on the one no person reads.
 *
 * What this gate deliberately does NOT do is let recovery infer the answer at
 * runtime. Missing provenance for a mesh declared recoverable is a defect to be
 * reported, not evidence that the mesh was host-only all along.
 *
 *   node tools/check-mesh-provenance.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESH_PRODUCERS, CLASSES, MINT } from './meshProducers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The engine sources. This gate never reads tools/, so the table below and the
 *  gate's own prose cannot answer it. */
const ROOTS = ['src', 'native'];
const EXTS = new Set(['.cpp', '.hpp', '.h', '.cc']);

function sources(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'third_party' || e.name === 'build' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sources(p, out);
        else if (EXTS.has(path.extname(e.name))) out.push(p);
    }
    return out;
}

/**
 * Comments, string and character literals and preprocessor lines blanked to
 * spaces. Same length as the input, so an index still names a line — and braces
 * inside a comment or a shader string stop moving the scope depth.
 */
function blank(src) {
    const out = src.split('');
    const space = (i) => { if (src[i] !== '\n') out[i] = ' '; };
    let i = 0;
    let lineStart = true;
    while (i < src.length) {
        const c = src[i];
        if (c === '\n') { lineStart = true; i++; continue; }
        if (lineStart && /\s/.test(c)) { i++; continue; }
        if (lineStart && c === '#') {
            while (i < src.length && !(src[i] === '\n' && src[i - 1] !== '\\')) { space(i); i++; }
            continue;
        }
        lineStart = false;
        if (c === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') { space(i); i++; }
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { space(i); i++; }
            space(i); space(i + 1); i += 2;
            continue;
        }
        const raw = /^R"([^("\s]*)\(/.exec(src.slice(i, i + 24));
        if (raw && c === 'R') {
            const end = src.indexOf(`)${raw[1]}"`, i);
            const stop = end < 0 ? src.length : end + raw[1].length + 2;
            while (i < stop) { space(i); i++; }
            continue;
        }
        if (c === '"' || c === "'") {
            space(i); i++;
            while (i < src.length && src[i] !== c) {
                if (src[i] === '\\') { space(i); i++; }
                space(i); i++;
            }
            space(i); i++;
            continue;
        }
        i++;
    }
    return out.join('');
}

const KEYWORD = /^(if|for|while|switch|catch|do|else|return|case|try)\b/;
/** A `{` that opens a function body, as opposed to a namespace, a type, an
 *  initializer or a control-flow block. */
function opensBody(head) {
    if (!head.includes('(')) return false;
    const t = head.replace(/\s+/g, ' ').trim();
    if (KEYWORD.test(t)) return false;
    return /\)(\s*(const|noexcept|override|final|mutable|volatile|&{1,2}))*\s*(->[\w:<>,*&\s]+)?$/.test(t)
        || /\)\s*:\s*[^;]*$/.test(t);
}

/** The function a body's `{` belongs to; null for a lambda, whose calls are
 *  attributed to the function hosting it. */
function bodyName(head) {
    const m = /([A-Za-z_~][A-Za-z0-9_]*(?:\s*::\s*~?[A-Za-z0-9_]+)*)\s*$/
        .exec(head.slice(0, head.indexOf('(')).trim());
    return m ? m[1].replace(/\s+/g, '') : null;
}

const NEEDLES = ['createMesh(', `${MINT.pool}.add(`, 'MeshRecovery::'];

/** Each needle occurrence with the function it sits in. */
function occurrences(code) {
    const found = [];
    const stack = [];
    let head = '';
    let i = 0;
    while (i < code.length) {
        const c = code[i];
        const before = code[i - 1] ?? ' ';
        if (!/[A-Za-z0-9_]/.test(before)) {
            for (const needle of NEEDLES) {
                if (!code.startsWith(needle, i)) continue;
                found.push({
                    index: i,
                    needle,
                    enumName: (/^\w+/.exec(code.slice(i + needle.length)) ?? [])[0] ?? null,
                    fn: stack.find((s) => s.fn)?.fn ?? null,
                    qualifier: (/([A-Za-z_]\w*)\s*::\s*$/.exec(code.slice(Math.max(0, i - 96), i))
                        ?? [])[1] ?? null,
                });
            }
        }
        if (c === '{') { stack.unshift({ fn: opensBody(head) ? bodyName(head) : null }); head = ''; }
        else if (c === '}') { stack.shift(); head = ''; }
        else if (c === ';') head = '';
        else head += c;
        i++;
    }
    return found;
}

const problems = [];
const lineOf = (code, index) => code.slice(0, index).split('\n').length;

for (const p of MESH_PRODUCERS) {
    const spec = CLASSES[p.class];
    if (!spec) { problems.push(`${p.id}: class "${p.class}" is not one this contract defines`); continue; }
    if (!p[spec.owes]) {
        problems.push(`${p.id}: declared ${p.class} and owes a \`${spec.owes}\` — ${spec.means}`);
    }
}

const files = ROOTS.map((r) => path.join(ROOT, r)).filter(existsSync).flatMap((d) => sources(d));
if (files.length === 0) problems.push(`no engine sources under ${ROOTS.join(', ')} — this gate read nothing`);

const declared = new Map(MESH_PRODUCERS.map((p) => [p.id, p]));
/** Producers this run actually found in the sources, for the backwards half. */
const discovered = new Map();
/** The MeshRecovery each function hands createMesh, for the table-vs-code half. */
const policies = new Map();
let mints = 0;

for (const file of files) {
    const rel = path.relative(ROOT, file);
    const code = blank(readFileSync(file, 'utf8'));
    for (const hit of occurrences(code)) {
        const where = `${rel}:${lineOf(code, hit.index)}`;
        if (hit.needle === 'MeshRecovery::') {
            if (hit.fn && hit.enumName) {
                if (!policies.has(hit.fn)) policies.set(hit.fn, []);
                policies.get(hit.fn).push(hit.enumName);
            }
            continue;
        }
        if (hit.needle !== 'createMesh(') {
            mints++;
            if (rel !== MINT.file || hit.fn !== MINT.fn) {
                problems.push(`${where}: ${MINT.pool}.add outside ${MINT.fn} — a MeshHandle`
                    + ` minted here would carry no producer, so nothing could ever say how it`
                    + ` comes back. Identity has one authority.`);
            }
            continue;
        }
        if (hit.qualifier === 'ResourceManager' || hit.fn === MINT.fn) continue;
        if (hit.fn === null) {
            if (rel === MINT.header) continue;
            problems.push(`${where}: a createMesh this gate cannot attribute to a function`
                + ' — it can neither be declared nor cleared, so it is a hole either way');
            continue;
        }
        if (!discovered.has(hit.fn)) discovered.set(hit.fn, { file: rel, where });
        const decl = declared.get(hit.fn);
        if (!decl) {
            problems.push(`${where}: ${hit.fn} mints a persistent MeshHandle and is not in`
                + ' tools/meshProducers.mjs. Declare how a handle it minted survives a device'
                + ` generation — ${Object.keys(CLASSES).join(' or ')}.`);
        } else if (decl.file !== rel) {
            problems.push(`${where}: ${hit.fn} is declared in ${decl.file} and found here`);
        }
    }
}

if (mints === 0) {
    problems.push(`no ${MINT.pool}.add found in ${MINT.file} — either the mesh pool moved or this`
        + ' gate is reading for a shape that no longer exists; it cannot be green either way');
}

for (const p of MESH_PRODUCERS) {
    if (!discovered.has(p.id)) {
        problems.push(`${p.id} is declared ${p.class} in tools/meshProducers.mjs and no longer`
            + ` mints a mesh in ${p.file}. A declaration outliving its producer reads as an`
            + ' answered question; drop the row.');
        continue;
    }
    // The table says one thing and the code hands the engine another: recovery
    // would act on the second, and only the first is ever read by a person.
    const want = CLASSES[p.class]?.policy;
    const said = policies.get(p.id) ?? [];
    if (said.length === 0) {
        problems.push(`${p.id} is declared ${p.class} and names no MeshRecovery where it mints.`
            + ` Hand createMesh MeshRecovery::${want}, so the engine holds the same answer the`
            + ' table does.');
    } else if (said.length > 1 || said[0] !== want) {
        problems.push(`${p.id} is declared ${p.class} (MeshRecovery::${want}) and hands`
            + ` createMesh ${said.map((n) => `MeshRecovery::${n}`).join(', ')}`);
    }
}

if (problems.length > 0) {
    console.error('check-mesh-provenance: a persistent MeshHandle can be minted without saying'
        + ' how it comes back:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}

const byClass = Object.keys(CLASSES)
    .map((c) => `${MESH_PRODUCERS.filter((p) => p.class === c).length} ${c}`)
    .join(', ');
console.log(`check-mesh-provenance: ${MESH_PRODUCERS.length} mesh producer(s) declared and found`
    + ` (${byClass}); ${MINT.pool} is minted only by ${MINT.fn}.`);
