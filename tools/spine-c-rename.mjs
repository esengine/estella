#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-c-rename.mjs
 * @brief   The rename header that lets several spine-c releases share one binary.
 *
 * @details Every vendored spine-c runtime (2.1, 3.8, 4.1, 4.2) defines the same C
 *          names — spSkeleton_create, Json_create, … — so a native host that
 *          carries more than one has to give each its own. The header this writes
 *          is force-included into one release's sources and into the engine's
 *          backend for it, prefixing every external symbol that release's objects
 *          define or expect from the backend (_spAtlasPage_createTexture and the
 *          other hooks).
 *
 *          The list is read off the compiled objects with llvm-nm, not off the
 *          sources: token-pasting macros define functions no regex would see, and
 *          a name left out does not fail loudly — the linker binds one release's
 *          call to another's definition. The vendored runtimes are pinned, so the
 *          output is committed (native/spine/) and regenerated only when one moves:
 *
 *            node tools/spine-c-rename.mjs            # rewrite the headers
 *            node tools/spine-c-rename.mjs --check    # fail if one is stale
 *            node tools/spine-c-rename.mjs --verify <build dir>
 *                # after a host build: fail if a Spine name escaped its prefix
 *
 *          Needs a clang and llvm-nm: CC / NM, or the Android NDK's (ANDROID_NDK_HOME,
 *          or the newest NDK under the SDK).
 *
 *          4.3 is not here: it is spine-cpp, whose names live in namespace spine and
 *          collide with none of these.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'native', 'spine');

/** Where each spine-c release keeps its sources — the shapes native/CMakeLists.txt reads. */
function spineCTree(version) {
    const base = path.join(root, 'third_party', `spine-runtimes-${version}`);
    for (const rel of ['spine-c/spine-c', 'spine-c']) {
        const src = path.join(base, rel, 'src', 'spine');
        const inc = path.join(base, rel, 'include');
        if (existsSync(path.join(inc, 'spine')) && existsSync(src)) return { src, inc };
    }
    return null;
}

export function spineCVersions() {
    return readdirSync(path.join(root, 'third_party'))
        .filter((d) => d.startsWith('spine-runtimes-'))
        .map((d) => d.slice('spine-runtimes-'.length))
        .filter((v) => spineCTree(v))
        .sort();
}

export const spineTag = (version) => version.replace('.', '');
export const renameHeaderPath = (version) => path.join(OUT_DIR, `SpineCRename${spineTag(version)}.hpp`);

function ndkBin() {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
        || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
    const ndk = process.env.ANDROID_NDK_HOME || (sdk && existsSync(path.join(sdk, 'ndk'))
        ? path.join(sdk, 'ndk', readdirSync(path.join(sdk, 'ndk')).sort().at(-1)) : null);
    if (!ndk) return null;
    const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
    const bin = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', host, 'bin');
    return existsSync(bin) ? bin : null;
}

function tools() {
    const bin = ndkBin();
    const exe = process.platform === 'win32' ? '.exe' : '';
    const cc = process.env.CC || (bin && path.join(bin, `clang${exe}`));
    const nm = process.env.NM || (bin && path.join(bin, `llvm-nm${exe}`));
    if (!cc || !nm) throw new Error('spine-c-rename: no clang/llvm-nm (set CC and NM, or install the Android NDK).');
    return { cc, nm };
}

