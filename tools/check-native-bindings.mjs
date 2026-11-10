#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// =============================================================================
// Native binding codegen pre-flight.
//
// The device build generates its QuickJS entry-point wrappers from a list of
// headers, then compiles the result. Both halves can be wrong about where a
// header lives — the list, and the #include the generator writes into the file
// it emits — and both were, after a reorganisation moved four headers into
// bindings/modules/<name>/. Neither is reachable from any build but the release
// one, so each mistake cost a full Dawn build to discover, one at a time.
//
// The codegen itself needs no compiler and takes a second, so it runs here: the
// headers must exist, the generator must succeed, and every include it writes
// must resolve to a real file.
//
// Run: node tools/check-native-bindings.mjs   (exit 1 on any of the three)
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const BINDINGS = path.join(SRC, 'esengine', 'bindings');

const { NATIVE_BINDING_HEADERS, PHYSX_ALIAS, SPINE_BINDING_HEADER, spineAlias, vendoredSpineVersions } =
    await import('../build-tools/tasks/native.js');

let failed = false;
const fail = (msg) => { console.error(msg); failed = true; };

// 1. Every listed header is where the list says it is.
const abs = NATIVE_BINDING_HEADERS.map((h) => path.join(BINDINGS, h));
for (const [i, p] of abs.entries()) {
    if (!existsSync(p)) fail(`missing header: src/esengine/bindings/${NATIVE_BINDING_HEADERS[i]}`);
}
if (failed) {
    console.error('\nThe list lives in build-tools/tasks/native.js, and its entries are paths under src/esengine/bindings.');
    process.exit(1);
}

// 2. The generator runs.
const out = mkdtempSync(path.join(tmpdir(), 'estella-nfb-'));
const generated = path.join(out, 'NativeFunctionBindings.generated.cpp');
const renames = path.join(out, 'PhysX3DRename.generated.hpp');
const physxWrappers = path.join(out, 'PhysX3DFunctionBindings.generated.cpp');
// `python` is not a command macOS ships; `python3` is. Asking the same resolver
// the build asks is why this gate can run on a developer's machine at all — it
// was CI-only on the belief that it could not.
const { resolvePython } = await import('../build-tools/utils/emscripten.js');
const python = await resolvePython();
if (!python) {
    console.log('check-native-bindings: no Python 3 on PATH — cannot run EHT, so nothing was checked.');
    rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    process.exit(2);
}
try {
    execFileSync(python, [
        path.join(ROOT, 'tools', 'eht.py'),
        '--native-functions', ...abs,
        '--native-functions-output', generated,
        '--native-shim', 'esn_shim.hpp',
        '--native-functions-alias', PHYSX_ALIAS,
        '--native-functions-alias-output', physxWrappers,
        '--native-functions-alias-header', renames,
    ], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
    console.error('EHT failed to generate the native entry-point bindings:');
    console.error(String(e.stderr || e.stdout || e.message));
    rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    process.exit(1);
}

// 3. Every engine include it wrote resolves. (Angle-bracket system headers and
//    the shim are the toolchain's business, not ours.)
const text = readFileSync(generated, 'utf8');
const includes = [...text.matchAll(/^#include\s+"([^"]+)"/gm)].map((m) => m[1])
    .filter((inc) => inc.startsWith('esengine/'));
for (const inc of includes) {
    if (!existsSync(path.join(SRC, inc))) fail(`generated #include does not resolve: ${inc}`);
}

// 4. The PhysX copy of the 3D surface is the whole surface: every physics3d_*
//    wrapper has its physx3d_* twin, and every declared name is renamed (one left
//    out would collide with Jolt's symbol in the host link).
const joltWrapped = new Set([...text.matchAll(/setFunction\(global, "es_physics3d_(\w+)"/g)].map((m) => m[1]));
const physxText = readFileSync(physxWrappers, 'utf8');
if (/es_physx3d_/.test(text)) fail('physx3d_* wrappers leaked into the host TU — they belong in their own (PhysX3DFunctionBindings)');
if (!/^void esn_register_functions_physx3d\(esjs::Val global\)/m.test(physxText)) fail('the PhysX TU has no esn_register_functions_physx3d');
const physxWrapped = new Set([...physxText.matchAll(/setFunction\(global, "es_physx3d_(\w+)"/g)].map((m) => m[1]));
for (const name of joltWrapped) {
    if (!physxWrapped.has(name)) fail(`physics3d_${name} has no physx3d_ twin in the generated wrappers`);
}
if (joltWrapped.size === 0) fail('no physics3d_* wrappers were generated at all');
const renameText = readFileSync(renames, 'utf8');
const header = readFileSync(path.join(BINDINGS, 'modules/physics3d/Physics3DBindings.hpp'), 'utf8');
for (const [, name] of header.matchAll(/\b(physics3d_\w+)\s*\(/g)) {
    if (!renameText.includes(`#define ${name} physx3d_`)) fail(`${name} is not renamed for the PhysX build`);
}

// 5. Every vendored Spine release gets the whole spine_* surface under its own
//    prefix, and nothing of it leaks into the host TU: a host carries them all
//    side by side, so an unrenamed name would bind one release to another's code.
const spineHeader = readFileSync(path.join(BINDINGS, SPINE_BINDING_HEADER), 'utf8');
const spineNames = [...new Set([...spineHeader.matchAll(/(spine_\w+)\s*\(/g)].map((m) => m[1]))];
if (/"es_spine_/.test(text)) fail('unprefixed es_spine_* wrappers leaked into the host TU — every Spine release has its own');
const spineVersions = vendoredSpineVersions(ROOT);
for (const version of spineVersions) {
    const tag = version.replace('.', '');
    const wrappers = path.join(out, `SpineFunctionBindings${tag}.generated.cpp`);
    const rename = path.join(out, `SpineRename${tag}.generated.hpp`);
    try {
        execFileSync(python, [
            path.join(ROOT, 'tools', 'eht.py'),
            '--native-functions', path.join(BINDINGS, SPINE_BINDING_HEADER),
            '--native-shim', 'esn_shim.hpp',
            '--native-functions-alias', spineAlias(version),
            '--native-functions-alias-output', wrappers,
            '--native-functions-alias-header', rename,
        ], { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
        fail(`EHT failed on Spine ${version}: ${String(e.stderr || e.message)}`);
        continue;
    }
    const renameText = readFileSync(rename, 'utf8');
    for (const name of spineNames) {
        if (!renameText.includes(`#define ${name} spine${tag}_`)) fail(`${name} is not renamed for Spine ${version}`);
    }
    if (!readFileSync(wrappers, 'utf8').includes(`\nvoid esn_register_functions_spine${tag}(esjs::Val global) {`)) {
        fail(`the Spine ${version} TU has no esn_register_functions_spine${tag}`);
    }
}
rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

if (failed) process.exit(1);
console.log(`native bindings OK: ${abs.length} headers, ${includes.length} generated include(s) resolve, `
    + `${physxWrapped.size} PhysX twins, ${spineVersions.length} Spine releases.`);
