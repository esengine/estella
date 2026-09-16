// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-mesh-instance-record.mjs — the per-object record stays out of the slots.
 *
 * The record a resident mesh is drawn with lives in the frame's texture, read
 * through the `esInstance*` helpers the assembler injects. That is what leaves
 * every attribute slot above the mesh channels free, and it is a property with
 * no compiler behind it: a shader that declares an instance attribute again
 * compiles, draws, and quietly takes the room back.
 *
 * Three claims, because they fail differently:
 *
 *   an instance attribute is declared above the mesh channels
 *       the slots are spent again, and the next mesh channel or custom attribute
 *       has nowhere to go — nothing reports it until one is added
 *   a shader names an `esInstance*` helper the header does not define
 *       GLSL says so at compile; WGSL reports an invalid pipeline that names no
 *       shader, which is how a whole variant goes missing with no message
 *   the record's texels do not fit the record
 *       a part is written past the end of one object and read as the next one's
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
/** The first slot a mesh's own channels may claim — the room this check keeps free. */
const FIRST_FREE_SLOT = 8;

const enums = read(ENUMS);
const constant = (name) => {
    const found = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(enums);
    if (found) return Number(found[1]);
    throw new Error(`${ENUMS} no longer declares ${name}`);
};
const TEXELS = constant('MESH_INSTANCE_TEXELS');
const WIDTH = constant('MESH_INSTANCE_TEXTURE_WIDTH');
const PARTS = {
    MESH_INSTANCE_TEXEL_MODEL: 3,
    MESH_INSTANCE_TEXEL_TINT: 1,
    MESH_INSTANCE_TEXEL_NORMAL: 3,
    MESH_INSTANCE_TEXEL_LIGHTMAP: 1,
};

const problems = [];

// Claim 1: nothing takes the slots back. Both languages, both sources — a
// declaration in either one is a layout the other cannot serve anyway.
for (const file of [SHADER, PARSER]) {
    const text = read(file);
    for (const [, loc, name] of text.matchAll(/layout\(location\s*=\s*(\d+)\)\s*in\s+\w+\s+(\w+)/g)) {
        if (Number(loc) >= FIRST_FREE_SLOT) {
            problems.push(`${file} declares GLSL attribute "${name}" at location ${loc};`
                + ` ${FIRST_FREE_SLOT} and up are free for a mesh's own channels`);
        }
    }
    for (const [, loc, name] of text.matchAll(/@location\((\d+)\)\s+(a_\w+)\s*:/g)) {
        if (Number(loc) >= FIRST_FREE_SLOT) {
            problems.push(`${file} declares WGSL attribute "${name}" at location ${loc};`
                + ` ${FIRST_FREE_SLOT} and up are free for a mesh's own channels`);
        }
    }
}

// Claim 2: every helper a shader reaches for is one the header defines. The
// header is built in PARSER, so its own text answers both halves.
const parser = read(PARSER);
const defined = new Set([
    ...[...parser.matchAll(/highp \w+ (esInstance\w+)\(/g)].map((m) => m[1]),
    ...[...parser.matchAll(/fn (esInstance\w+)\(/g)].map((m) => m[1]),
]);
for (const file of [SHADER, PARSER]) {
    for (const [, name] of read(file).matchAll(/\b(esInstance\w+)\s*\(/g)) {
        if (!defined.has(name)) {
            problems.push(`${file} names ${name}(), which the injected header does not define`);
        }
    }
}
for (const half of ['highp \\w+ (esInstance\\w+)\\(', 'fn (esInstance\\w+)\\(']) {
    const found = new Set([...parser.matchAll(new RegExp(half, 'g'))].map((m) => m[1]));
    const missing = [...defined].filter((n) => !found.has(n));
    if (missing.length) {
        problems.push(`${PARSER} defines ${missing.join(', ')} in one language and not the other`);
    }
}

// Claim 3: the parts fit, do not overlap, and a record never straddles a row.
const occupied = new Map();
for (const [name, span] of Object.entries(PARTS)) {
    const at = constant(name);
    for (let i = at; i < at + span; ++i) {
        if (i >= TEXELS) {
            problems.push(`${name} reaches texel ${i}, past the ${TEXELS} a record holds`);
        }
        const seen = occupied.get(i);
        if (seen) problems.push(`texel ${i} is both ${seen} and ${name}`);
        occupied.set(i, name);
    }
}
if (WIDTH % TEXELS !== 0) {
    problems.push(`MESH_INSTANCE_TEXTURE_WIDTH is ${WIDTH}, not a multiple of the`
        + ` ${TEXELS}-texel record — a record would straddle a row`);
}

if (problems.length) {
    console.error('check-mesh-instance-record: the per-object record is not where it belongs.\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\nThe record is read through the helpers ${PARSER} injects and written by`
        + ` MeshPlugin; ${ENUMS} says what texel each part is at.`);
    process.exit(1);
}

console.log(`check-mesh-instance-record: ${occupied.size} of ${TEXELS} texel(s) spoken for,`
    + ` read through ${defined.size} helper(s) defined in both languages,`
    + ` and no attribute slot from ${FIRST_FREE_SLOT} up is spent on them.`);
