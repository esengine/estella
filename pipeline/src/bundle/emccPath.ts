// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where emcc is, for the one build step that needs a C compiler.
 *
 * Only the AOT step asks (docs/REARCH_AOT.md): everything else the pipeline
 * builds is JavaScript. A machine without emscripten still exports every project
 * that promised nothing, so this answers `null` rather than throwing — the
 * refusal belongs to the step that knows whether anything was promised.
 *
 * Three places, in the order they are authoritative: what the caller was told
 * (an editor that installed its own toolchain), the environment an emsdk shell
 * exports, and the repo's own submodule for anyone working in the tree.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `emcc` is a .bat on Windows, and spawning it needs the extension. */
const EXE = process.platform === 'win32' ? 'emcc.bat' : 'emcc';

/** The repo root, from this file's own location (pipeline/src/bundle). */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * An absolute path to emcc, or null where this machine has none.
 *
 * `override` wins when given — the caller may know about a toolchain this has no
 * way to find, and passing an explicit path must never be second-guessed.
 */
export function resolveEmcc(override?: string | null): string | null {
    if (override) return existsSync(override) ? override : null;
    const env = process.env['EMCC'];
    if (env && existsSync(env)) return env;
    const emsdk = process.env['EMSDK'];
    if (emsdk) {
        const at = path.join(emsdk, 'upstream', 'emscripten', EXE);
        if (existsSync(at)) return at;
    }
    const local = path.join(REPO, 'tools', 'emsdk', 'upstream', 'emscripten', EXE);
    return existsSync(local) ? local : null;
}
