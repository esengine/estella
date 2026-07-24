// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native (embedded-Dawn) host build — the arm64 sibling of the emscripten
// wasm build. It drives native/CMakeLists.txt through the NDK toolchain, sharing
// cmake/ESEngineSources.cmake with the web build so the engine source list never
// drifts. Dawn is fetched + built separately (see native/README.md); pass its
// paths via --dawn / --dawn-build or ESTELLA_DAWN_DIR / ESTELLA_DAWN_BUILD.

import path from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, getCpuCount, resolvePython } from '../utils/emscripten.js';

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

// Generate the native (QuickJS) ECS bindings from the SAME reflection source EHT
// uses for the web embind bindings — so the two surfaces can never drift. Written
// into the build tree (not committed); --native-only skips all embind/editor/TS
// work so no committed *.generated.* file is touched.
async function generateNativeBindings(rootDir, genDir, python) {
    const out = path.join(genDir, 'NativeBindings.generated.cpp');
    await runCommand(python, [
        path.join(rootDir, 'tools', 'eht.py'),
        '--input', path.join(rootDir, 'src', 'esengine', 'ecs', 'components'),
        '--native-output', out,
        '--native-shim', 'esn_shim.hpp',
        '--native-only',
    ], { cwd: rootDir });
    return out;
}

// Embed the real esengine SDK, bundled to one QuickJS-loadable file
// (dist/index.native.bundled.js — the IIFE that installs globalThis.ESEngine).
// The host evals it, then a game script drives it via ESEngine.createNativeWorld.
// This carries the whole SDK ECS (World + createNativeRegistry + ptrAccessors),
// so no separate marshalling file is embedded — one source, the web SDK's bytes.
async function generateSdkBundle(rootDir, genDir) {
    const bundlePath = path.join(rootDir, 'sdk', 'dist', 'index.native.bundled.js');
    if (!existsSync(bundlePath)) {
        throw new Error(`SDK native bundle not found at ${bundlePath}. Build the SDK first `
            + '(cd sdk && pnpm run build) — it produces the QuickJS-loadable index.native.bundled.js.');
    }
    const js = readFileSync(bundlePath, 'utf8');
    const header =
        '// The real esengine SDK, bundled (dist/index.native.bundled.js) — installs\n'
        + '// globalThis.ESEngine. Embedded by `cli native --quickjs` — DO NOT EDIT.\n'
        + '#pragma once\n'
        + 'static const char* kSdkBundleJS = R"ESJS(\n'
        + js
        + ')ESJS";\n';
    const headerPath = path.join(genDir, 'esengine_bundle.h');
    writeFileSync(headerPath, header, 'utf8');
    return headerPath;
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

    // JS host (opt-in): pass --quickjs <dir> (or ESTELLA_QUICKJS_DIR) to also build
    // the QuickJS host — a game script driving the engine through the generated
    // bindings + the real SDK ptrAccessors. Both generated artifacts go in the
    // build tree; nothing committed can drift from the reflection / SDK source.
    const quickjs = options.quickjs || process.env.ESTELLA_QUICKJS_DIR;
    let genDir = null;
    if (quickjs) {
        if (!existsSync(quickjs)) {
            throw new Error(`QuickJS source dir not found: ${quickjs}. Clone `
                + 'https://github.com/quickjs-ng/quickjs (see native/README.md).');
        }
        genDir = path.join(buildDir, 'gen');
        await mkdir(genDir, { recursive: true });
        const python = await resolvePython() ?? 'python3';
        logger.step('Generating native ECS bindings (EHT, single reflection source)...');
        await generateNativeBindings(rootDir, genDir, python);
        logger.step('Embedding the real SDK bundle (dist/index.native.bundled.js)...');
        await generateSdkBundle(rootDir, genDir);
    }

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
    if (quickjs) {
        // CMake parses backslashes in -D string values as escapes (F:\estella -> \e),
        // so hand it forward-slash paths (valid on Windows too).
        const fwd = (p) => p.replace(/\\/g, '/');
        configureArgs.push(`-DESTELLA_QUICKJS_DIR=${fwd(quickjs)}`, `-DESTELLA_NATIVE_GEN_DIR=${fwd(genDir)}`);
    }
    await runCommand(cmake, configureArgs, { cwd: rootDir });

    logger.step('Building native host...');
    await runCommand(cmake, ['--build', buildDir, '-j', String(getCpuCount())], { cwd: rootDir });

    logger.success(`Native host: ${path.join('build-native', 'libestella_host.so')}`);
    if (quickjs) {
        logger.success(`JS host:     ${path.join('build-native', 'libestella_js_host.so')}`);
    }
}
