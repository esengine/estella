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
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { mkdir, rm, cp, readdir } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, getCpuCount, resolvePython } from '../utils/emscripten.js';
import { requireSdk, requireNdk, sdkCmake } from '../utils/android.js';
import { emitNativeTemplate, writeTemplateIndex, readEngineVersion } from './nativeTemplateEmit.js';
import {
    fetchNativeDeps, pinnedDep, ensureDawnBuild, ensureSdlBuild, dawnLibrary,
    isDesktopTarget, DAWN_TARGETS, MACOS_MIN,
} from './nativeDeps.js';
import {
    ANDROID_ABIS, BYTECODE_FILE, findTemplate, iosTemplateSources, templateStoreDir,
} from '../utils/nativeTemplate.js';
import { readAppConfig, fillTemplate, iosInterfaceOrientations } from '../utils/nativeApp.js';
import { emitIosXcodeProject } from '../utils/iosProject.js';
import { assembleMacApp } from '../utils/desktopApp.js';
import { assembleApk, apkFileName } from '../utils/apk.js';
import { assembleAab, aabFileName } from '../utils/aab.js';
import { debugSigningKey, signingKeyFromPem } from '../utils/androidKeystore.js';

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

// The binding headers whose entry points a native host gets. Two lists, because the
// boundary has two halves:
//
//   ENGINE — the core the SDK drives through `engineApi(app)`. Their entry points ARE
//            the engine API, so they generate the committed TS surface as well.
//   MODULE — the optional subsystems, acquired through `app.sideModules` (physics,
//            the video decoder). They are compiled into the host binary rather than
//            fetched as wasm side modules, so the host needs their wrappers; the SDK
//            reaches them by their own module interface, not the engine API.
//
// Adding a subsystem to a device is adding its header to the right list.
export const ENGINE_BINDING_HEADERS = [
    'RendererBindings.hpp',
    'UIBindings.hpp',
    'ResourceManagerBindings.hpp',
    'TilemapBindings.hpp',
    'PostProcessBindings.hpp',
    'GeometryBindings.hpp',
    'ImmediateDrawBindings.hpp',
    'AnimationBindings.hpp',
    'MaterialBindings.hpp',
];

// Paths are relative to src/esengine/bindings — a side module's sources sit
// together under modules/<name>/, so the entry is a path, not a bare filename.
export const MODULE_BINDING_HEADERS = [
    'modules/physics/PhysicsBindings.hpp',
    'modules/video/VideoBindings.hpp',
    'modules/spine/SpineBindings.hpp',
    'modules/dragonbones/DragonBonesBindings.hpp',
];

export const NATIVE_BINDING_HEADERS = [...ENGINE_BINDING_HEADERS, ...MODULE_BINDING_HEADERS];

