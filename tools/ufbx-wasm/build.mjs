// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Build the vendored FBX reader — third_party/ufbx plus this directory's
 *        bridge — into the committed build-tools/ufbx/ufbx-load.{mjs,wasm}.
 *        Rerun after updating third_party/ufbx.
 *
 *          node tools/ufbx-wasm/build.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEmscriptenEnv } from '../../build-tools/utils/emscripten.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UFBX = path.join(ROOT, 'third_party', 'ufbx');
const OUT = path.join(ROOT, 'build-tools', 'ufbx', 'ufbx-load.mjs');

await ensureEmscriptenEnv();

if (!existsSync(path.join(UFBX, 'ufbx.c'))) {
  throw new Error(`third_party/ufbx is missing — see ${path.join(UFBX, 'README.md')}`);
}

const EXPORTS = [
  '_es_fbx_load', '_es_fbx_result_data', '_es_fbx_result_size',
  '_es_fbx_error', '_es_fbx_release', '_malloc', '_free',
];

execFileSync('emcc', [
  path.join(UFBX, 'ufbx.c'),
  path.join(ROOT, 'tools', 'ufbx-wasm', 'bridge.c'),
  '-I', UFBX,
  '-O2', '-std=c11',
  // Features nothing here reaches: the importer reads triangles, materials and
  // baked animation. Subdivision and NURBS alone are a third of the binary.
  '-DUFBX_NO_SUBDIVISION', '-DUFBX_NO_TESSELLATION',
  '-DUFBX_NO_GEOMETRY_CACHE', '-DUFBX_NO_FORMAT_OBJ',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node',
  '-sALLOW_MEMORY_GROWTH=1',
  // The FBX parser recurses through the node hierarchy; the emscripten default
  // of 64KB overflows into the heap on a deeply nested rig rather than failing.
  '-sSTACK_SIZE=1048576',
  `-sEXPORTED_FUNCTIONS=${EXPORTS.join(',')}`,
  '-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPU8,UTF8ToString,stringToNewUTF8',
  '-o', OUT,
], { stdio: 'inherit', shell: process.platform === 'win32' });

const wasm = OUT.replace(/\.mjs$/, '.wasm');
console.log(`OK -> ${OUT} (${(statSync(wasm).size / 1024 / 1024).toFixed(2)} MB wasm)`);
