// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-shader-blocks.mjs — the engine's uniform blocks and lighting
 *        helpers say the same thing in all three languages they are written in.
 *
 * A block like LightConstants exists three times: the C++ struct that fills it,
 * the GLSL declaration injected into a shader, and the WGSL twin injected into
 * the other backend's. They are laid out by OFFSET, so a field added to two of
 * them and forgotten in the third is not an error anywhere — every later field
 * is simply read from the wrong bytes, on one backend, and the picture is
 * merely wrong. The lighting helpers around them are written twice for the same
 * reason, and have already drifted in ways only a pixel told anyone about (an
 * RGBM decode missing one multiply; a texture one twin never declared).
 *
 * This holds the shapes together — field order, array lengths, the set of
 * helpers and how many arguments each takes. It cannot prove two expressions
 * compute the same thing; it does catch every drift that is a missing or
 * misplaced NAME, which is what the ones found so far have been.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARSER = path.join('src', 'esengine', 'resource', 'ShaderParser.cpp');

/** Blocks that exist in all three languages, and the C++ header that owns each. */
const BLOCKS = {
    FrameConstants: 'src/esengine/renderer/frame/FrameConstants.hpp',
    TimeConstants: 'src/esengine/renderer/frame/FrameConstants.hpp',
    LightConstants: 'src/esengine/renderer/store/LightConstants.hpp',
};

const parser = readFileSync(path.join(ROOT, PARSER), 'utf8');

/**
 * The headers this compares. Everything else in the parser is a fragment for one
 * shader rather than a face both backends present, and pulling those in would
 * ask a vertex entry point to have a GLSL twin.
 */
const HEADERS = ['kColorHelpers', 'kFrameHeader', 'kTimeHeader', 'kLit2DHeader'];

/**
 * One header's text as the shader receives it: raw strings taken whole,
 * concatenated literals unescaped, so both spellings read the same way.
 */
