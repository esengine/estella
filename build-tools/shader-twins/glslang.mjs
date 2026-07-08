// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * GLSL → SPIR-V via the vendored glslang wasm build (glslang-compile.{mjs,wasm})
 * — the compiler half of the shader-twin pipeline, no Vulkan SDK needed. The
 * wrapper mirrors `glslangValidator -V --auto-map-locations` (see
 * tools/glslang-wasm/wrapper.cpp); built from the pinned third_party/glslang
 * submodule by tools/glslang-wasm/build.mjs. See README.md for provenance.
 */

let modulePromise = null;
function loadedModule() {
  modulePromise ??= (async () => {
    const { default: createModule } = await import('./glslang-compile.mjs');
    const m = await createModule();
    if (!m.ccall('es_glslang_initialize', 'number', [], [])) {
      throw new Error('glslang InitializeProcess failed');
    }
    return m;
  })();
  return modulePromise;
}

/**
 * Compile one GLSL stage to SPIR-V bytes.
 * @param {string} source          adapted GLSL (Vulkan semantics dialect)
 * @param {'vert' | 'frag'} stage
 * @returns {Promise<Buffer>}      SPIR-V (copied out of the wasm heap)
 */
export async function glslToSpv(source, stage) {
  const m = await loadedModule();
  const ok = m.ccall('es_glslang_compile', 'number', ['string', 'number'],
    [source, stage === 'vert' ? 0 : 1]);
  if (!ok) {
    const log = m.ccall('es_glslang_log', 'string', [], []);
    throw new Error(`glslang failed for ${stage} stage:\n${log}`);
  }
  const ptr = m.ccall('es_glslang_spirv_data', 'number', [], []);
  const words = m.ccall('es_glslang_spirv_size', 'number', [], []);
  // Copy out: ALLOW_MEMORY_GROWTH can detach heap views on a later call.
  return Buffer.from(new Uint8Array(m.HEAPU8.buffer, ptr, words * 4));
}
