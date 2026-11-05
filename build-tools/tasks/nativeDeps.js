// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Dawn, QuickJS, SDL and V8, at the versions this release builds against.
//
// A runtime template is a binary other people install, so it has to be
// reproducible: `git clone --depth 1` of a branch gives whatever landed today,
// and Dawn's webgpu.h is a moving target. The pins live in
// toolchain.manifest.json; this fetches them, and the build finds them here
// without a flag.

import path from 'path';
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, resolvePython } from '../utils/emscripten.js';

/** Where a fetched checkout lands. Inside the repo's build dir (gitignored), so a
 *  CI cache can hold it and `rm -rf build` throws it away like everything else. */
export function nativeDepsDir(rootDir = config.paths.root) {
    return process.env.ESTELLA_NATIVE_DEPS || path.join(rootDir, 'build', 'native-deps');
}

export function nativePins(rootDir = config.paths.root) {
    const manifest = JSON.parse(readFileSync(path.join(rootDir, 'toolchain.manifest.json'), 'utf8'));
    if (!manifest.native?.dawn?.commit || !manifest.native?.quickjs?.commit) {
        throw new Error('toolchain.manifest.json has no native.dawn / native.quickjs pin.');
    }
    return manifest.native;
}

/** Whether a target is one of the desktop OSes — the ones whose window, event loop
 *  and gamepads come from SDL rather than from the OS's own app framework. */
export function isDesktopTarget(target) {
    return target === 'macos' || target === 'windows' || target === 'linux';
}

/**
 * The cache key for a target's prebuilt dependencies: every pin that build
 * consumes, and only those. A key that forgets one serves a stale build under a
 * name saying it is current; SDL is desktop-only, so keying the phones on it
 * would rebuild Dawn whenever SDL moves.
 */
export function depsCacheKey(target, rootDir = config.paths.root) {
    const pins = nativePins(rootDir);
    const parts = [pins.dawn.commit, pins.quickjs.commit];
    if (isDesktopTarget(target)) parts.push(pins.sdl?.commit ?? 'no-sdl-pin');
    // No V8 here, on purpose: it is downloaded, not built, and fetchV8 checks its
    // own stamp against the pin — keying on it would only rebuild Dawn for nothing.
    return `native-deps-${target}-${parts.join('-')}`;
}

/**
 * Check `repo` out at `commit` in `dir`, fetching only that commit.
 *
 * `git fetch --depth 1 <sha>` rather than a clone: a full clone of Dawn is
 * gigabytes of history nobody here reads, and naming the commit is what makes the
 * result the same for everyone.
 */
async function fetchAt(dir, repo, commit, label) {
    if (!existsSync(path.join(dir, '.git'))) {
        await mkdir(dir, { recursive: true });
        await runCommand('git', ['init', '-q'], { cwd: dir });
        await runCommand('git', ['remote', 'add', 'origin', repo], { cwd: dir });
    }
    const head = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: dir, silent: true }).catch(() => null);
    if (head?.stdout?.trim() === commit) {
        logger.info(`${label} already at ${commit.slice(0, 12)}`);
        return dir;
    }
    logger.step(`Fetching ${label} at ${commit.slice(0, 12)}...`);
    await runCommand('git', ['fetch', '--depth', '1', 'origin', commit], { cwd: dir });
    await runCommand('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: dir });
    return dir;
}

/**
 * Fetch both dependencies at their pinned commits.
 *
 * @returns {Promise<{dawn: string, quickjs: string}>} the two checkouts.
 */
