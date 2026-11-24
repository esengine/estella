// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Emscripten discovery and the process runner for Web and native system compilers.
 */
import { existsSync } from 'node:fs';
import { emccPath } from '../../../build-tools/utils/emscripten.js';
import { spawnTool } from '../../../tools/lib/runTool.mjs';

/** Run the system compiler with stable timestamps on toolchains that support reproducible builds. */
export function runSystemCompiler(
    cmd: string, args: string[], cwd: string,
): Promise<{ code: number; stderr: string }> {
    return new Promise((done) => {
        const env = { ...process.env, SOURCE_DATE_EPOCH: process.env['SOURCE_DATE_EPOCH'] ?? '0' };
        const child = spawnTool(cmd, args, { cwd, env });
        let stderr = '';
        child.stderr?.on('data', (d) => { stderr += String(d); });
        child.on('error', (e) => done({ code: 1, stderr: `${stderr}${e.message}` }));
        child.on('close', (code) => done({ code: code ?? 1, stderr }));
    });
}

export { runSystemCompiler as runEmcc };

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
    // The one discovery, not a second policy: this looked only at EMSDK and the
    // `tools/emsdk` submodule, so a machine whose emsdk lives anywhere else was
    // told it had no compiler while the SDK suite compiled on it all day.
    return emccPath();
}
