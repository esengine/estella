// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-mesh-instance-record.mjs — the per-object record says one thing.
 *
 * The engine appends a per-object record to every resident mesh's layout, and
 * what it contains is written down FOUR times: mesh.esshader declares it in GLSL
 * and again in WGSL, and ShaderParser injects the same pair into a material's
 * mesh variant. ResourceManager builds the layout those four must match. Nothing
 * held them together, and dropping a row from the model matrix meant editing all
 * five by hand — one missed edit reads whatever the driver left in the slot.
 *
 * Two claims, because they fail differently:
 *
 *   the four declarations disagree
 *       a material draws its mesh through a layout built for the other one; the
 *       frame is wrong and no error names the cause
 *   the declarations and MESH_INSTANCE_STRIDE disagree
 *       the record is read past its end, or a part of it is never sent
 *
 * Run: node tools/check-mesh-instance-record.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const SHADER = 'src/esengine/data/shaders/mesh.esshader';
const PARSER = 'src/esengine/resource/ShaderParser.cpp';
const ENUMS = 'src/esengine/renderer/rhi/GfxEnums.hpp';

const enums = read(ENUMS);
const constant = (name) => {
    const found = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(enums);
    if (!found) throw new Error(`${ENUMS} no longer declares ${name}`);
    return Number(found[1]);
};
const FIRST = constant('MESH_INSTANCE_FIRST_LOCATION');
const STRIDE = constant('MESH_INSTANCE_STRIDE');
const STRIDE_LIT = constant('MESH_INSTANCE_STRIDE_LIT');
const LIGHTMAP_BYTES = constant('MESH_INSTANCE_LIGHTMAP_BYTES');

/** Every instance-range attribute a source declares: location → name, per language. */
function declarations(text) {
    const glsl = new Map();
    const wgsl = new Map();
    for (const [, loc, name] of text.matchAll(/layout\(location\s*=\s*(\d+)\)\s*in\s+\w+\s+(\w+)/g)) {
        if (Number(loc) >= FIRST) glsl.set(Number(loc), name);
    }
    for (const [, loc, name] of text.matchAll(/@location\((\d+)\)\s*(\w+)\s*:/g)) {
        if (Number(loc) >= FIRST) wgsl.set(Number(loc), name);
    }
    return { glsl, wgsl };
}

const problems = [];
const sources = { [SHADER]: declarations(read(SHADER)), [PARSER]: declarations(read(PARSER)) };

// All four must name the same thing at the same location. Compared as text so a
// renamed attribute is a finding too: a name is how the twin's reader matches up.
const spellings = new Map();
for (const [file, langs] of Object.entries(sources)) {
    for (const [lang, found] of Object.entries(langs)) {
        for (const [loc, name] of found) {
            const seen = spellings.get(loc);
            if (!seen) { spellings.set(loc, { name, where: `${file} (${lang})` }); continue; }
            if (seen.name !== name) {
                problems.push(`location ${loc} is "${seen.name}" in ${seen.where}`
                    + ` and "${name}" in ${file} (${lang}) — one of them reads the other's bytes`);
            }
        }
    }
}

// Each declaration set must cover the same locations: a part declared in one
// language and not its twin is a backend that draws the record differently.
const every = [...spellings.keys()].sort((a, b) => a - b);
for (const [file, langs] of Object.entries(sources)) {
    for (const [lang, found] of Object.entries(langs)) {
        const missing = every.filter((loc) => !found.has(loc));
        if (missing.length) {
            problems.push(`${file} (${lang}) declares no attribute at location(s) `
                + `${missing.join(', ')}, which the others do`);
        }
    }
}

/**
 * What the declarations add up to, against what the packer sends. Measured by
 * WHERE each part is rather than by how many there are: normals and a bake are
 * each optional, so a count alone cannot say which record a total is of.
 */
const LIGHTMAP = FIRST + 3;
const TINT = FIRST + 4;
const NORMAL_FIRST = FIRST + 5;
const modelRows = every.filter((loc) => loc < LIGHTMAP).length;
const normalRows = every.filter((loc) => loc >= NORMAL_FIRST).length;
const base = modelRows * 16 + 4;
const lit = base + normalRows * 12;
if (!spellings.has(TINT)) {
    problems.push(`no attribute at location ${TINT}, where the record's tint is`);
}
if (base !== STRIDE) {
    problems.push(`${modelRows} model row(s) plus the tint is ${base} bytes, but`
        + ` MESH_INSTANCE_STRIDE is ${STRIDE} — the record is packed to a different shape`
        + ' than it is declared');
}
if (lit !== STRIDE_LIT) {
    problems.push(`with ${normalRows} normal row(s) that is ${lit} bytes, but`
        + ` MESH_INSTANCE_STRIDE_LIT is ${STRIDE_LIT}`);
}
// The bake's rectangle is APPENDED, so its size is all the packer needs to agree
// on: everything before it keeps the offset it had, which is what lets one
// record serve an object with a bake and one without.
if (spellings.has(LIGHTMAP) && LIGHTMAP_BYTES !== 16) {
    problems.push(`location ${LIGHTMAP} declares a vec4 atlas rectangle, which is 16 bytes,`
        + ` but MESH_INSTANCE_LIGHTMAP_BYTES is ${LIGHTMAP_BYTES}`);
}
if (!spellings.has(LIGHTMAP) && LIGHTMAP_BYTES !== 0) {
    problems.push(`MESH_INSTANCE_LIGHTMAP_BYTES is ${LIGHTMAP_BYTES}, but no attribute at`
        + ` location ${LIGHTMAP} carries an atlas rectangle — the bytes are sent and never read`);
}

if (problems.length) {
    console.error('check-mesh-instance-record: the per-object record is described'
        + ' more than one way.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\nIt is declared in ${SHADER} (both languages) and injected by ${PARSER}`
        + ` (both languages); ${ENUMS} says how many bytes it is.`);
    process.exit(1);
}

const bake = spellings.has(LIGHTMAP) ? ` (+${LIGHTMAP_BYTES} where a bake is read)` : '';
console.log(`check-mesh-instance-record: ${every.length} part(s) of the per-object record,`
    + ` spelled the same in all four declarations and adding to ${STRIDE}/${STRIDE_LIT}`
    + ` bytes${bake}.`);
