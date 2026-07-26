// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// APK packaging for the native host — the Android counterpart of what Xcode does
// for native/ios. No gradle: the host is a NativeActivity with no Java, so the
// APK is just aapt2 link, the .so payload, zipalign and apksigner. The game and
// its content go in as assets/, which is where the host's readAsset() looks.

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { mkdir, copyFile, cp, rm, writeFile } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand } from '../utils/emscripten.js';
import { requireSdk, requireNdk, buildTool, platformJar, ndkTool, ndkLibcxxShared, javaHome, jdkTool } from '../utils/android.js';
import { readAppConfig, androidScreenOrientation, fillTemplate } from '../utils/nativeApp.js';


const HOST_LIBRARY = 'libestella_js_host.so';

/**
 * The shipped bytecode's filename. NOT `.bc`: that is LLVM bitcode's extension, and
 * aapt2 treats a `.bc` asset as RenderScript output — which silently drops the APK's
 * native-code declaration, so the package installs nowhere. Cost a long hunt; the
 * only symptom is INSTALL_FAILED_NO_MATCHING_ABIS on a device whose ABI matches.
 */
export const BYTECODE_FILE = 'esengine.native.qjsbc';
const MANIFEST_TEMPLATE = path.join('native', 'android', 'host', 'AndroidManifest.xml.in');

/** The APK is named after the app it contains, so packaging a second project does
 *  not quietly replace the first one's file. */
const apkName = (appId) => `${appId.split('.').pop() || 'estella'}.apk`;

// A debug keystore is enough to sideload; Android Studio uses the same one. Create
// it on first use so packaging never stops to ask for credentials.
async function debugKeystore(jdk) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const keystore = path.join(home, '.android', 'debug.keystore');
    if (existsSync(keystore)) return keystore;
    logger.step('Creating the Android debug keystore...');
    await mkdir(path.dirname(keystore), { recursive: true });
    await runCommand(jdkTool('keytool', jdk), [
        '-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android',
        '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-dname', 'CN=Android Debug,O=Android,C=US',
    ]);
    return keystore;
}

// APKs are zips; `jar` ships with the JDK that apksigner already requires, so it
// is the one archiver we can count on wherever packaging runs.
//
// It carries the ASSETS too, rather than letting `aapt2 link -A` do it: on Windows
// aapt2 writes nested asset paths with backslashes ("assets/assets\scenes\x"), and
// a zip entry name must use forward slashes — so AAssetManager could not open
// anything in a subdirectory. Invisible while the packaged content was a handful
// of flat files; every real project export has directories.
async function addToApk(apk, stagingDir, entries, jdk) {
    await runCommand(jdkTool('jar', jdk), ['ufM', apk, ...entries.flatMap((e) => ['-C', stagingDir, e])]);
}

