// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native (embedded-Dawn) host build — the arm64 sibling of the emscripten
// wasm build. It drives native/CMakeLists.txt through the NDK toolchain, sharing
// cmake/ESEngineSources.cmake with the web build so the engine source list never
// drifts. Dawn is fetched + built separately (see native/README.md); pass its
// paths via --dawn / --dawn-build or ESTELLA_DAWN_DIR / ESTELLA_DAWN_BUILD.

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { mkdir } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, getCpuCount } from '../utils/emscripten.js';

function androidSdk() {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (sdk && existsSync(sdk)) return sdk;
    // Android Studio's default install location.
    const dflt = path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'Android', 'Sdk');
    return existsSync(dflt) ? dflt : null;
}

function newest(dir) {
    if (!existsSync(dir)) return null;
    const entries = readdirSync(dir).sort();
    return entries.length ? path.join(dir, entries[entries.length - 1]) : null;
}

// Prefer the NDK-bundled CMake (>= 3.22, ships ninja) over whatever is on PATH —
// CMake 4.x rejects the pre-3.5 minimums in some transitive deps.
function sdkCmake(sdk) {
    const cmakeRoot = newest(path.join(sdk, 'cmake'));
    if (!cmakeRoot) return { cmake: 'cmake', ninja: null };
    const bin = path.join(cmakeRoot, 'bin');
    const exe = process.platform === 'win32' ? '.exe' : '';
    return { cmake: path.join(bin, 'cmake' + exe), ninja: path.join(bin, 'ninja' + exe) };
}

export async function buildNative(options = {}) {
    const { abi = 'arm64-v8a', platform = 'android-33' } = options;
    const rootDir = config.paths.root;

    const sdk = androidSdk();
    if (!sdk) throw new Error('Android SDK not found. Set ANDROID_HOME (install via Android Studio).');
    const ndk = newest(path.join(sdk, 'ndk'));
    if (!ndk) throw new Error(`No NDK under ${sdk}/ndk. Install one via Android Studio's SDK Manager.`);
    const toolchain = path.join(ndk, 'build', 'cmake', 'android.toolchain.cmake');

    const dawnDir = options.dawn || process.env.ESTELLA_DAWN_DIR;
    const dawnBuild = options.dawnBuild || process.env.ESTELLA_DAWN_BUILD;
    if (!dawnDir || !dawnBuild) {
        throw new Error('Dawn not configured. Pass --dawn <src> --dawn-build <arm64 build>, or set '
            + 'ESTELLA_DAWN_DIR / ESTELLA_DAWN_BUILD. Build Dawn per native/README.md.');
    }

    const { cmake, ninja } = sdkCmake(sdk);
    const buildDir = path.join(rootDir, 'build-native');
    await mkdir(buildDir, { recursive: true });

    logger.step(`Configuring native host (${abi}, ${platform})...`);
    const configureArgs = [
        '-S', path.join(rootDir, 'native'),
        '-B', buildDir,
        '-G', 'Ninja',
        `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
        `-DANDROID_ABI=${abi}`,
        `-DANDROID_PLATFORM=${platform}`,
        '-DANDROID_STL=c++_shared',
        '-DCMAKE_BUILD_TYPE=Release',
        `-DESTELLA_DAWN_DIR=${dawnDir}`,
        `-DESTELLA_DAWN_BUILD=${dawnBuild}`,
    ];
    if (ninja) configureArgs.push(`-DCMAKE_MAKE_PROGRAM=${ninja}`);
    await runCommand(cmake, configureArgs, { cwd: rootDir });

    logger.step('Building native host...');
    await runCommand(cmake, ['--build', buildDir, '-j', String(getCpuCount())], { cwd: rootDir });

    logger.success(`Native host: ${path.join('build-native', 'libestella_host.so')}`);
}
