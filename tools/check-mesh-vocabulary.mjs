// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-mesh-vocabulary.mjs — the two halves of the .esmesh vocabulary agree.
 *
 * A channel's semantic IS its shader attribute location, and the number is
 * serialized into every `.esmesh`. It is spelled twice — `MeshChannel` in
 * GfxEnums.hpp for the engine that binds it, and in meshFormat.ts for the
 * importers that write it — because neither half can import the other's
 * language. Nothing else notices when they drift: a file would simply be read
 * with one meaning and drawn with another.
 *
 * MESH_MAX_BONES is here for the same reason and a sharper one: the importer
 * uses it to decide what it can promise, and the renderer uses it to size the
 * block it uploads. A TS copy that grew past the C++ one would produce meshes
 * whose joints index a matrix that was never sent.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CPP = path.join('src', 'esengine', 'renderer', 'rhi', 'GfxEnums.hpp');
const TS = path.join('sdk', 'src', 'asset', 'meshFormat.ts');

const cpp = readFileSync(path.join(ROOT, CPP), 'utf8');
const ts = readFileSync(path.join(ROOT, TS), 'utf8');

/** `enum class <name> : <type> { A = 0, B = 1 };` → Map(name → value). */
function cppEnum(source, name) {
    const body = new RegExp(`enum class ${name}\\s*:[^{]*\\{([^}]*)\\}`, 'm').exec(source);
    if (!body) return null;
    const out = new Map();
    for (const [, key, value] of body[1].matchAll(/^\s*(\w+)\s*=\s*(\d+)\s*,?\s*$/gm)) {
        out.set(key, Number(value));
    }
    return out;
}

/** `export const <name> = { A: 0, B: 1 } as const;` → Map(name → value). */
function tsObject(source, name) {
    const body = new RegExp(`export const ${name} = \\{([^}]*)\\}`, 'm').exec(source);
    if (!body) return null;
    const out = new Map();
    for (const [, key, value] of body[1].matchAll(/^\s*(\w+)\s*:\s*(\d+)\s*,?\s*$/gm)) {
        out.set(key, Number(value));
    }
    return out;
}

const problems = [];
let checked = 0;

for (const name of ['MeshChannel', 'MeshChannelType']) {
    const a = cppEnum(cpp, name);
    const b = tsObject(ts, name);
    if (!a || a.size === 0) { problems.push(`${CPP}: no enum class ${name} found`); continue; }
    if (!b || b.size === 0) { problems.push(`${TS}: no export const ${name} found`); continue; }
    for (const [key, value] of a) {
        if (!b.has(key)) problems.push(`${name}.${key} = ${value} is in C++ and not in TS`);
        else if (b.get(key) !== value) {
            problems.push(`${name}.${key} is ${value} in C++ and ${b.get(key)} in TS`);
        }
        checked++;
    }
    for (const key of b.keys()) {
        if (!a.has(key)) problems.push(`${name}.${key} is in TS and not in C++`);
    }
}

const cppBones = /MESH_MAX_BONES\s*=\s*(\d+)/.exec(cpp);
const tsBones = /MESH_MAX_BONES\s*=\s*(\d+)/.exec(ts);
if (!cppBones) problems.push(`${CPP}: no MESH_MAX_BONES found`);
else if (!tsBones) problems.push(`${TS}: no MESH_MAX_BONES found`);
else if (cppBones[1] !== tsBones[1]) {
    problems.push(`MESH_MAX_BONES is ${cppBones[1]} in C++ and ${tsBones[1]} in TS`);
} else checked++;

if (problems.length > 0) {
    console.error('check-mesh-vocabulary: the engine and the importers disagree about what a'
        + ' .esmesh means:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}

console.log(`check-mesh-vocabulary: ${checked} shared value(s) agree across ${CPP} and ${TS}`);
