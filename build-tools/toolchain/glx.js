// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  glx.js — what the WeChat EmscriptenGLX engine is built with: WeChat's
 *        prebuilt library, and the one emsdk it was built for.
 *
 * The library is WeChat's binary, so it is fetched at a pinned version and
 * checked against a pinned hash rather than kept in this repository. WeChat
 * publishes it for emsdk 3.1.17, 3.1.74 and 4.0.10 only, so this target alone
 * builds with 4.0.10 (in tools/emsdk-glx, or ESTELLA_GLX_EMSDK); every other
 * target keeps the main emsdk.
 */
import path from 'path';
import https from 'https';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const GLX_VERSION = '0.1.11';
export const GLX_EMSDK = '4.0.10';
/** sha256 of WeChat's libs_emscriptenglx.zip at {@link GLX_VERSION}. */
const GLX_ZIP_SHA256 = '7e6dd0b69e097575985265835fdf567895224f8e09c2fe29ba41f987d66bdb5c';
const GLX_URL = `https://game.weixin.qq.com/cgi-bin/gamewxagwasmsplitwap/getunityplugininfo?download=1&biz_id=1&version=${GLX_VERSION}`;

function download(url, redirects = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
                res.resume();
                resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`GET ${url} answered ${res.statusCode}`));
                return;
            }
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve(Buffer.concat(parts)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/** Unzip with whichever tool this machine has: `unzip` on macOS and Linux,
 *  bsdtar (`tar`) on Windows, which reads zip where GNU tar does not. */
function unzip(zip, into) {
    for (const [cmd, args] of [['unzip', ['-o', '-q', zip, '-d', into]], ['tar', ['-xf', zip, '-C', into]]]) {
        const r = spawnSync(cmd, args, { stdio: 'ignore' });
        if (r.status === 0) return;
    }
    throw new Error(`could not extract ${zip}: neither unzip nor tar read it`);
}

/** The GLX static library for {@link GLX_EMSDK}, fetched once into build/glx. */
export async function glxLibrary() {
    const dir = path.join(REPO_ROOT, 'build', 'glx', GLX_VERSION);
    const lib = path.join(dir, `libemscriptenglx_${GLX_EMSDK}.a`);
    if (existsSync(lib)) return lib;
    mkdirSync(dir, { recursive: true });
    const zip = await download(GLX_URL);
    const sha = createHash('sha256').update(zip).digest('hex');
    if (sha !== GLX_ZIP_SHA256) {
        throw new Error(`EmscriptenGLX ${GLX_VERSION} from WeChat does not match its pinned hash `
            + `(got ${sha}); refusing to link it. If WeChat republished it, check the new one and update GLX_ZIP_SHA256.`);
    }
    const zipPath = path.join(dir, 'libs_emscriptenglx.zip');
    writeFileSync(zipPath, zip);
    unzip(zipPath, dir);
    rmSync(zipPath, { force: true });
    if (!existsSync(lib)) throw new Error(`EmscriptenGLX ${GLX_VERSION} carries no library for emsdk ${GLX_EMSDK}`);
    return lib;
}

function emsdkRoot() {
    return process.env.ESTELLA_GLX_EMSDK || path.join(REPO_ROOT, 'tools', 'emsdk-glx');
}

function activeVersion(root) {
    const config = path.join(root, '.emscripten');
    if (!existsSync(config)) return null;
    const version = path.join(root, 'upstream', 'emscripten', 'emscripten-version.txt');
    return existsSync(version) ? readFileSync(version, 'utf8').replace(/["\s]/g, '') : null;
}

/**
 * The environment a child needs to build with emsdk {@link GLX_EMSDK}, installing
 * it into tools/emsdk-glx the first time (a git clone plus a download of about
 * 1.5 GB). Returned rather than applied: only the GLX target's children use it.
 */
export function glxEmsdkEnv(log = console.log) {
    const root = emsdkRoot();
    if (activeVersion(root) !== GLX_EMSDK) {
        const emsdk = path.join(root, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk');
        if (!existsSync(emsdk)) {
            log(`Fetching emsdk into ${root} for the WeChat GLX engine (once)`);
            const clone = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/emscripten-core/emsdk.git', root], { stdio: 'inherit' });
            if (clone.status !== 0) throw new Error('could not clone emsdk for the GLX engine');
        }
        for (const args of [['install', GLX_EMSDK], ['activate', '--embedded', GLX_EMSDK]]) {
            log(`emsdk ${args.join(' ')}`);
            const r = spawnSync(emsdk, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
            if (r.status !== 0) throw new Error(`emsdk ${args.join(' ')} failed`);
        }
    }
    const bin = [root, path.join(root, 'upstream', 'emscripten'), path.join(root, 'upstream', 'bin')];
    const nodeDir = existsSync(path.join(root, 'node')) ? readdirSync(path.join(root, 'node'))[0] : null;
    return {
        EMSDK: root,
        EM_CONFIG: path.join(root, '.emscripten'),
        // Its own sysroot cache: one inherited from the main emsdk holds 5.x's libraries.
        EM_CACHE: path.join(root, 'upstream', 'emscripten', 'cache'),
        ...(nodeDir ? { EMSDK_NODE: path.join(root, 'node', nodeDir, 'bin', process.platform === 'win32' ? 'node.exe' : 'node') } : {}),
        PATH: bin.join(path.delimiter) + path.delimiter + (process.env.PATH || ''),
    };
}

