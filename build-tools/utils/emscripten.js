// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { spawn } from 'child_process';
import fs, { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as logger from './logger.js';

const MIN_EMSCRIPTEN_VERSION = '5.0.0';

// Repo root, derived from this file's location (build-tools/utils/emscripten.js).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Per-machine cache of the resolved emsdk path (gitignored). Lets the next build
// skip the directory scan and pins the choice once discovered.
const EMSDK_CACHE_FILE = path.join(REPO_ROOT, '.emsdk-path');

// An emsdk root is usable if it has an activated emscripten install: the
// `upstream/emscripten` tree (emcc/em++/emcmake) plus the generated `.emscripten`
// config that emcc reads via EM_CONFIG.
function isActivatedEmsdk(root) {
    return !!root
        && existsSync(path.join(root, 'upstream', 'emscripten'))
        && existsSync(path.join(root, '.emscripten'));
}

// emsdk ships its own Node under node/<version>/bin — return the first one.
function firstEmsdkNodeBin(root) {
    const nodeDir = path.join(root, 'node');
    if (!existsSync(nodeDir)) return null;
    for (const ver of fs.readdirSync(nodeDir)) {
        const bin = path.join(nodeDir, ver, 'bin');
        if (existsSync(bin)) return bin;
    }
    return null;
}

// Candidate emsdk roots, highest priority first:
//   1. EMSDK env var (explicit, e.g. a sourced emsdk_env)
//   2. .emsdk-path cache written by a previous discovery
//   3. the tools/emsdk submodule (set up via `pnpm emsdk:setup`)
//   4. common install locations (~/emsdk, drive roots on Windows, /opt on *nix)
function candidateEmsdkRoots() {
    const candidates = [];
    if (process.env.EMSDK) candidates.push(process.env.EMSDK);
    try {
        if (existsSync(EMSDK_CACHE_FILE)) {
            const cached = fs.readFileSync(EMSDK_CACHE_FILE, 'utf8').trim();
            if (cached) candidates.push(cached);
        }
    } catch {
        // unreadable cache is non-fatal — fall through to scanning
    }
    candidates.push(path.join(REPO_ROOT, 'tools', 'emsdk'));
    candidates.push(path.join(os.homedir(), 'emsdk'));
    if (process.platform === 'win32') {
        for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
            candidates.push(`${drive}:\\emsdk`);
        }
    } else {
        candidates.push('/opt/emsdk', '/usr/local/emsdk');
    }
    return candidates;
}

let emsdkActivated = false;

/**
 * Locate an activated emsdk and inject it into this process's environment so
 * `emcc`/`em++`/`emcmake`/`wasm-opt` resolve without the caller having to source
 * `emsdk_env`. Mutates process.env (PATH, EM_CONFIG, EMSDK), which every child
 * spawned via runCommand inherits. Idempotent; returns true once an emsdk is
 * active (either pre-existing on PATH or freshly discovered).
 */
export function ensureEmscriptenEnv() {
    if (emsdkActivated) return true;

    let root = null;
    for (const candidate of candidateEmsdkRoots()) {
        if (isActivatedEmsdk(candidate)) {
            root = path.resolve(candidate);
            break;
        }
    }
    if (!root) return false;

    const emscriptenDir = path.join(root, 'upstream', 'emscripten');
    const binDir = path.join(root, 'upstream', 'bin');
    const nodeBin = firstEmsdkNodeBin(root);
    const additions = [root, emscriptenDir, binDir, nodeBin].filter(existsSync);

    process.env.EMSDK = root;
    process.env.EM_CONFIG = path.join(root, '.emscripten');
    if (nodeBin) {
        process.env.EMSDK_NODE = path.join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node');
    }
    process.env.PATH = additions.join(path.delimiter) + path.delimiter + (process.env.PATH || '');

    try {
        fs.writeFileSync(EMSDK_CACHE_FILE, `${root}\n`);
    } catch {
        // cache is an optimization — a read-only tree is fine
    }

    emsdkActivated = true;
    logger.debug(`Activated emsdk at ${root}`);
    return true;
}

function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

export async function checkEmscripten() {
    // Auto-discover + activate a local emsdk (EMSDK env → .emsdk-path cache →
    // tools/emsdk submodule → common locations) so `emcc` resolves even when the
    // caller never sourced emsdk_env. No-op if emsdk is already on PATH.
    ensureEmscriptenEnv();
    try {
        const result = await runCommand('emcc', ['--version'], { silent: true });
        const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
        if (!versionMatch) {
            logger.error('Could not determine Emscripten version.');
            return false;
        }

        const version = versionMatch[1];
        logger.debug(`Emscripten version: ${version}`);

        if (compareVersions(version, MIN_EMSCRIPTEN_VERSION) < 0) {
            logger.error(`Emscripten ${version} is too old. Minimum required: ${MIN_EMSCRIPTEN_VERSION}`);
            logger.info(`  Update: emsdk install ${MIN_EMSCRIPTEN_VERSION} && emsdk activate ${MIN_EMSCRIPTEN_VERSION}`);
            logger.info('  Then: source /path/to/emsdk/emsdk_env.sh');
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

let cachedPython = null;

/**
 * Resolve a Python 3 interpreter. Prefers `python3`, falls back to `python`
 * (Windows ships Python as `python`, not `python3`). Verifies the candidate
 * actually reports Python 3 so a Windows Store alias stub doesn't pass.
 * Returns the command name, or null if none found. Cached after first call.
 */
export async function resolvePython() {
    if (cachedPython) return cachedPython;
    for (const candidate of ['python3', 'python']) {
        try {
            const r = await runCommand(candidate, ['--version'], { silent: true });
            if (/Python 3\./.test(`${r.stdout}${r.stderr}`)) {
                cachedPython = candidate;
                return candidate;
            }
        } catch {
            // try next candidate
        }
    }
    return null;
}

export async function checkPython() {
    return (await resolvePython()) !== null;
}

export async function checkEnvironment() {
    const checks = {
        emscripten: await checkEmscripten(),
        python: await checkPython(),
    };

    if (!checks.emscripten) {
        logger.error('Emscripten not found. No activated emsdk was discovered.');
        logger.info(`  Required version: ${MIN_EMSCRIPTEN_VERSION}`);
        logger.info('  Set up the bundled submodule: pnpm emsdk:setup');
        logger.info('  Or point at an existing install: set EMSDK=/path/to/emsdk');
        logger.info('  (auto-discovery checks: $EMSDK → .emsdk-path → tools/emsdk → ~/emsdk)');
        return false;
    }

    if (!checks.python) {
        logger.error('Python 3 not found. Please install Python 3.');
        return false;
    }

    logger.debug('Environment check passed');
    return true;
}

export function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const { cwd, silent = false, env } = options;

        logger.debug(`Running: ${command} ${args.join(' ')}`);

        const proc = spawn(command, args, {
            cwd,
            env: { ...process.env, ...env },
            stdio: silent ? 'pipe' : 'inherit',
            shell: process.platform === 'win32',
        });

        let stdout = '';
        let stderr = '';

        if (silent) {
            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
        }

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                const error = new Error(`Command failed with code ${code}`);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

export function getCpuCount() {
    return os.cpus().length;
}