export async function fetchNativeDeps(options = {}) {
    const rootDir = options.root || config.paths.root;
    const pins = nativePins(rootDir);
    const deps = options.depsDir || nativeDepsDir(rootDir);

    const dawn = await fetchAt(path.join(deps, 'dawn'), pins.dawn.repo, pins.dawn.commit, 'Dawn');
    // Dawn's own dependencies are fetched by a script, not by submodules — which
    // is the whole reason tracking Dawn as one would save nobody anything.
    logger.step('Fetching Dawn\'s dependencies (shallow)...');
    await runCommand(await resolvePython(), [
        path.join(dawn, 'tools', 'fetch_dawn_dependencies.py'), '--shallow', '--directory', dawn,
    ], { cwd: dawn });

    const quickjs = await fetchAt(path.join(deps, 'quickjs'), pins.quickjs.repo, pins.quickjs.commit, 'QuickJS-ng');

    // Only the desktop host links SDL, and it is the smallest of the three, so it
    // is fetched unconditionally rather than behind a flag: a dependency you have
    // to remember to ask for is one the next person's build is missing.
    const sdl = await fetchAt(path.join(deps, 'sdl'), pins.sdl.repo, pins.sdl.commit, 'SDL3');

    // Prebuilt archives rather than checkouts: V8 builds only with Chromium's own
    // toolchain. Fetched ahead for what THIS machine can build — the Windows V8 only
    // on Windows (MSVC links it), the NDK one anywhere — so a Linux desktop job no
    // longer downloads a Windows archive it never links, and fails with it when
    // that download does. A build still fetches its own on demand (jsEngineFor).
    const v8 = {};
    const buildable = process.platform === 'win32' ? ['windows', 'android'] : ['android'];
    for (const platform of buildable) {
        if (pins.v8?.[platform]) v8[platform] = await fetchV8(platform, { root: rootDir, depsDir: deps });
    }

    logger.success(`Native dependencies ready in ${path.relative(rootDir, deps) || deps}`);
    logger.info('Build with: node build-tools/cli.js native            (Android)');
    logger.info('            node build-tools/cli.js native --target ios');
    logger.info('            node build-tools/cli.js native --target macos');
    logger.info('            node build-tools/cli.js native --target windows   (from a vcvars64 shell)');
    return { dawn, quickjs, sdl, v8 };
}

/**
 * The prebuilt V8 a target embeds, keyed by what the archive is built for: the
 * Windows build serves the Windows desktop host, the NDK build every Android ABI.
 * Null where the host embeds QuickJS (iOS, and the desktops no V8 is pinned for).
 */
export function v8Platform(target) {
    return target === 'windows' || target === 'android' ? target : null;
}

/** Where a fetched V8 lands: `include/` plus the platform's libraries. */
export function v8Dir(platform, rootDir = config.paths.root) {
    return path.join(nativeDepsDir(rootDir), `v8-${platform}`);
}

