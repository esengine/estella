#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/**
 * One-time setup for the bundled emsdk submodule (tools/emsdk): install and
 * activate the pinned Emscripten version so the build's auto-discovery can use
 * it. Run after `git submodule update --init tools/emsdk` on a fresh checkout.
 *
 *   pnpm emsdk:setup
 *
 * This downloads the emscripten toolchain (~GB) into tools/emsdk. If you already
 * have an emsdk elsewhere, you don't need this — set EMSDK=/path/to/emsdk (or
 * drop it at ~/emsdk) and the build will discover it.
 */

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const EMSCRIPTEN_VERSION = '5.0.0';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EMSDK_DIR = path.join(REPO_ROOT, 'tools', 'emsdk');

function log(msg) {
    console.log(`[emsdk:setup] ${msg}`);
}

function run(emsdkCmd, args) {
    log(`emsdk ${args.join(' ')}`);
    const result = spawnSync(emsdkCmd, args, {
        cwd: EMSDK_DIR,
        stdio: 'inherit',
        // emsdk on Windows is a .bat/.ps1; let the shell resolve it.
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        log(`Command failed (exit ${result.status ?? 'signal'}).`);
        process.exit(result.status || 1);
    }
}

function main() {
    if (!existsSync(EMSDK_DIR)) {
        log(`Submodule not found at ${EMSDK_DIR}`);
        log('Run: git submodule update --init tools/emsdk');
        process.exit(1);
    }

    // tools/emsdk/emsdk (POSIX) or tools/emsdk/emsdk.bat (Windows). With shell:true
    // on Windows, the bare name resolves to emsdk.bat from EMSDK_DIR.
    const emsdkCmd = process.platform === 'win32'
        ? 'emsdk.bat'
        : path.join(EMSDK_DIR, 'emsdk');

    run(emsdkCmd, ['install', EMSCRIPTEN_VERSION]);
    run(emsdkCmd, ['activate', EMSCRIPTEN_VERSION]);

    log(`Done. emsdk ${EMSCRIPTEN_VERSION} is activated at tools/emsdk.`);
    log('The build will auto-discover it (no need to source emsdk_env).');
}

main();