export async function packageNativeApk(options = {}) {
    const rootDir = config.paths.root;
    const buildDir = path.join(rootDir, 'build-native');
    const library = path.join(buildDir, HOST_LIBRARY);
    if (!existsSync(library)) {
        throw new Error(`${HOST_LIBRARY} not found in build-native/. Build it first: `
            + 'node build-tools/cli.js native --quickjs <dir> --dawn <src> --dawn-build <build>.');
    }

    const dawnBuild = options.dawnBuild || process.env.ESTELLA_DAWN_BUILD;
    if (!dawnBuild) throw new Error('Pass --dawn-build <dir> (or set ESTELLA_DAWN_BUILD) — the APK ships libwebgpu_dawn.so.');
    const dawnLib = path.join(dawnBuild, 'src', 'dawn', 'native', 'libwebgpu_dawn.so');
    if (!existsSync(dawnLib)) throw new Error(`Dawn library not found: ${dawnLib}.`);

    const sdk = requireSdk();
    const ndk = requireNdk(sdk);
    const abi = options.abi || 'arm64-v8a';
    const platform = options.platform || 'android-33';

    const staging = path.join(buildDir, 'apk');
    const libDir = path.join(staging, 'lib', abi);
    await rm(staging, { recursive: true, force: true });
    await mkdir(libDir, { recursive: true });

    logger.step('Staging the native libraries...');
    await copyFile(ndkLibcxxShared(ndk), path.join(libDir, 'libc++_shared.so'));
    // Both carry debug info an APK does not need, and the host's is most of its
    // size. Shipping it unstripped also broke installing onto a clean device --
    // the extract step gave up on the payload -- which only reproduced on a first
    // install, since replacing an existing package never re-extracted it.
    for (const [src, dst] of [[library, HOST_LIBRARY], [dawnLib, 'libwebgpu_dawn.so']]) {
        await runCommand(ndkTool(ndk, 'llvm-strip'), [
            '--strip-all', '-o', path.join(libDir, dst), src,
        ]);
    }

    // assets/ is what the host's readAsset() sees, and what goes in is an editor
    // export — cooked assets + manifests + scenes + game.config.json. A whole-
    // directory copy, so nothing here carries a file list that could drift from
    // what the export actually wrote.
    if (!options.content) {
        // Nothing to run: the host boots game.config.json and there is no built-in
        // fallback, by design — the packaged game takes the same path every real
        // game takes.
        throw new Error('The host needs a project to run: pass --content <dir> from '
            + "Package Project -> Android (or `exportGame({ platform: 'android' })`).");
    }
    const content = path.isAbsolute(options.content) ? options.content : path.join(rootDir, options.content);
    if (!existsSync(content)) throw new Error(`--content dir not found: ${content}`);
    await cp(content, path.join(staging, 'assets'), { recursive: true });
    logger.step(`Staging exported content from ${path.relative(rootDir, content)}...`);

    // The bundle's bytecode, if this machine could build it. Without it the first
    // launch spends ~14 s parsing the bundle before anything is drawn; with it the
    // host reads the compile straight off and the first launch matches the rest.
    // Absent is a valid state — the host falls back to compiling (see Runtime.cpp).
    const bytecode = path.join(rootDir, 'build-native', 'gen', BYTECODE_FILE);
    if (existsSync(bytecode)) {
        await cp(bytecode, path.join(staging, 'assets', BYTECODE_FILE));
        logger.step('Staging the precompiled SDK bytecode...');
    } else {
        logger.warn('No precompiled bytecode: the first launch will compile the bundle '
            + '(~14 s of black screen). Install a host C compiler to avoid it.');
    }

    // The app the content asks to be: identity, version, and the orientation the
    // OS must lock the window to. The manifest is a template because all four vary
    // per project — a static one is why every example installed over the last.
    const app = readAppConfig(content, (m) => logger.warn(m));
    const manifest = path.join(staging, 'AndroidManifest.xml');
    await writeFile(manifest, fillTemplate(readFileSync(path.join(rootDir, MANIFEST_TEMPLATE), 'utf8'), {
        APP_ID: app.id,
        APP_NAME: app.name,
        VERSION_NAME: app.version,
        VERSION_CODE: app.versionCode,
        SCREEN_ORIENTATION: androidScreenOrientation(app.orientation),
    }));
    logger.info(`App: ${app.name} (${app.id}) v${app.version} — ${app.orientation}`);

    const unsigned = path.join(staging, 'unsigned.apk');
    const aligned = path.join(buildDir, apkName(app.id));
    logger.step('Linking resources (aapt2)...');
    // aapt2 produces the base APK from the manifest alone; the payload (libraries
    // and assets) is added below, where the entry names are ours to control.
    await runCommand(buildTool(sdk, 'aapt2'), [
        'link',
        '--manifest', manifest,
        '-I', platformJar(sdk, platform),
        '-o', unsigned,
    ]);

    logger.step('Adding the native libraries and the game...');
    await addToApk(unsigned, staging, ['lib', 'assets'], options.jdk);

    logger.step('Aligning + signing...');
    await rm(aligned, { force: true });
    await runCommand(buildTool(sdk, 'zipalign'), ['-f', '4', unsigned, aligned]);
    const keystore = options.keystore || await debugKeystore(options.jdk);
    // apksigner is a launcher script that finds java through JAVA_HOME; hand it the
    // JDK we located so it works on a machine that never exported one.
    const home = javaHome(options.jdk);
    await runCommand(buildTool(sdk, 'apksigner'), [
        'sign', '--ks', keystore,
        ...(options.keystore ? [] : ['--ks-pass', 'pass:android', '--key-pass', 'pass:android',
            '--ks-key-alias', 'androiddebugkey']),
        aligned,
    ], home ? { env: { ...process.env, JAVA_HOME: home } } : undefined);

    logger.success(`APK: ${path.relative(rootDir, aligned)}`);
    logger.info('Install it with: adb install -r ' + path.relative(rootDir, aligned));
}