/** Every external name one release's objects define, plus the backend hooks they call. */
function symbolsOf(version, { cc, nm }) {
    const tree = spineCTree(version);
    const work = mkdtempSync(path.join(tmpdir(), `spine-c-${spineTag(version)}-`));
    try {
        const objects = [];
        for (const file of readdirSync(tree.src).filter((f) => f.endsWith('.c'))) {
            const obj = path.join(work, `${file}.o`);
            // ELF, so the names come back undecorated whichever OS runs this.
            execFileSync(cc, ['--target=aarch64-linux-android29', '-c', '-w', '-O0',
                '-I', tree.inc, path.join(tree.src, file), '-o', obj]);
            objects.push(obj);
        }
        const out = execFileSync(nm, ['--extern-only', ...objects], { encoding: 'utf8', maxBuffer: 1 << 26 });
        const defined = new Set();
        const undefinedNames = new Set();
        for (const line of out.split('\n')) {
            const m = /^\s*(?:[0-9a-f]+\s+)?([A-Za-z])\s+(\S+)$/.exec(line.trim());
            if (!m) continue;
            const [, kind, name] = m;
            if (!/^[A-Za-z_]\w*$/.test(name)) continue;
            if (kind === 'U') undefinedNames.add(name);
            else defined.add(name);
        }
        // The hooks spine-c leaves to its host (texture create/dispose, file read):
        // undefined here, defined by the engine's backend for this release.
        for (const name of undefinedNames) {
            if (!defined.has(name) && /^_?sp[A-Z]/.test(name)) defined.add(name);
        }
        return [...defined].sort();
    } finally {
        rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

function headerFor(version, names) {
    const tag = spineTag(version);
    return [
        '// Generated by tools/spine-c-rename.mjs from the compiled spine-c ' + version + ' objects — DO NOT EDIT.',
        `// Force-included into spine-c ${version} and the engine's backend for it, so that`,
        '// release links beside the others in one native host (native/CMakeLists.txt).',
        '#pragma once',
        '',
        ...names.map((n) => `#define ${n} es${tag}_${n}`),
        '',
    ].join('\n');
}

/**
 * The build's own word on it: every Spine-owned C name each release's libraries
 * define carries that release's prefix. A name the header missed links without a
 * complaint — one release's call bound to another's definition — so this reads
 * the libraries the host was linked from. Returns the offending names.
 */
export function verifyBuild(buildDir, nm = tools().nm) {
    const libs = readdirSync(buildDir).filter((f) => /^(lib)?(spine_runtime|estella_spine)_\d+\.(lib|a)$/.test(f));
    const escaped = [];
    for (const lib of libs) {
        const tag = /_(\d+)\.(lib|a)$/.exec(lib)[1];
        const out = execFileSync(nm, ['--defined-only', '--extern-only', '-j', path.join(buildDir, lib)],
            { encoding: 'utf8', maxBuffer: 1 << 26 });
        for (const name of out.split(/\r?\n/)) {
            if (!/^(_?sp[A-Z]|Json_|_?spine_)/.test(name)) continue;
            if (name.startsWith(`es${tag}_`) || name.startsWith(`spine${tag}_`)) continue;
            escaped.push(`${lib}: ${name}`);
        }
    }
    return { libs, escaped };
}

function main() {
    const verifyAt = process.argv.indexOf('--verify');
    if (verifyAt >= 0) {
        const { libs, escaped } = verifyBuild(path.resolve(process.argv[verifyAt + 1] ?? '.'));
        for (const e of escaped) console.error(`unprefixed: ${e}`);
        if (libs.length === 0) { console.error('no Spine libraries in that directory'); process.exit(2); }
        if (escaped.length) process.exit(1);
        console.log(`spine symbols OK: ${libs.length} libraries, every Spine name prefixed by its release.`);
        return;
    }
    const check = process.argv.includes('--check');
    const t = tools();
    mkdirSync(OUT_DIR, { recursive: true });
    let stale = 0;
    for (const version of spineCVersions()) {
        const text = headerFor(version, symbolsOf(version, t));
        const file = renameHeaderPath(version);
        const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
        if (check) {
            if (current !== text) { console.error(`stale: ${path.relative(root, file)}`); stale++; }
            continue;
        }
        writeFileSync(file, text);
        console.log(`${path.relative(root, file)}: ${text.split('\n').filter((l) => l.startsWith('#define')).length} names`);
    }
    if (stale) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
