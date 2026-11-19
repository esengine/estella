// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Build the lightmap bake kernel into the committed
 *        build-tools/lightmap/lightmap-kernel.{mjs,wasm}. Rerun after editing
 *        kernel.cpp.
 *
 *          node tools/lightmap-wasm/build.mjs
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { ensureEmscriptenEnv, runCommand } from '../../build-tools/utils/emscripten.js';
import { ROOT } from '../lib/repo.mjs';

const OUT = path.join(ROOT, 'build-tools', 'lightmap', 'lightmap-kernel.mjs');

await ensureEmscriptenEnv();

const EXPORTS = ['_lm_scene', '_lm_direct', '_lm_gather', '_lm_probes', '_lm_texture_stats',
  '_lm_cache_budget', '_lm_cache_bytes', '_lm_gather_resolved', '_malloc', '_free'];

await runCommand('em++', [
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
]);

const wasm = OUT.replace(/\.mjs$/, '.wasm');
console.log(`OK -> ${OUT} (${(statSync(wasm).size / 1024).toFixed(0)} KB wasm)`);
