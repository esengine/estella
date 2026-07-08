// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Build the vendored GLSL→SPIR-V converter: configure the pinned
 * third_party/glslang submodule with emscripten, build its static libs, link
 * wrapper.cpp into build-tools/shader-twins/glslang-compile.{mjs,wasm}.
 * One-time (artifact committed); rerun after bumping the submodule.
 *
 *   node tools/glslang-wasm/build.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEmscriptenEnv } from '../../build-tools/utils/emscripten.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GLSLANG = path.join(ROOT, 'third_party', 'glslang');
const BUILD = path.join(ROOT, 'build', 'wasm', 'glslang');
const OUT_DIR = path.join(ROOT, 'build-tools', 'shader-twins');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

await ensureEmscriptenEnv();

if (!existsSync(path.join(GLSLANG, 'CMakeLists.txt'))) {
  throw new Error('third_party/glslang submodule missing — git submodule update --init third_party/glslang');
}

run('emcmake', ['cmake', '-S', GLSLANG, '-B', BUILD, '-G', 'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DENABLE_GLSLANG_BINARIES=OFF',
  '-DENABLE_HLSL=OFF',
  '-DENABLE_OPT=OFF',
  '-DENABLE_SPVREMAPPER=OFF',
  '-DBUILD_TESTING=OFF',
  '-DENABLE_CTEST=OFF',
  '-DBUILD_EXTERNAL=OFF',
  '-DBUILD_SHARED_LIBS=OFF',
]);
run('cmake', ['--build', BUILD]);

// Collect every static lib the build produced (the lib split varies across
// glslang versions: glslang / MachineIndependent / GenericCodeGen / SPIRV /
// OSDependent / default-resource-limits) — link them all, twice, so ordering
// never bites.
const libs = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.a')) libs.push(p);
  }
};
walk(BUILD);
if (libs.length === 0) throw new Error('no static libs found under ' + BUILD);
console.log('linking libs:', libs.map((l) => path.basename(l)).join(', '));

run('emcc', [
  path.join(ROOT, 'tools', 'glslang-wasm', 'wrapper.cpp'),
  ...libs, ...libs,
  '-I', GLSLANG,
  '-O2', '-flto',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node',
  '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=1048576',
  '-sEXPORTED_FUNCTIONS=_es_glslang_initialize,_es_glslang_compile,_es_glslang_spirv_data,_es_glslang_spirv_size,_es_glslang_log,_malloc,_free',
  '-sEXPORTED_RUNTIME_METHODS=cwrap,ccall,HEAPU8,HEAPU32,UTF8ToString',
  '-o', path.join(OUT_DIR, 'glslang-compile.mjs'),
]);

console.log('OK ->', path.join(OUT_DIR, 'glslang-compile.mjs'));
