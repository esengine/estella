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

const { NATIVE_BINDING_HEADERS } = await import('../build-tools/tasks/native.js');

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
const python = process.env.PYTHON || 'python';
try {
    execFileSync(python, [
        path.join(ROOT, 'tools', 'eht.py'),
        '--native-functions', ...abs,
        '--native-functions-output', generated,
        '--native-shim', 'esn_shim.hpp',
    ], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
    console.error('EHT failed to generate the native entry-point bindings:');
    console.error(String(e.stderr || e.stdout || e.message));
    rmSync(out, { recursive: true, force: true });
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
rmSync(out, { recursive: true, force: true });

if (failed) process.exit(1);
console.log(`native bindings OK: ${abs.length} headers, ${includes.length} generated include(s) resolve.`);
