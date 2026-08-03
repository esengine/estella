// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Dawn and QuickJS, checked out at the commits this release builds against.
//
// A runtime template is a binary other people install, so it has to be
// reproducible: `git clone --depth 1` of a branch gives whatever landed today,
// and Dawn's webgpu.h is a moving target. The pins live in
// toolchain.manifest.json; this fetches them, and the build finds them here
// without a flag.

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';
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

    logger.success(`Native dependencies ready in ${path.relative(rootDir, deps) || deps}`);
    logger.info('Build with: node build-tools/cli.js native            (Android)');
    logger.info('            node build-tools/cli.js native --target ios');
    return { dawn, quickjs };
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
    android: { out: 'out-android', shared: true },
    ios: { out: 'out-ios', sysroot: 'iphoneos' },
    'ios-sim': { out: 'out-ios-sim', sysroot: 'iphonesimulator' },
};

/** Where a target's monolithic Dawn library lands, once built. */
export function dawnLibrary(dawnBuild, target) {
    const name = DAWN_TARGETS[target].shared ? 'libwebgpu_dawn.so' : 'libwebgpu_dawn.a';
    return path.join(dawnBuild, 'src', 'dawn', 'native', name);
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
        '-DDAWN_ENABLE_D3D12=OFF', '-DDAWN_ENABLE_NULL=OFF',
        '-DDAWN_ENABLE_OPENGLES=OFF', '-DDAWN_ENABLE_DESKTOP_GL=OFF',
        '-DDAWN_BUILD_SAMPLES=OFF', '-DDAWN_BUILD_TESTS=OFF', '-DTINT_BUILD_TESTS=OFF',
        // Cross-compiling Dawn otherwise wants a host protoc.
        '-DDAWN_BUILD_PROTOBUF=OFF', '-DTINT_BUILD_IR_BINARY=OFF',
        // Its dependencies are already fetched (fetchNativeDeps); letting CMake do
        // it again would undo the pin.
        '-DDAWN_FETCH_DEPENDENCIES=OFF',
        ...(options.ninja ? [`-DCMAKE_MAKE_PROGRAM=${options.ninja}`] : []),
    ];
    const perTarget = options.target === 'android'
        ? [
            `-DCMAKE_TOOLCHAIN_FILE=${path.join(options.ndk, 'build', 'cmake', 'android.toolchain.cmake')}`,
            `-DANDROID_ABI=${options.abi || 'arm64-v8a'}`,
            `-DANDROID_PLATFORM=${options.androidPlatform || 'android-24'}`,
            '-DANDROID_STL=c++_shared',
            '-DDAWN_ENABLE_VULKAN=ON', '-DDAWN_ENABLE_METAL=OFF',
            // Shared on Android (the APK ships the .so); static on iOS (an app
            // embeds it).
            '-DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED',
        ]
        : [
            '-DCMAKE_SYSTEM_NAME=iOS', '-DCMAKE_OSX_ARCHITECTURES=arm64',
            `-DCMAKE_OSX_DEPLOYMENT_TARGET=${options.iosMin || '17.0'}`,
            `-DCMAKE_OSX_SYSROOT=${target.sysroot}`,
            '-DDAWN_ENABLE_METAL=ON', '-DDAWN_ENABLE_VULKAN=OFF',
            '-DDAWN_BUILD_MONOLITHIC_LIBRARY=STATIC',
        ];

    logger.step(`Building Dawn for ${options.target} (once per pin; this takes a few minutes)...`);
    await runCommand(cmake, [...shared, ...perTarget], { cwd: options.dawn, env: options.env });
    await runCommand(cmake, ['--build', buildDir, '--target', 'webgpu_dawn'], { cwd: options.dawn, env: options.env });
    logger.success(`Dawn: ${dawnLibrary(buildDir, options.target)}`);
    return buildDir;
}
