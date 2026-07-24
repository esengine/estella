// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// APK packaging for the native host — the Android counterpart of what Xcode does
// for native/ios. No gradle: the host is a NativeActivity with no Java, so the
// APK is just aapt2 link, the .so payload, zipalign and apksigner. The game and
// its content go in as assets/, which is where the host's readAsset() looks.

import path from 'path';
import { existsSync } from 'fs';
import { mkdir, copyFile, rm } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand } from '../utils/emscripten.js';
import { requireSdk, requireNdk, buildTool, platformJar, ndkTool, ndkLibcxxShared } from '../utils/android.js';

const HOSTS = {
    // The product-shaped runtime: the QuickJS host + the SDK + a game asset.
    js: {
        manifest: 'host_js',
        library: 'libestella_js_host.so',
        assets: ['game.js', 'logo.png'],
        apk: 'estella-js-host.apk',
    },
    // The pure-C++ smoke test: one ECS scene, no JS, no assets.
    cpp: {
        manifest: 'host_cpp',
        library: 'libestella_host.so',
        assets: [],
        apk: 'estella-host.apk',
    },
};

// A debug keystore is enough to sideload; Android Studio uses the same one. Create
// it on first use so packaging never stops to ask for credentials.
async function debugKeystore() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const keystore = path.join(home, '.android', 'debug.keystore');
    if (existsSync(keystore)) return keystore;
    logger.step('Creating the Android debug keystore...');
    await mkdir(path.dirname(keystore), { recursive: true });
    await runCommand('keytool', [
        '-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android',
        '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-dname', 'CN=Android Debug,O=Android,C=US',
    ]);
    return keystore;
}

// APKs are zips; `jar` ships with the JDK that apksigner already requires, so it
// is the one archiver we can count on wherever packaging runs.
async function addToApk(apk, stagingDir) {
    await runCommand('jar', ['ufM', apk, '-C', stagingDir, 'lib']);
}

export async function packageNativeApk(options = {}) {
    const hostKey = (options.host || 'js').toLowerCase();
    const host = HOSTS[hostKey];
    if (!host) throw new Error(`Unknown --host ${hostKey} (expected js or cpp).`);

    const rootDir = config.paths.root;
    const buildDir = path.join(rootDir, 'build-native');
    const library = path.join(buildDir, host.library);
    if (!existsSync(library)) {
        throw new Error(`${host.library} not found in build-native/. Build it first: `
            + `node build-tools/cli.js native${hostKey === 'js' ? ' --quickjs <dir>' : ''} --dawn <src> --dawn-build <build>.`);
    }

    const dawnBuild = options.dawnBuild || process.env.ESTELLA_DAWN_BUILD;
    if (!dawnBuild) throw new Error('Pass --dawn-build <dir> (or set ESTELLA_DAWN_BUILD) — the APK ships libwebgpu_dawn.so.');
    const dawnLib = path.join(dawnBuild, 'src', 'dawn', 'native', 'libwebgpu_dawn.so');
    if (!existsSync(dawnLib)) throw new Error(`Dawn library not found: ${dawnLib}.`);

    const sdk = requireSdk();
    const ndk = requireNdk(sdk);
    const abi = options.abi || 'arm64-v8a';
    const platform = options.platform || 'android-33';

    const staging = path.join(buildDir, `apk-${hostKey}`);
    const libDir = path.join(staging, 'lib', abi);
    await rm(staging, { recursive: true, force: true });
    await mkdir(libDir, { recursive: true });

    logger.step('Staging the native libraries...');
    await copyFile(library, path.join(libDir, host.library));
    await copyFile(ndkLibcxxShared(ndk), path.join(libDir, 'libc++_shared.so'));
    // Dawn carries debug info an APK does not need — it dominates the payload.
    await runCommand(ndkTool(ndk, 'llvm-strip'), [
        '--strip-all', '-o', path.join(libDir, 'libwebgpu_dawn.so'), dawnLib,
    ]);

    let assetsDir = null;
    if (host.assets.length) {
        assetsDir = path.join(staging, 'assets');
        await mkdir(assetsDir, { recursive: true });
        for (const asset of host.assets) {
            await copyFile(path.join(rootDir, 'native', 'host_js', asset), path.join(assetsDir, asset));
        }
    }

    const unsigned = path.join(staging, 'unsigned.apk');
    const aligned = path.join(buildDir, host.apk);
    logger.step('Linking resources (aapt2)...');
    await runCommand(buildTool(sdk, 'aapt2'), [
        'link',
        '--manifest', path.join(rootDir, 'native', 'android', host.manifest, 'AndroidManifest.xml'),
        '-I', platformJar(sdk, platform),
        ...(assetsDir ? ['-A', assetsDir] : []),
        '-o', unsigned,
    ]);

    logger.step('Adding the native libraries...');
    await addToApk(unsigned, staging);

    logger.step('Aligning + signing...');
    await rm(aligned, { force: true });
    await runCommand(buildTool(sdk, 'zipalign'), ['-f', '4', unsigned, aligned]);
    const keystore = options.keystore || await debugKeystore();
    await runCommand(buildTool(sdk, 'apksigner'), [
        'sign', '--ks', keystore,
        ...(options.keystore ? [] : ['--ks-pass', 'pass:android', '--key-pass', 'pass:android',
            '--ks-key-alias', 'androiddebugkey']),
        aligned,
    ]);

    logger.success(`APK: ${path.relative(rootDir, aligned)}`);
    logger.info('Install it with: adb install -r ' + path.relative(rootDir, aligned));
}