function headerText(symbol) {
    const at = parser.indexOf(`${symbol} =`);
    if (at < 0) return '';
    const raw = /^\s*R"\(([\s\S]*?)\)";/.exec(parser.slice(at + symbol.length + 2));
    if (raw) return raw[1];

    // Where the DEFINITION ends, not where the first `;` is: these headers are
    // shader source, and half their lines end in one inside a string literal.
    let i = at;
    const out = [];
    while (i < parser.length) {
        const c = parser[i];
        if (c === ';') break;
        if (c === '/' && parser[i + 1] === '/') { i = parser.indexOf('\n', i) + 1 || parser.length; continue; }
        if (c === '"') {
            let j = i + 1;
            let literal = '';
            while (j < parser.length && parser[j] !== '"') {
                if (parser[j] === '\\') { literal += parser[j] + parser[j + 1]; j += 2; continue; }
                literal += parser[j]; j++;
            }
            out.push(literal.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
            i = j + 1;
            continue;
        }
        i++;
    }
    return out.join('');
}

const glslText = HEADERS.map(headerText).join('\n');
const wgslText = HEADERS.map((h) => headerText(`${h}WGSL`)).join('\n');
const text = `${glslText}\n${wgslText}`;
/**
 * Names that differ on purpose, and why. Each entry is one field the languages
 * spell differently; the POSITION is still compared, so a field added to one
 * side and not the other is still caught. Keep this list short — an entry is a
 * disagreement someone decided to keep, not permission to add more.
 */
const ALIASES = {
    // The block holds view * projection; the shaders have called it u_projection
    // since before there was a view, and `.esshader` is a format users write.
    'FrameConstants.viewProjection': 'projection',
};

/**
 * Helpers whose signatures cannot match, and why. A WGSL texture and its sampler
 * are separate arguments; GLSL has one combined sampler. Nothing can close this.
 */
const SIGNATURE_GAPS = {
    sampleNormal: 'WGSL takes the texture and its sampler apart; GLSL has one combined type',
};

/** A field name as the comparison sees it: the `u_` a shader adds is not part of it. */
const bare = (name) => name.replace(/^u_/, '');

/** GLSL: `layout(std140) uniform Name { highp vec4 u_a; Light2D u_b[16]; };` */
function glslBlock(name) {
    const m = new RegExp(`layout\\(std140\\)\\s+uniform\\s+${name}\\s*\\{([^}]*)\\}`, 'm').exec(text);
    if (!m) return null;
    return [...m[1].matchAll(/(\w+)\s*(?:\[(\d+)\])?\s*;/g)]
        .map((f) => `${bare(f[1])}${f[2] ? `[${f[2]}]` : ''}`);
}

/** WGSL: `struct Name { a : vec4f, b : array<T, 16> };` */
function wgslBlock(name) {
    const m = new RegExp(`struct\\s+${name}\\s*\\{([^}]*)\\}`, 'm').exec(text);
    if (!m) return null;
    // Split on the commas BETWEEN fields, which the ones inside `array<T, N>`
    // are not — reading a field as "up to the next comma" loses every length.
    return m[1].split(/,(?![^<]*>)/).map((f) => f.trim()).filter(Boolean).map((f) => {
        const [, name, type] = /^(\w+)\s*:\s*([\s\S]+)$/.exec(f) ?? [];
        if (!name) return '';
        const count = /array\s*<[^,>]+,\s*(\d+)\s*>/.exec(type);
        return `${bare(name)}${count ? `[${count[1]}]` : ''}`;
    }).filter(Boolean);
}

/** C++: `struct Name { glm::vec4 a{...}; GpuLight2D b[16]; };` — comments and all. */
function cppBlock(name, file) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    const m = new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\};`, 'm').exec(source);
    if (!m) return null;
    const body = m[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...body.matchAll(/^\s*(?:glm::)?\w+\s+(\w+)\s*(?:\[([^\]]+)\])?\s*(?:\{[^}]*\})?\s*;/gm)]
        .map((f) => `${bare(f[1])}${f[2] ? `[${f[2]}]` : ''}`);
}

/** `MAX_LIGHTS_2D` and friends, so a C++ array length compares as a number. */
function constants() {
    const out = new Map();
    for (const file of new Set(Object.values(BLOCKS))) {
        const source = readFileSync(path.join(ROOT, file), 'utf8');
        for (const [, k, v] of source.matchAll(/constexpr\s+\w+\s+(\w+)\s*=\s*(\d+)/g)) {
            out.set(k, v);
        }
    }
    return out;
}

const CONSTS = constants();
const resolve = (field) => field.replace(/\[([A-Z_][A-Z_0-9]*)\]/, (m, k) =>
    CONSTS.has(k) ? `[${CONSTS.get(k)}]` : m);

const problems = [];
let checked = 0;

for (const [name, file] of Object.entries(BLOCKS)) {
    const sides = {
        [`${PARSER} (GLSL)`]: glslBlock(name),
        [`${PARSER} (WGSL)`]: wgslBlock(name),
        [file]: cppBlock(name, file)?.map(resolve)
            .map((f) => ALIASES[`${name}.${f.replace(/\[.*/, '')}`]
                ? f.replace(/^[^[]+/, ALIASES[`${name}.${f.replace(/\[.*/, '')}`]) : f),
    };
    const missing = Object.entries(sides).filter(([, v]) => !v || v.length === 0);
    if (missing.length > 0) {
        for (const [where] of missing) problems.push(`${name}: not found in ${where}`);
        continue;
    }
    const [reference, ...rest] = Object.entries(sides);
    for (const [where, fields] of rest) {
        if (fields.join(' ') !== reference[1].join(' ')) {
            problems.push(`${name} differs between ${reference[0]} and ${where}:`
                + `\n      ${reference[1].join(', ')}`
                + `\n      ${fields.join(', ')}`);
        }
    }
    checked += reference[1].length;
}

/**
 * GLSL `highp vec3 name(args)` / WGSL `fn name(args) -> t` → name → the argument
 * count of EVERY definition, since several helpers are defined once per feature
 * branch. Keeping only the last would hide a branch that drifted, and a branch
 * present on one backend and not the other.
 */
function helpers(pattern) {
    const out = new Map();
    for (const m of text.matchAll(pattern)) {
        const args = m[2].trim();
        const counts = out.get(m[1]) ?? [];
        counts.push(args === '' ? 0 : args.split(',').length);
        out.set(m[1], counts.sort());
    }
    return out;
}

const glslFns = helpers(/^\s*(?:highp\s+)?(?:vec[234]|float|mat[234])\s+(\w+)\s*\(([^)]*)\)\s*\{/gm);
const wgslFns = helpers(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*->/g);

const shape = (counts) => counts.length === 1 ? `${counts[0]} argument(s)`
    : `${counts.length} definitions taking ${counts.join('/')} argument(s)`;

for (const [name, args] of glslFns) {
    if (!wgslFns.has(name)) problems.push(`the helper ${name}() is GLSL-only — the WGSL twin has none`);
    else if (wgslFns.get(name).join() !== args.join() && !SIGNATURE_GAPS[name]) {
        problems.push(`${name}(): ${shape(args)} in GLSL, ${shape(wgslFns.get(name))} in WGSL`);
    }
    checked++;
}
for (const name of wgslFns.keys()) {
    if (!glslFns.has(name)) problems.push(`the helper ${name}() is WGSL-only — the GLSL twin has none`);
}

if (problems.length > 0) {
    console.error('check-shader-blocks: the injected shader headers disagree:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}

const declared = Object.keys(ALIASES).length + Object.keys(SIGNATURE_GAPS).length;
console.log(`check-shader-blocks: ${Object.keys(BLOCKS).length} uniform block(s) and`
    + ` ${glslFns.size} lighting helper(s) agree across C++, GLSL and WGSL`
    + ` (${checked} name(s), ${declared} declared difference(s))`);
