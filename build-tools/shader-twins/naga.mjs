// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * SPIR-V → WGSL via the vendored naga WASI build (naga-spv2wgsl.wasm) — the
 * converter half of the shader-twin pipeline that needs no Rust toolchain.
 * The wasm is stdin → stdout; node:wasi wires those to file descriptors, so a
 * conversion is a fully in-process, deterministic function of the input bytes.
 * See README.md for provenance and how to rebuild the artifact.
 */
import { closeSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WASM_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'naga-spv2wgsl.wasm');

let modulePromise = null;
function compiledModule() {
  modulePromise ??= WebAssembly.compile(readFileSync(WASM_PATH));
  return modulePromise;
}

/**
 * Convert a SPIR-V file to WGSL text. Throws (with naga's stderr already
 * printed) when parsing/validation/writing fails.
 * @param {string} spvPath   input SPIR-V file
 * @param {string} wgslPath  output WGSL file (created/truncated)
 */
export async function spvFileToWgsl(spvPath, wgslPath) {
  const { WASI } = await import('node:wasi');
  const wasm = await compiledModule();
  const inFd = openSync(spvPath, 'r');
  const outFd = openSync(wgslPath, 'w');
  try {
    // A WASI instance is single-shot (wasi.start runs main once); the compiled
    // module is shared, instantiation per call is cheap.
    const wasi = new WASI({ version: 'preview1', stdin: inFd, stdout: outFd, stderr: 2 });
    const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    const code = wasi.start(instance);
    if (code !== 0) {
      throw new Error(`naga-spv2wgsl exited with ${code} (see stderr above)`);
    }
  } finally {
    closeSync(inFd);
    closeSync(outFd);
  }
}
