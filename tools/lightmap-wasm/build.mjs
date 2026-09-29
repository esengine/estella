// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Build the lightmap bake kernel into the committed
 *        build-tools/lightmap/lightmap-kernel.{mjs,wasm}. Rerun after editing
 *        kernel.cpp.
 *
 *          node tools/lightmap-wasm/build.mjs
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEmscriptenEnv } from '../../build-tools/utils/emscripten.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'build-tools', 'lightmap', 'lightmap-kernel.mjs');

await ensureEmscriptenEnv();

const EXPORTS = ['_lm_scene', '_lm_direct', '_lm_gather', '_lm_texture_stats', '_malloc', '_free'];

execFileSync('em++', [
  path.join(ROOT, 'tools', 'lightmap-wasm', 'kernel.cpp'),
  '-I', path.join(ROOT, 'third_party', 'stb'),
  '-O3', '-std=c++17', '-msimd128', '-pthread',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node,worker',
  '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=4GB',
  // Workers exist before the first bake, so starting its threads never waits on
  // the event loop the bake is blocking.
  '-sPTHREAD_POOL_SIZE=((typeof navigator!=="undefined"&&navigator.hardwareConcurrency)||8)',
  '-sSTACK_SIZE=1048576',
  `-sEXPORTED_FUNCTIONS=${EXPORTS.join(',')}`,
  '-sEXPORTED_RUNTIME_METHODS=wasmMemory',
  '-o', OUT,
], { stdio: 'inherit', shell: process.platform === 'win32' });

const wasm = OUT.replace(/\.mjs$/, '.wasm');
console.log(`OK -> ${OUT} (${(statSync(wasm).size / 1024).toFixed(0)} KB wasm)`);