// Generate the QuickJS wrappers for the engine's binding ENTRY POINTS — the same
// declarations embind registers on the web, so the SDK reaches the engine by the
// same names on both platforms and nothing is bound twice by hand. The bodies are
// the binding TUs themselves, which this build compiles (see ESEngineSources).
async function generateNativeFunctionBindings(rootDir, genDir, python) {
    const out = path.join(genDir, 'NativeFunctionBindings.generated.cpp');
    const abs = (h) => path.join(rootDir, 'src', 'esengine', 'bindings', h);
    const eht = path.join(rootDir, 'tools', 'eht.py');
    // The wrappers: every module the host compiles in. Declarations behind an
    // ES_ENABLE_* gate carry it into the wrapper, so a build without them still
    // compiles.
    await runCommand(python, [
        eht,
        '--native-functions', ...NATIVE_BINDING_HEADERS.map(abs),
        '--native-functions-output', out,
        '--native-shim', 'esn_shim.hpp',
    ], { cwd: rootDir });
    // The TS engine surface: the CORE headers only. It is committed (the SDK compiles
    // without running EHT), so it is refreshed here rather than updated by hand —
    // after a native build, a surface that moved shows up as a diff instead of as a
    // call the device silently does not answer.
    await runCommand(python, [
        eht,
        '--native-functions', ...ENGINE_BINDING_HEADERS.map(abs),
        '--native-functions-ts', path.join(rootDir, 'sdk', 'src', 'ecs', 'bridge', 'nativeEngineApi.generated.ts'),
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
    // The raw literal opens with a newline, so what the host compiles — and hashes
    // its bytecode cache against — is that newline plus the bundle. It is written
    // out as a file too, because the bytecode step must compile these exact bytes
    // for the host to accept the result (see precompileBundleBytecode).
    const embedded = '\n' + js;
    // A BYTE ARRAY, not a string literal: MSVC caps a literal at 65535 bytes and
    // counts the concatenated result too, so for an ~800 KB bundle neither one
    // literal nor many works. NUL-terminated, so the host still reads a char*.
    const bytes = Buffer.from(embedded, 'utf8');
    const rows = [];
    for (let at = 0; at < bytes.length; at += 32) {
        rows.push(`  ${[...bytes.subarray(at, at + 32)].join(',')},`);
    }
    const header =
        '// The real esengine SDK, bundled (dist/index.native.bundled.js) — installs\n'
        + '// globalThis.ESEngine. Embedded by `cli native --quickjs` — DO NOT EDIT.\n'
        + '#pragma once\n'
        + '// `unsigned char`, because `char` is signed here and a UTF-8 continuation\n'
        + '// byte will not narrow into it.\n'
        + 'static const unsigned char kSdkBundleBytes[] = {\n'
        + rows.join('\n')
        + '\n  0\n};\n'
        + 'static const char* const kSdkBundleJS =\n'
        + '    reinterpret_cast<const char*>(kSdkBundleBytes);\n';
    const headerPath = path.join(genDir, 'esengine_bundle.h');
    writeFileSync(headerPath, header, 'utf8');
    writeFileSync(path.join(genDir, 'esengine_bundle.embedded.js'), embedded, 'utf8');
    return headerPath;
}

/**
 * Build the SDK bundle's bytecode now, so the first launch does not have to.
 *
 * QuickJS parses the bundle in about fourteen seconds on a device. The host
 * caches that compile, but the cache does not exist until one launch has paid
 * for it — which is exactly the black screen after an install. Shipping the
 * bytecode makes the first launch as fast as the rest.
 *
 * Best effort by design: it needs a compiler for THIS machine (the NDK's targets
 * the device), and a build machine without one still produces a working app —
 * one that compiles the bundle on first run, as before. So a failure here is
 * logged and returns null rather than failing the build.
 *
 * @returns Path to the bytecode, or null if it could not be produced.
 */
async function precompileBundleBytecode(rootDir, genDir, quickjs) {
    const source = path.join(genDir, 'esengine_bundle.embedded.js');
    const out = path.join(genDir, BYTECODE_FILE);

    // The very sources the host links, so the bytecode it writes is the bytecode
    // the host reads. Anything else is a format gamble.
    const qjsSources = ['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c']
        .map((f) => path.join(quickjs, f));
    const missing = qjsSources.find((f) => !existsSync(f));
    if (missing) {
        logger.warn(`Bytecode precompile skipped: ${path.basename(missing)} not in ${quickjs}.`);
        return null;
    }

    // Through CMake, which is already required to be here — the NDK toolchain
    // builds the host with it. Invoking a compiler directly means naming one, and
    // the name that was here (`gcc` on Windows) is the one a Windows machine set
    // up for this build is least likely to have: it has MSVC, or the NDK's clang,
    // under neither of those names. Skipping is silent apart from a warning, and
    // what it costs is ~14s of black screen on first launch — a packaged game that
    // looks hung. CMake is the one thing that finds whatever compiler is here.
    const buildDir = path.join(genDir, 'mkbc-build');
    try {
        await mkdir(buildDir, { recursive: true });
        const sources = [path.join(rootDir, 'native', 'tools', 'mkbc.c'), ...qjsSources]
            .map((f) => `"${fwd(f)}"`).join(' ');
        writeFileSync(path.join(buildDir, 'CMakeLists.txt'), [
            'cmake_minimum_required(VERSION 3.20)',
            'project(mkbc C)',
            'set(CMAKE_C_STANDARD 11)',
            `add_executable(mkbc ${sources})`,
            `target_include_directories(mkbc PRIVATE "${fwd(quickjs)}")`,
            'if(MSVC)',
            '  target_compile_options(mkbc PRIVATE /w)',
            'else()',
            '  target_compile_options(mkbc PRIVATE -w)',
            'endif()',
            // QuickJS needs libm, and finds it the same way its own build does.
            // Linking nothing is what the old direct-compiler call did, which is
            // why this step failed on every Linux runner — including the one that
            // builds the Android template every release ships.
            'find_library(M_LIBRARIES m)',
            'if(M_LIBRARIES)',
            '  target_link_libraries(mkbc PRIVATE ${M_LIBRARIES})',
            'endif()',
            'target_link_libraries(mkbc PRIVATE ${CMAKE_DL_LIBS})',
            'find_package(Threads)',
            'if(Threads_FOUND)',
            '  target_link_libraries(mkbc PRIVATE Threads::Threads)',
            'endif()',
        ].join('\n') + '\n', 'utf8');
        await runCommand('cmake', ['-S', buildDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release'],
            { cwd: rootDir, silent: true });
        await runCommand('cmake', ['--build', buildDir, '--config', 'Release'],
            { cwd: rootDir, silent: true });
        const exe = process.platform === 'win32' ? '.exe' : '';
        // Single-config generators put it in the build dir; multi-config (MSBuild,
        // Xcode) put it under the configuration.
        const tool = [path.join(buildDir, `mkbc${exe}`), path.join(buildDir, 'Release', `mkbc${exe}`)]
            .find(existsSync);
        if (!tool) throw new Error('mkbc built but not found');
        await runCommand(tool, [source, out], { cwd: rootDir, silent: true });
    } catch (err) {
        logger.warn('Bytecode precompile skipped (no host compiler?) — the app will '
            + `compile the bundle on first launch instead: ${err.message}`);
        return null;
    }
    return existsSync(out) ? out : null;
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
    logger.step('Precompiling the bundle to bytecode (so the first launch need not)...');
    await precompileBundleBytecode(rootDir, genDir, quickjs);
    await stageEditorHeaders(rootDir, quickjs);
    return genDir;
}

/**
 * Dawn, for one target: where its source is and where its build is — building it
 * if it is not built yet.
 *
 * Nothing has to be passed. The pinned checkout (`--fetch-deps`) is the default
 * source, its `out-<target>` the default build, and a missing build is produced
 * rather than reported — so `cli native --target ios` works from a clean tree
 * once the dependencies are fetched, and CI runs the same two commands a
 * contributor does.
 */
async function dawnPaths(options, target, toolchain = {}) {
    const dawnDir = options.dawn || process.env.ESTELLA_DAWN_DIR || pinnedDep('dawn');
    if (!dawnDir) {
        throw new Error('Dawn not configured. Run `node build-tools/cli.js native --fetch-deps` '
            + '(it checks out the pinned commit), or pass --dawn <src> / set ESTELLA_DAWN_DIR.');
    }
    const dawnBuild = await ensureDawnBuild({
        dawn: dawnDir,
        target,
        buildDir: options.dawnBuild || process.env.ESTELLA_DAWN_BUILD,
        abi: options.abi,
        androidPlatform: options.platform,
        iosMin: options.iosMin,
        ...toolchain,
    });
    return { dawnDir, dawnBuild };
}

/** The QuickJS source the host is built against. Same rule as Dawn: the pinned
 *  checkout unless something says otherwise. */
function quickjsDir(options) {
    return options.quickjs || process.env.ESTELLA_QUICKJS_DIR || pinnedDep('quickjs');
}

/** SDL's install prefix for a desktop target, built if it is not built yet — the
 *  same "nothing has to be passed" rule as {@link dawnPaths}. */
async function sdlPrefix(options, target) {
    const sdlDir = options.sdl || process.env.ESTELLA_SDL_DIR || pinnedDep('sdl');
    if (!sdlDir) {
        throw new Error('SDL not configured. Run `node build-tools/cli.js native --fetch-deps` '
            + '(it checks out the pinned commit), or pass --sdl <src> / set ESTELLA_SDL_DIR.');
    }
    // An install PREFIX passed straight through: a machine that already has SDL3
    // installed can point at it, and there is nothing to build.
    if (existsSync(path.join(sdlDir, 'lib', 'cmake', 'SDL3'))) return sdlDir;
    return ensureSdlBuild({ sdl: sdlDir, target, macosArchs: options.macosArchs });
}

/** The desktop target this machine can build: a desktop host is never cross-compiled,
 *  because its window, its GPU backend and its font stack are all the host OS's. */
function hostDesktopTarget() {
    if (process.platform === 'darwin') return 'macos';
    if (process.platform === 'win32') return 'windows';
    throw new Error(`The desktop host has no ${process.platform} support yet `
        + '(its surface kind and font seam are not written) — see docs/REARCH_STEAM.md S3c.');
}

async function buildDesktopHost(options) {
    const rootDir = config.paths.root;
    const target = hostDesktopTarget();
    if (options.target && options.target.toLowerCase() !== target) {
        throw new Error(`Cannot build the ${options.target} host on ${process.platform}: a desktop `
            + 'host is not cross-compiled — its window, GPU backend and font stack are the host OS\'s.');
    }

    const quickjs = quickjsDir(options);
    if (!quickjs) {
        throw new Error('The desktop host needs QuickJS: run `node build-tools/cli.js native --fetch-deps`, '
            + 'or pass --quickjs <dir> (or set ESTELLA_QUICKJS_DIR).');
    }
    const { dawnDir, dawnBuild } = await dawnPaths(options, target);
    const sdl = await sdlPrefix(options, target);

    const buildDir = path.join(rootDir, DESKTOP_BUILD_DIR[target]);
    await mkdir(buildDir, { recursive: true });
    const genDir = await prepareGenerated(rootDir, buildDir, quickjs);

    const deploymentTarget = options.macosMin || MACOS_MIN;
    logger.step(`Configuring desktop host (${target})...`);
    await runCommand('cmake', [
        '-S', path.join(rootDir, 'native'),
        '-B', buildDir,
        '-G', 'Ninja',
        ...(target === 'macos'
            ? [`-DCMAKE_OSX_ARCHITECTURES=${options.macosArchs || 'arm64'}`,
                `-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`]
            : []),
        '-DCMAKE_BUILD_TYPE=Release',
        '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        `-DESTELLA_DAWN_DIR=${fwd(dawnDir)}`,
        `-DESTELLA_DAWN_BUILD=${fwd(dawnBuild)}`,
        `-DESTELLA_QUICKJS_DIR=${fwd(quickjs)}`,
        `-DESTELLA_SDL_DIR=${fwd(sdl)}`,
        `-DESTELLA_NATIVE_GEN_DIR=${fwd(genDir)}`,
    ], { cwd: rootDir });

    logger.step('Building desktop host...');
    await runCommand('cmake', ['--build', buildDir, '-j', String(getCpuCount())], { cwd: rootDir });

    const exe = path.join(buildDir, target === 'windows' ? 'estella_desktop.exe' : 'estella_desktop');
    logger.success(`Desktop host: ${path.relative(rootDir, exe)}`);

    // Same rule as the other two: the compiled half is project-independent, so it
    // is packed as the template every package is assembled from.
    if (options.template !== false) {
        await emitNativeTemplate({ platform: target, root: rootDir, zipTo: options.templateOut });
    }
    logger.info(`Run an export with: ${path.relative(rootDir, exe)} <exported-project-dir>`);
    return exe;
}

// CMake parses backslashes in -D string values as escapes (F:\estella -> \e), so
// hand it forward-slash paths (valid on Windows too).
const fwd = (p) => p.replace(/\\/g, '/');

async function buildAndroidHost(options) {
    // The platform MUST equal the manifest's minSdkVersion. The NDK emits a weak
    // reference for an API newer than the target and a strong one otherwise, and
    // `__builtin_available` is compiled out in the second case — so building above
    // the declared floor turns every guard into dead code and every guarded symbol
    // into a load-time requirement. At android-33 that shipped a host which could
    // not dlopen below API 31: `cannot locate symbol APerformanceHint_getManager`,
    // on Android 10 and 11, before a line of our code ran.
    const { abi = 'arm64-v8a', platform = 'android-29' } = options;
    const rootDir = config.paths.root;

    const sdk = requireSdk();
    const ndk = requireNdk(sdk);
    const toolchain = path.join(ndk, 'build', 'cmake', 'android.toolchain.cmake');
    const { cmake, ninja } = sdkCmake(sdk);

    const { dawnDir, dawnBuild } = await dawnPaths(options, 'android', { ndk, cmake, ninja });
    // One build tree per ABI, beside the generated sources they share — a second
    // architecture must not overwrite the first one's objects.
    const buildDir = path.join(rootDir, 'build/cmake/native', abi);
    await mkdir(buildDir, { recursive: true });

    // JS host (opt-in): pass --quickjs <dir> (or ESTELLA_QUICKJS_DIR) to also build
    // the QuickJS host — a game script driving the engine through the generated
    // bindings + the real SDK ptrAccessors.
    const quickjs = quickjsDir(options);
    // The generated sources are the same for every ABI (bindings, the SDK bundle,
    // its bytecode), so they live once beside the per-ABI trees.
    const genDir = quickjs ? await prepareGenerated(rootDir, path.join(rootDir, 'build/cmake/native'), quickjs) : null;

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
        // Emit build/cmake/native/compile_commands.json so editor IntelliSense (the
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

    logger.success(`Host: ${path.join('build/cmake/native', abi, 'libestella_js_host.so')}`);

    // The binaries this machine just produced are the same for every game, so they
    // are packed for everyone else's — see build-tools/utils/nativeTemplate.js. Only
    // the JS host is one: the pure-C++ reference host is not what a game ships on.
    if (quickjs && options.template !== false) {
        await emitNativeTemplate({
            platform: 'android', abis: [abi], root: rootDir, ndk, sdk,
            dawnLibrary: (want) => (want === abi ? dawnLibrary(dawnBuild, 'android') : null),
            androidPlatform: platform, jdk: options.jdk, zipTo: options.templateOut,
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
    device: { dir: 'build/cmake/native-ios', sysroot: 'iphoneos', label: 'device' },
    simulator: { dir: 'build/cmake/native-ios-sim', sysroot: 'iphonesimulator', label: 'simulator' },
};
const XCFRAMEWORK = path.join('build/cmake/native-ios', 'Estella.xcframework');

/** Where each desktop OS's host build tree lives — one per OS, as the iOS slices
 *  are one per sysroot, because they are different binaries. */
const DESKTOP_BUILD_DIR = {
    macos: 'build/cmake/native-macos',
    windows: 'build/cmake/native-windows',
};

// Rebuild the xcframework from whichever slices exist. A device-only framework is
// valid — Xcode then simply has nothing to offer a simulator target.
async function assembleXcframework(rootDir, env, genDir) {
    const libs = [];
    // The two slices are built by separate commands, so one can be months older
    // than the other and the framework would merge them without a word — and then
    // a simulator run exercises an engine the device build has moved past. The SDK
    // bundle is what dates a slice: it is regenerated every build, and it is the
    // thing compiled INTO the library.
    const bundle = genDir ? path.join(genDir, 'esengine_bundle.h') : null;
    const bundleAt = bundle && existsSync(bundle) ? statSync(bundle).mtimeMs : 0;
    for (const slice of Object.values(IOS_SLICES)) {
        const lib = path.join(rootDir, slice.dir, 'libestella_ios.a');
        if (!existsSync(lib)) continue;
        if (bundleAt && statSync(lib).mtimeMs < bundleAt) {
            logger.warn(`The ${slice.label} slice predates this SDK bundle — it is going into the `
                + `framework as it is. Rebuild it with \`cli native --target ios`
                + `${slice.sysroot === 'iphonesimulator' ? ' --simulator' : ''}\`.`);
        }
        libs.push('-library', lib);
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
    return from;
}

/**
 * Fill in the app's identity for the Xcode project: Info.plist from its committed
 * template (name, version, and the orientations the OS may rotate among), plus the
 * generated yml project.yml includes for the bundle id.
 *
 * Written on every iOS build, with defaults when no project has been staged, so
 * xcodegen always has both files — it runs after this by construction, since the
 * project links the xcframework this build produces.
 */
async function writeIosAppIdentity(rootDir, contentDir) {
    const app = contentDir ? readAppConfig(contentDir, (m) => logger.warn(m)) : readAppConfig('', () => {});
    const iosDir = path.join(rootDir, 'native', 'ios');

    const template = readFileSync(path.join(iosDir, 'App', 'Info.plist.in'), 'utf8');
    const orientations = iosInterfaceOrientations(app.orientation)
        .map((o) => `\t\t<string>${o}</string>`).join('\n');
    writeFileSync(path.join(iosDir, 'App', 'Info.plist'), fillTemplate(template, {
        APP_NAME: app.name,
        VERSION_NAME: app.version,
        VERSION_CODE: app.versionCode,
        ORIENTATIONS: orientations,
    }), 'utf8');

    // project.yml includes this; keeping the bundle id out of the committed file is
    // what lets two projects build from one checkout without editing it.
    writeFileSync(path.join(iosDir, 'app.generated.yml'),
        '# Written by `cli native --target ios` from the exported project\'s app.config.json.\n'
        + '# Included by project.yml — do not edit, and do not commit.\n'
        + 'targets:\n'
        + '  EstellaiOS:\n'
        + '    settings:\n'
        + '      base:\n'
        + `        PRODUCT_BUNDLE_IDENTIFIER: ${app.id}\n`
        + `        MARKETING_VERSION: "${app.version}"\n`
        + `        CURRENT_PROJECT_VERSION: "${app.versionCode}"\n`, 'utf8');

    logger.info(`App: ${app.name} (${app.id}) v${app.version} — ${app.orientation}`);
}

async function buildIosHost(options) {
    if (process.platform !== 'darwin') throw new Error('The iOS host builds on macOS only.');
    const rootDir = config.paths.root;
    const slice = options.simulator ? IOS_SLICES.simulator : IOS_SLICES.device;

    // Unlike Android there is no pure-C++ reference host for iOS: the app IS the
    // JS host, so QuickJS is required rather than opt-in.
    const quickjs = quickjsDir(options);
    if (!quickjs) {
        throw new Error('The iOS host needs QuickJS: run `node build-tools/cli.js native --fetch-deps`, '
            + 'or pass --quickjs <dir> (or set ESTELLA_QUICKJS_DIR).');
    }

    const developerDir = await iosDeveloperDir();
    const env = developerDir ? { DEVELOPER_DIR: developerDir } : undefined;
    if (developerDir) logger.info(`Using DEVELOPER_DIR=${developerDir} (the active one has no iPhoneOS SDK)`);

    const { dawnDir, dawnBuild } = await dawnPaths(
        options, options.simulator ? 'ios-sim' : 'ios', { env });

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
    await assembleXcframework(rootDir, env, genDir);

    // See buildAndroidHost: the compiled half is project-independent, so it is
    // packed as a template the editor (and everyone without Xcode's dependencies)
    // can consume.
    if (options.template !== false) {
        await emitNativeTemplate({
            platform: 'ios', root: rootDir, deploymentTarget, zipTo: options.templateOut,
        });
    }

    // Without --package the engine's own native/ios shell is staged instead — that
    // one is for working ON the host, where the Xcode project is checked in and the
    // content is scratch.
    const staged = options.content ? await stageIosContent(rootDir, options.content) : null;
    await writeIosAppIdentity(rootDir, staged);
    logger.info('Next: cd native/ios && xcodegen && open EstellaiOS.xcodeproj — pick your Team, then Run.');
}

/** The export to package, resolved and checked. */
function packagedContent(options) {
    const rootDir = config.paths.root;
    if (!options.content) {
        throw new Error('--package needs the game to package: pass --content <dir> from '
            + "the editor's export.");
    }
    const dir = path.isAbsolute(options.content) ? options.content : path.join(rootDir, options.content);
    if (!existsSync(dir)) throw new Error(`--content dir not found: ${dir}`);
    return dir;
}

/** The installed runtime template for @p platform, or a message naming how to get one. */
function requireTemplate(platform) {
    const engineVersion = readEngineVersion(config.paths.root);
    const template = findTemplate({ platform, engineVersion });
    if (!template || template.missing.length > 0) {
        throw new Error(`No ${platform} runtime template for v${engineVersion}. Build one with `
            + `\`cli native --target ${platform}\`, or install a release archive into `
            + `${templateStoreDir()}.`);
    }
    return template;
}

/**
 * Assemble a runnable `.app` around an export, from the installed runtime
 * template. Pure Node: nothing here compiles, and the toolchain that produced the
 * template stayed on the machine that built it.
 */
async function packageDesktopApp(options) {
    const template = requireTemplate('macos');
    const contentDir = packagedContent(options);
    const app = readAppConfig(contentDir, (m) => logger.warn(m));
    const outDir = options.out
        ? (path.isAbsolute(options.out) ? options.out : path.join(config.paths.root, options.out))
        : path.dirname(contentDir);

    logger.step(`Assembling ${app.name}.app...`);
    const bundle = await assembleMacApp({
        templateDir: template.dir,
        contentDir,
        outDir,
        app,
        iconPng: options.icon,
        macosMin: options.macosMin || MACOS_MIN,
        signIdentity: options.signIdentity,
        warn: (m) => logger.warn(m),
    });
    logger.success(`macOS app: ${path.relative(config.paths.root, bundle) || bundle}`);
    logger.info(`Run it with: open "${bundle}"`);
    return bundle;
}

/**
 * Assemble a signed APK around an export — from the installed runtime template,
 * with no Android SDK involved. The same call the editor's export makes.
 */
async function packageAndroidApk(options) {
    const template = requireTemplate('android');
    const contentDir = packagedContent(options);
    const app = readAppConfig(contentDir, (m) => logger.warn(m));

    const key = options.key
        ? signingKeyFromPem({ key: options.key, cert: options.cert, passphrase: options.passphrase })
        : debugSigningKey();
    if (!options.key) logger.info('Signing with the development key (sideload only — not for a store).');

    const assembly = { templateDir: template.dir, contentDir, app, key };
    logger.step('Assembling the APK...');
    const apk = assembleApk(assembly);
    const out = path.join(contentDir, apkFileName(app.id));
    writeFileSync(out, apk);

    logger.success(`APK: ${out} (${(apk.length / 1048576).toFixed(1)} MB)`);
    logger.info(`App: ${app.name} (${app.id}) v${app.version} — ${app.orientation}, signed by ${key.name}`);
    logger.info(`Install it with: adb install -r ${out}`);

    if (options.aab) {
        logger.step('Assembling the App Bundle...');
        const bundle = assembleAab(assembly);
        const aab = path.join(contentDir, aabFileName(app.id));
        writeFileSync(aab, bundle);
        logger.success(`App Bundle: ${aab} (${(bundle.length / 1048576).toFixed(1)} MB)`);
        logger.info('Upload it to Google Play — a bundle is not installable; Play builds the APKs from it.');
    }
}

/**
 * Wrap an iOS export in an Xcode project — from the installed runtime template,
 * with no compiler involved. The same call the editor's export makes, so a project
 * assembled here and one assembled there are the same project.
 */
async function packageIosProject(options) {
    const template = requireTemplate('ios');
    const contentDir = packagedContent(options);
    const app = readAppConfig(contentDir, (m) => logger.warn(m));
    const projectDir = await emitIosXcodeProject(
        contentDir, app, iosTemplateSources(template.dir),
        options.iosMin || template.manifest.deploymentTarget);
    logger.success(`iOS project: ${projectDir}`);
    logger.info(`App: ${app.name} (${app.id}) v${app.version} — ${app.orientation}`);
    logger.info(`Next: open ${projectDir} — pick your Team under Signing & Capabilities, then Run.`);
}

/** Pack what a previous build left behind, without rebuilding — what CI runs after
 *  its build step, and what re-stamps a template whose emit failed. */
async function emitFromExistingBuild(target, options) {
    const rootDir = config.paths.root;
    if (target === 'ios') {
        return emitNativeTemplate({
            platform: 'ios', root: rootDir,
            deploymentTarget: options.iosMin, zipTo: options.templateOut,
        });
    }
    const sdk = requireSdk();
    const dawnBuild = options.dawnBuild || process.env.ESTELLA_DAWN_BUILD;
    const abi = options.abi || 'arm64-v8a';
    return emitNativeTemplate({
        platform: 'android', abis: [abi], root: rootDir,
        dawnLibrary: (want) => (want === abi && dawnBuild ? dawnLibrary(dawnBuild, 'android') : null),
        ndk: requireNdk(sdk), sdk, androidPlatform: options.platform, jdk: options.jdk,
        zipTo: options.templateOut,
    });
}

/**
 * Build the pinned dependencies for a target and stop.
 *
 * For a job that exists only to populate the dependency cache. Dawn is the whole
 * cost — the host beside it is minutes — so building the host too would only add
 * ways for a cache warm-up to fail for reasons that have nothing to do with what
 * it is caching.
 *
 * EVERY build tree the consumers look for, not just the default one: Dawn's is
 * per ABI on Android and per sysroot on iOS, so a warm-up that did one would
 * leave the release cold in exactly the half it did not do.
 */
async function buildNativeDeps(options) {
    const target = (options.target || 'android').toLowerCase();
    if (target === 'android') {
        const sdk = requireSdk();
        const ndk = requireNdk(sdk);
        const { cmake, ninja } = sdkCmake(sdk);
        for (const abi of ANDROID_ABIS) {
            logger.step(`Dawn for android/${abi}...`);
            await dawnPaths({ ...options, abi }, 'android', { ndk, cmake, ninja });
        }
        logger.success(`Dawn built for ${ANDROID_ABIS.join(', ')}`);
        return;
    }
    if (isDesktopTarget(target)) {
        // Both of them: SDL is minutes where Dawn is tens of them, but a warm cache
        // missing the small one still makes the next build fetch and configure.
        await dawnPaths(options, target);
        await sdlPrefix(options, target);
        logger.success(`Dawn and SDL built for ${target}`);
        return;
    }
    const developerDir = await iosDeveloperDir();
    const env = developerDir ? { DEVELOPER_DIR: developerDir } : undefined;
    for (const slice of ['ios', 'ios-sim']) {
        logger.step(`Dawn for ${slice}...`);
        await dawnPaths(options, slice, { env });
    }
    logger.success('Dawn built for ios, ios-sim');
}

export async function buildNative(options = {}) {
    if (options.fetchDeps) return fetchNativeDeps(options);
    if (options.buildDeps) return buildNativeDeps(options);
    if (options.templateIndex) {
        return writeTemplateIndex(path.isAbsolute(options.templateIndex)
            ? options.templateIndex : path.join(config.paths.root, options.templateIndex));
    }
    const target = (options.target || 'android').toLowerCase();
    if (target !== 'ios' && target !== 'android' && !isDesktopTarget(target)) {
        throw new Error(`Unknown --target ${target} (expected android, ios or macos).`);
    }
    if (isDesktopTarget(target)) {
        if (options.package) return packageDesktopApp(options);
        if (options.templateOnly) {
            return emitNativeTemplate({ platform: target, root: config.paths.root, zipTo: options.templateOut });
        }
        return buildDesktopHost(options);
    }
    if (options.templateOnly) return emitFromExistingBuild(target, options);
    // Packaging is ASSEMBLY: every piece comes from the installed runtime template,
    // so it needs no toolchain and never builds.
    if (options.package) return target === 'ios' ? packageIosProject(options) : packageAndroidApk(options);
    return target === 'ios' ? buildIosHost(options) : buildAndroidHost(options);
}
