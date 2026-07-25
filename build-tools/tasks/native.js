// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native (embedded-Dawn) host build — the arm64 sibling of the emscripten
// wasm build. It drives native/CMakeLists.txt: through the NDK toolchain for
// Android, through the iOS SDK for iPhone. Both share cmake/ESEngineSources.cmake
// with the web build so the engine source list never drifts. Dawn is fetched +
// built separately, per platform (see native/README.md); pass its paths via
// --dawn / --dawn-build or ESTELLA_DAWN_DIR / ESTELLA_DAWN_BUILD.

import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, rm, cp } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, getCpuCount, resolvePython } from '../utils/emscripten.js';
import { requireSdk, requireNdk, sdkCmake } from '../utils/android.js';
import { packageNativeApk } from './nativePackage.js';

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

// Generate the QuickJS wrappers for the engine's binding ENTRY POINTS — the same
// declarations embind registers on the web, so the SDK reaches the engine by the
// same names on both platforms and nothing is bound twice by hand. The bodies are
// the binding TUs themselves, which this build compiles (see ESEngineSources).
async function generateNativeFunctionBindings(rootDir, genDir, python) {
    const out = path.join(genDir, 'NativeFunctionBindings.generated.cpp');
    // Every binding TU the native build compiles (see cmake/ESEngineSources.cmake).
    // ResourceManagerBindings is the texture surface the asset pipeline uploads
    // through: the host used to hand-write a second copy of it.
    const headers = ['RendererBindings.hpp', 'UIBindings.hpp', 'ResourceManagerBindings.hpp'].map(
        (h) => path.join(rootDir, 'src', 'esengine', 'bindings', h));
    await runCommand(python, [
        path.join(rootDir, 'tools', 'eht.py'),
        '--native-functions', ...headers,
        '--native-functions-output', out,
        '--native-shim', 'esn_shim.hpp',
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

// Embed the host bootstrap (native/host/bootstrap.js) the same way. It is real
// JavaScript — the bridge install and the default init/update — so it lives as a
// .js file that can be linted and diffed, not as a C++ string literal.
async function generateBootstrap(rootDir, genDir) {
    const source = path.join(rootDir, 'native', 'host', 'bootstrap.js');
    if (!existsSync(source)) throw new Error(`Host bootstrap not found at ${source}.`);
    const header =
        '// native/host/bootstrap.js, embedded by `cli native` — DO NOT EDIT.\n'
        + '#pragma once\n'
        + 'static const char* kHostBootstrapJS = R"ESJS(\n'
        + readFileSync(source, 'utf8')
        + ')ESJS";\n';
    const headerPath = path.join(genDir, 'host_bootstrap.h');
    writeFileSync(headerPath, header, 'utf8');
    return headerPath;
}

// Stage the QuickJS public header where the editor's C++ config looks for it
// (`build/quickjs_headers`, in .vscode/c_cpp_properties.json). IntelliSense would
// otherwise need ESTELLA_QUICKJS_DIR exported into the session that launched the
// editor — a machine-specific env var, set outside the repo, that goes stale. One
// build now makes every host TU resolve.
async function stageEditorHeaders(rootDir, quickjs) {
    const dest = path.join(rootDir, 'build', 'quickjs_headers');
    await mkdir(dest, { recursive: true });
    await cp(path.join(quickjs, 'quickjs.h'), path.join(dest, 'quickjs.h'));
}

// Every generated artifact goes in the build tree; nothing committed can drift
// from the reflection / SDK / bootstrap source.
async function prepareGenerated(rootDir, buildDir, quickjs) {
    if (!existsSync(quickjs)) {
        throw new Error(`QuickJS source dir not found: ${quickjs}. Clone `
            + 'https://github.com/quickjs-ng/quickjs (see native/README.md).');
    }
    const genDir = path.join(buildDir, 'gen');
    await mkdir(genDir, { recursive: true });
    const python = await resolvePython() ?? 'python3';
    logger.step('Generating native ECS bindings (EHT, single reflection source)...');
    await generateNativeBindings(rootDir, genDir, python);
    logger.step('Generating native entry-point bindings (EHT, same declarations as embind)...');
    await generateNativeFunctionBindings(rootDir, genDir, python);
    logger.step('Embedding the real SDK bundle (dist/index.native.bundled.js)...');
    await generateSdkBundle(rootDir, genDir);
    logger.step('Embedding the host bootstrap (native/host/bootstrap.js)...');
    await generateBootstrap(rootDir, genDir);
    await stageEditorHeaders(rootDir, quickjs);
    return genDir;
}

function dawnPaths(options) {
    const dawnDir = options.dawn || process.env.ESTELLA_DAWN_DIR;
    const dawnBuild = options.dawnBuild || process.env.ESTELLA_DAWN_BUILD;
    if (!dawnDir || !dawnBuild) {
        throw new Error('Dawn not configured. Pass --dawn <src> --dawn-build <arm64 build>, or set '
            + 'ESTELLA_DAWN_DIR / ESTELLA_DAWN_BUILD. Build Dawn per native/README.md.');
    }
    return { dawnDir, dawnBuild };
}

// CMake parses backslashes in -D string values as escapes (F:\estella -> \e), so
// hand it forward-slash paths (valid on Windows too).
const fwd = (p) => p.replace(/\\/g, '/');

async function buildAndroidHost(options) {
    const { abi = 'arm64-v8a', platform = 'android-33' } = options;
    const rootDir = config.paths.root;

    const sdk = requireSdk();
    const ndk = requireNdk(sdk);
    const toolchain = path.join(ndk, 'build', 'cmake', 'android.toolchain.cmake');

    const { dawnDir, dawnBuild } = dawnPaths(options);

    const { cmake, ninja } = sdkCmake(sdk);
    const buildDir = path.join(rootDir, 'build-native');
    await mkdir(buildDir, { recursive: true });

    // JS host (opt-in): pass --quickjs <dir> (or ESTELLA_QUICKJS_DIR) to also build
    // the QuickJS host — a game script driving the engine through the generated
    // bindings + the real SDK ptrAccessors.
    const quickjs = options.quickjs || process.env.ESTELLA_QUICKJS_DIR;
    const genDir = quickjs ? await prepareGenerated(rootDir, buildDir, quickjs) : null;

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
        // Emit build-native/compile_commands.json so editor IntelliSense (the
        // "Native Host" c_cpp_properties config) resolves the NDK / Dawn / QuickJS
        // includes for native/host without hardcoding any machine paths.
        '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        `-DESTELLA_DAWN_DIR=${dawnDir}`,
        `-DESTELLA_DAWN_BUILD=${dawnBuild}`,
    ];
    if (ninja) configureArgs.push(`-DCMAKE_MAKE_PROGRAM=${ninja}`);
    if (quickjs) {
        configureArgs.push(`-DESTELLA_QUICKJS_DIR=${fwd(quickjs)}`, `-DESTELLA_NATIVE_GEN_DIR=${fwd(genDir)}`);
    }
    await runCommand(cmake, configureArgs, { cwd: rootDir });

    logger.step('Building native host...');
    await runCommand(cmake, ['--build', buildDir, '-j', String(getCpuCount())], { cwd: rootDir });

    logger.success(`Host: ${path.join('build-native', 'libestella_js_host.so')}`);

    if (options.package) {
        await packageNativeApk({
            dawnBuild, abi, platform, keystore: options.keystore, jdk: options.jdk,
            content: options.content,
        });
    }
}

// Xcode ships the iPhoneOS SDK; the Command Line Tools alone do not. Point the
// toolchain at Xcode when the active developer dir can't produce one, so a machine
// left on `xcode-select -s /Library/Developer/CommandLineTools` still builds.
async function iosDeveloperDir() {
    const probe = await runCommand('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { silent: true })
        .catch(() => null);
    if (probe?.stdout?.trim()) return null;
    const xcode = '/Applications/Xcode.app/Contents/Developer';
    if (!existsSync(xcode)) {
        throw new Error('No iPhoneOS SDK. Install Xcode (the Command Line Tools alone cannot build for iOS).');
    }
    return xcode;
}

// A device build and a simulator build are different target triples, so their
// objects can never link together. The app links an .xcframework instead, and
// Xcode picks the slice matching whatever you selected in the toolbar.
const IOS_SLICES = {
    device: { dir: 'build-native-ios', sysroot: 'iphoneos', label: 'device' },
    simulator: { dir: 'build-native-ios-sim', sysroot: 'iphonesimulator', label: 'simulator' },
};
const XCFRAMEWORK = path.join('build-native-ios', 'Estella.xcframework');

// Rebuild the xcframework from whichever slices exist. A device-only framework is
// valid — Xcode then simply has nothing to offer a simulator target.
async function assembleXcframework(rootDir, env) {
    const libs = [];
    for (const slice of Object.values(IOS_SLICES)) {
        const lib = path.join(rootDir, slice.dir, 'libestella_ios.a');
        if (existsSync(lib)) libs.push('-library', lib);
    }
    const out = path.join(rootDir, XCFRAMEWORK);
    await rm(out, { recursive: true, force: true });
    await runCommand('xcodebuild', ['-create-xcframework', ...libs, '-output', out], { cwd: rootDir, env, silent: true });
    logger.success(`iOS framework: ${XCFRAMEWORK} (${libs.length / 2} slice${libs.length === 2 ? '' : 's'})`);
}

// Stage an exported project into the Xcode project's Content/ folder reference —
// the iOS counterpart of the APK's assets/. Replaces whatever was there, so a
// re-export never leaves an old build's files behind.
async function stageIosContent(rootDir, contentDir) {
    const from = path.isAbsolute(contentDir) ? contentDir : path.join(rootDir, contentDir);
    if (!existsSync(from)) throw new Error(`--content dir not found: ${from}`);
    const to = path.join(rootDir, 'native', 'ios', 'Content');
    const keep = path.join(to, '.gitkeep');
    const keepText = existsSync(keep) ? readFileSync(keep, 'utf8') : null;
    await rm(to, { recursive: true, force: true });
    await mkdir(to, { recursive: true });
    await cp(from, to, { recursive: true });
    // The placeholder is committed so a fresh clone has the directory xcodegen's
    // folder reference needs; staging content must not delete it.
    if (keepText !== null) writeFileSync(keep, keepText);
    logger.success(`iOS content: native/ios/Content ← ${path.relative(rootDir, from)}`);
}

async function buildIosHost(options) {
    if (process.platform !== 'darwin') throw new Error('The iOS host builds on macOS only.');
    const rootDir = config.paths.root;
    const { dawnDir, dawnBuild } = dawnPaths(options);
    const slice = options.simulator ? IOS_SLICES.simulator : IOS_SLICES.device;

    // Unlike Android there is no pure-C++ reference host for iOS: the app IS the
    // JS host, so QuickJS is required rather than opt-in.
    const quickjs = options.quickjs || process.env.ESTELLA_QUICKJS_DIR;
    if (!quickjs) {
        throw new Error('The iOS host needs QuickJS: pass --quickjs <dir> (or set ESTELLA_QUICKJS_DIR).');
    }

    const developerDir = await iosDeveloperDir();
    const env = developerDir ? { DEVELOPER_DIR: developerDir } : undefined;
    if (developerDir) logger.info(`Using DEVELOPER_DIR=${developerDir} (the active one has no iPhoneOS SDK)`);

    const buildDir = path.join(rootDir, slice.dir);
    await mkdir(buildDir, { recursive: true });
    const genDir = await prepareGenerated(rootDir, buildDir, quickjs);

    const deploymentTarget = options.iosMin || '17.0';
    logger.step(`Configuring iOS host (arm64 ${slice.label}, iOS ${deploymentTarget})...`);
    await runCommand('cmake', [
        '-S', path.join(rootDir, 'native'),
        '-B', buildDir,
        '-G', 'Ninja',
        '-DCMAKE_SYSTEM_NAME=iOS',
        '-DCMAKE_OSX_ARCHITECTURES=arm64',
        `-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`,
        `-DCMAKE_OSX_SYSROOT=${slice.sysroot}`,
        '-DCMAKE_BUILD_TYPE=Release',
        '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        `-DESTELLA_DAWN_DIR=${fwd(dawnDir)}`,
        `-DESTELLA_DAWN_BUILD=${fwd(dawnBuild)}`,
        `-DESTELLA_QUICKJS_DIR=${fwd(quickjs)}`,
        `-DESTELLA_NATIVE_GEN_DIR=${fwd(genDir)}`,
    ], { cwd: rootDir, env });

    logger.step(`Building iOS host (${slice.label})...`);
    await runCommand('cmake', ['--build', buildDir, '-j', String(getCpuCount())], { cwd: rootDir, env });

    logger.success(`iOS host: ${path.join(slice.dir, 'libestella_ios.a')}`);
    await assembleXcframework(rootDir, env);
    if (options.content) await stageIosContent(rootDir, options.content);
    logger.info('Next: cd native/ios && xcodegen && open EstellaiOS.xcodeproj — pick your Team, then Run.');
}

export async function buildNative(options = {}) {
    const target = (options.target || 'android').toLowerCase();
    if (target === 'ios') return buildIosHost(options);
    if (target !== 'android') throw new Error(`Unknown --target ${target} (expected android or ios).`);
    return buildAndroidHost(options);
}