async function download(url, sha256, label) {
    logger.step(`Downloading ${label}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${label}: ${url} answered ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== sha256) {
        throw new Error(`${label}: sha256 ${got} is not the pinned ${sha256} — refusing an archive `
            + 'that is not the one this release was built against.');
    }
    return bytes;
}

/** Unpack a zip or a .tgz with Python's standard library: one spelling for every
 *  OS a build runs on, where `tar` and `unzip` disagree about zips. */
async function extract(archive, into, kind) {
    const script = kind === 'zip'
        ? 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])'
        : 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])';
    await runCommand(await resolvePython(), ['-c', script, archive, into], { silent: true });
}

/**
 * Fetch and lay out the pinned V8 for @p platform, once per version.
 *
 *   windows  include/ + lib/Release/{v8,v8_libbase,v8_libplatform}.dll(.lib), the
 *            ICU and zlib DLLs, icudtl.dat — the two NuGet packages, merged.
 *   android  include/ + jni/<abi>/libv8android.so — out of the npm package's AAR.
 *
 * @returns {Promise<string>} the directory to hand CMake as ESTELLA_V8_DIR.
 */
export async function fetchV8(platform, options = {}) {
    const rootDir = options.root || config.paths.root;
    const pin = nativePins(rootDir).v8;
    if (!pin?.[platform]) throw new Error(`toolchain.manifest.json pins no V8 for ${platform}.`);
    const deps = options.depsDir || nativeDepsDir(rootDir);
    const dir = path.join(deps, `v8-${platform}`);
    const stamp = path.join(dir, '.estella-v8');
    // The layout version: what this function lays out, beside what it fetched — a
    // directory laid out by an older version of it is laid out again.
    const LAYOUT = 2;
    const want = `${pin.version}\n${JSON.stringify(pin[platform])}\nlayout ${LAYOUT}`;
    if (existsSync(stamp) && (await readFile(stamp, 'utf8')) === want) {
        logger.info(`V8 ${pin.version} (${platform}) already fetched`);
        return dir;
    }
    await rm(dir, { recursive: true, force: true });
    const scratch = path.join(deps, `v8-${platform}.download`);
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });

    if (platform === 'windows') {
        for (const [i, part] of pin.windows.entries()) {
            const archive = path.join(scratch, `part${i}.zip`);
            await writeFile(archive, await download(part.url, part.sha256, `V8 ${pin.version} (windows, ${i + 1}/${pin.windows.length})`));
            await extract(archive, dir, 'zip');
        }
    } else {
        const archive = path.join(scratch, 'v8.tgz');
        await writeFile(archive, await download(pin.android.url, pin.android.sha256, `V8 ${pin.version} (android)`));
        await extract(archive, scratch, 'tgz');
        const dist = path.join(scratch, 'package', 'dist');
        const aar = path.join(dist, 'org', 'chromium', 'v8-android');
        const versions = existsSync(aar)
            ? readdirSync(aar, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
        const aarFile = versions.length === 1
            ? path.join(aar, versions[0], `v8-android-${versions[0]}.aar`) : null;
        if (!aarFile || !existsSync(aarFile)) throw new Error(`V8 (android): no AAR under ${aar}`);
        await mkdir(dir, { recursive: true });
        await extract(aarFile, dir, 'zip');
        await cp(path.join(dist, 'include'), path.join(dir, 'include'), { recursive: true });
        // This build keeps its startup snapshot OUTSIDE the library: without it
        // Isolate::New dies with "Failed to deserialize the V8 snapshot blob".
        await cp(path.join(dist, 'snapshot_blob'), path.join(dir, 'snapshot'), { recursive: true });
    }
    if (!existsSync(path.join(dir, 'include', 'v8.h'))) {
        throw new Error(`V8 (${platform}): the archive laid out no include/v8.h under ${dir}`);
    }
    if (platform === 'android' && !existsSync(path.join(dir, 'snapshot', 'arm64-v8a', 'snapshot_blob.bin'))) {
        throw new Error(`V8 (android): the archive carried no startup snapshot under ${dir}/snapshot`);
    }
    await rm(scratch, { recursive: true, force: true });
    await writeFile(stamp, want);
    logger.success(`V8 ${pin.version} (${platform}): ${dir}`);
    return dir;
}

/**
 * Build and INSTALL SDL for a desktop target, if it is not there already.
 *
 * Installed to a prefix so the host can `find_package(SDL3)` and inherit the
 * frameworks SDL declares for itself; a hand-written copy of that list goes stale
 * the first time SDL adds a subsystem. Static, matching Dawn.
 *
 * @param {object} options `{ sdl, target, buildDir, env }`
 * @returns {Promise<string>} the install prefix.
 */
export async function ensureSdlBuild(options) {
    if (!isDesktopTarget(options.target)) {
        throw new Error(`SDL is a desktop dependency; ${options.target} has its own event loop.`);
    }
    const buildDir = options.buildDir || path.join(options.sdl, `out-${options.target}`);
    const prefix = path.join(buildDir, 'install');
    // The package config, not the library: its name differs per toolchain
    // (libSDL3.a, SDL3-static.lib) and this is what find_package looks for anyway.
    if (existsSync(path.join(prefix, 'lib', 'cmake', 'SDL3'))) return prefix;

    const cmake = options.cmake || 'cmake';
    logger.step(`Building SDL3 for ${options.target} (once per pin)...`);
    await runCommand(cmake, [
        '-S', options.sdl, '-B', buildDir, '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release',
        `-DCMAKE_INSTALL_PREFIX=${prefix}`,
        '-DSDL_STATIC=ON', '-DSDL_SHARED=OFF',
        '-DSDL_TESTS=OFF', '-DSDL_EXAMPLES=OFF', '-DSDL_INSTALL_TESTS=OFF',
        // The engine renders through Dawn; SDL is the window, the events and the
        // gamepads. Its own renderers would only be dead code in the binary.
        '-DSDL_RENDER=OFF',
        ...(options.target === 'macos'
            ? [`-DCMAKE_OSX_ARCHITECTURES=${options.macosArchs || 'arm64'}`,
                `-DCMAKE_OSX_DEPLOYMENT_TARGET=${options.macosMin || MACOS_MIN}`]
            : []),
    ], { cwd: options.sdl, env: options.env });
    await runCommand(cmake, ['--build', buildDir, '--target', 'install'],
        { cwd: options.sdl, env: options.env });
    logger.success(`SDL3: ${prefix}`);
    return prefix;
}

/** The pinned checkout of a dependency, if it is there — what the build falls back
 *  to when no --dawn / --quickjs is passed. */
export function pinnedDep(name, rootDir = config.paths.root) {
    const dir = path.join(nativeDepsDir(rootDir), name);
    return existsSync(dir) ? dir : null;
}

/**
 * The Dawn build for a target, and how to produce it.
 *
 * The recipe used to live in native/README.md as a block to paste. It is here
 * because CI has to run exactly what a contributor runs — a second copy in a
 * workflow file is a second thing to keep right — and because a build that
 * fetches its own dependencies should be able to build them too.
 */
export const DAWN_TARGETS = {
    android: { out: 'out-android', shared: true, backend: 'vulkan' },
    ios: { out: 'out-ios', sysroot: 'iphoneos', backend: 'metal' },
    'ios-sim': { out: 'out-ios-sim', sysroot: 'iphonesimulator', backend: 'metal' },
    // Static like iOS, not shared like Android: a depot whose game is ONE
    // executable has no rpath to get wrong (docs/REARCH_STEAM.md §3).
    macos: { out: 'out-macos', backend: 'metal' },
    windows: { out: 'out-windows', backend: 'd3d12' },
    // Vulkan, as Android is — and static, as the other two desktops are.
    linux: { out: 'out-linux', backend: 'vulkan' },
};

/**
 * The backend switches, stated per target rather than defaulted off — a target
 * that names its own backend cannot inherit the wrong one from a shared list.
 *
 * OpenGL/GLES and null are off everywhere: the native renderer is WebGPU-only.
 */
function dawnBackendFlags(backend) {
    const on = (which) => `-DDAWN_ENABLE_${which}=${backend === which.toLowerCase() ? 'ON' : 'OFF'}`;
    return [on('METAL'), on('VULKAN'), on('D3D12'),
        '-DDAWN_ENABLE_NULL=OFF', '-DDAWN_ENABLE_OPENGLES=OFF', '-DDAWN_ENABLE_DESKTOP_GL=OFF'];
}

/** The oldest macOS a desktop build runs on: 11.0, the first release with arm64.
 *  An arm64 binary claiming 10.15 claims something no machine can check. */
export const MACOS_MIN = '11.0';

/** Where a target's monolithic Dawn library lands, once built. MSVC names a static
 *  library `<name>.lib` and puts a multi-config build under its configuration. */
export function dawnLibrary(dawnBuild, target) {
    const dir = path.join(dawnBuild, 'src', 'dawn', 'native');
    if (target === 'windows') return path.join(dir, 'webgpu_dawn.lib');
    return path.join(dir, DAWN_TARGETS[target].shared ? 'libwebgpu_dawn.so' : 'libwebgpu_dawn.a');
}

/** Dawn's build directory for a target. Android's is per-ABI — an emulator build
 *  and a device build are different binaries — with the default ABI keeping the
 *  plain name a checkout may already have. */
export function dawnBuildDir(dawn, target, abi) {
    const suffix = target === 'android' && abi && abi !== 'arm64-v8a' ? `-${abi}` : '';
    return path.join(dawn, DAWN_TARGETS[target].out + suffix);
}

/**
 * Build Dawn for @p target if it is not built already.
 *
 * @param {object} options `{ dawn, target, buildDir, ndk, cmake, ninja, iosMin, env }`
 * @returns {Promise<string>} the build directory.
 */
export async function ensureDawnBuild(options) {
    const target = DAWN_TARGETS[options.target];
    if (!target) throw new Error(`Unknown Dawn target ${options.target}.`);
    const buildDir = options.buildDir || dawnBuildDir(options.dawn, options.target, options.abi);
    if (existsSync(dawnLibrary(buildDir, options.target))) return buildDir;

    const cmake = options.cmake || 'cmake';
    const shared = [
        '-S', options.dawn, '-B', buildDir, '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release',
        ...dawnBackendFlags(target.backend),
        '-DDAWN_BUILD_SAMPLES=OFF', '-DDAWN_BUILD_TESTS=OFF', '-DTINT_BUILD_TESTS=OFF',
        // Cross-compiling Dawn otherwise wants a host protoc.
        '-DDAWN_BUILD_PROTOBUF=OFF', '-DTINT_BUILD_IR_BINARY=OFF',
        // Its dependencies are already fetched (fetchNativeDeps); letting CMake do
        // it again would undo the pin.
        '-DDAWN_FETCH_DEPENDENCIES=OFF',
        ...(options.ninja ? [`-DCMAKE_MAKE_PROGRAM=${options.ninja}`] : []),
    ];
    // Shared on Android (the APK ships the .so); static everywhere else, where one
    // binary embeds everything.
    const monolithic = `-DDAWN_BUILD_MONOLITHIC_LIBRARY=${target.shared ? 'SHARED' : 'STATIC'}`;
    let perTarget;
    if (options.target === 'android') {
        perTarget = [
            `-DCMAKE_TOOLCHAIN_FILE=${path.join(options.ndk, 'build', 'cmake', 'android.toolchain.cmake')}`,
            `-DANDROID_ABI=${options.abi || 'arm64-v8a'}`,
            `-DANDROID_PLATFORM=${options.androidPlatform || 'android-29'}`,
            '-DANDROID_STL=c++_shared',
            monolithic,
        ];
    } else if (options.target === 'windows') {
        // Nothing to cross-compile and no sysroot; the toolchain comes from the
        // environment, which on Windows means a shell that has run vcvars64.
        perTarget = [monolithic];
    } else if (options.target === 'macos') {
        // A HOST build: no CMAKE_SYSTEM_NAME, no sysroot, nothing cross-compiled.
        // Intel is a release-time decision (--macos-archs), not a default: it
        // doubles the longest step in the pipeline.
        perTarget = [
            `-DCMAKE_OSX_ARCHITECTURES=${options.macosArchs || 'arm64'}`,
            `-DCMAKE_OSX_DEPLOYMENT_TARGET=${options.macosMin || MACOS_MIN}`,
            monolithic,
        ];
    } else if (options.target === 'linux') {
        // Also a host build. Named rather than left to the else: that branch is
        // iOS's, and reaching it with a Linux target configured Dawn for a phone
        // — "undefined is not an iOS SDK", from a build that never mentioned iOS.
        perTarget = [monolithic];
    } else if (target.sysroot) {
        perTarget = [
            '-DCMAKE_SYSTEM_NAME=iOS', '-DCMAKE_OSX_ARCHITECTURES=arm64',
            `-DCMAKE_OSX_DEPLOYMENT_TARGET=${options.iosMin || '17.0'}`,
            `-DCMAKE_OSX_SYSROOT=${target.sysroot}`,
            monolithic,
        ];
    } else {
        // Named, not defaulted: this was iOS's branch by fallthrough, so a new
        // target inherited a phone's toolchain and failed as "undefined is not an
        // iOS SDK" — about a platform it had nothing to do with.
        throw new Error(`Dawn target ${options.target} has no configure recipe — add one beside `
            + 'the others in ensureDawnBuild.');
    }

    logger.step(`Building Dawn for ${options.target} (once per pin; this takes a few minutes)...`);
    await runCommand(cmake, [...shared, ...perTarget], { cwd: options.dawn, env: options.env });
    await runCommand(cmake, ['--build', buildDir, '--target', 'webgpu_dawn'], { cwd: options.dawn, env: options.env });
    logger.success(`Dawn: ${dawnLibrary(buildDir, options.target)}`);
    return buildDir;
}
