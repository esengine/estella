// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  FBX → the scene blob `pipeline/src/assets/fbxImport.ts` reads, via the
 *        vendored ufbx wasm build (ufbx-load.{mjs,wasm}) — no FBX SDK, no native
 *        module. The blob's shape is defined by tools/ufbx-wasm/bridge.c; this
 *        file only runs it. See README.md for provenance.
 */

let modulePromise = null;

function loadedModule() {
  modulePromise ??= import('./ufbx-load.mjs').then(({ default: createModule }) => createModule());
  return modulePromise;
}

/**
 * Parse one FBX file.
 * @param {Uint8Array} bytes     the `.fbx`, binary or ASCII
 * @param {string} [filename]    what it is called, so relative texture paths resolve
 * @returns {Promise<Uint8Array>} the scene blob, copied out of the wasm heap
 */
export async function readFbxScene(bytes, filename = '') {
  const m = await loadedModule();
  const source = m._malloc(bytes.byteLength);
  const name = m.stringToNewUTF8(filename);
  try {
    m.HEAPU8.set(bytes, source);
    if (!m.ccall('es_fbx_load', 'number', ['number', 'number', 'number'],
      [source, bytes.byteLength, name])) {
      throw new Error(m.ccall('es_fbx_error', 'string', [], []));
    }
    const at = m.ccall('es_fbx_result_data', 'number', [], []);
    const size = m.ccall('es_fbx_result_size', 'number', [], []);
    // Copy out: ALLOW_MEMORY_GROWTH can detach heap views on a later call.
    return new Uint8Array(m.HEAPU8.buffer, at, size).slice();
  } finally {
    m._free(source);
    m._free(name);
    // The blob is the largest thing a load allocates; holding it until the next
    // one would keep a model's worth of memory alive per process.
    m.ccall('es_fbx_release', null, [], []);
  }
}
