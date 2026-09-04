// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where emcc is, for the one build step that needs a C compiler.
 *
 * Only the AOT step asks (docs/REARCH_AOT.md): everything else the pipeline
 * builds is JavaScript, and this is the one place an export spawns a process. A
 * machine without emscripten still exports every project that promised nothing,
 * so this answers `null` rather than throwing — the refusal belongs to the step
 * that knows whether anything was promised.
 *
 * Three places, in the order they are authoritative: what the caller was told
 * (an editor that installed its own toolchain), the environment an emsdk shell
 * exports, and the repo's own submodule for anyone working in the tree.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { emccPath } from '../../../build-tools/utils/emscripten.js';

/**
 * Run it. Never rejects: a missing binary is a code and a message, so the step
 * that called it decides what that means. A shell on Windows because emcc is a
 * `.bat` there and nothing else in an export shells out at all.
 */
export function runEmcc(
    cmd: string, args: string[], cwd: string,
): Promise<{ code: number; stderr: string }> {
    return new Promise((done) => {
        const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += String(d); });
        child.on('error', (e) => done({ code: 1, stderr: `${stderr}${e.message}` }));
        child.on('close', (code) => done({ code: code ?? 1, stderr }));
    });
}

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
