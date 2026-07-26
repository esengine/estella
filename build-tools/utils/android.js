// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Locating the Android toolchain — the SDK, its build-tools, a platform jar and
// the NDK bits the native host build and the APK packaging both need. Nothing is
// hardcoded per machine: everything hangs off ANDROID_HOME or Android Studio's
// default install.

import path from 'path';
import { existsSync, readdirSync } from 'fs';

export function androidSdk() {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (sdk && existsSync(sdk)) return sdk;
    // Android Studio's default install location.
    const dflt = path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'Android', 'Sdk');
    return existsSync(dflt) ? dflt : null;
}

/** The lexicographically newest entry in @p dir — SDK components are versioned by name. */
export function newest(dir) {
    if (!existsSync(dir)) return null;
    const entries = readdirSync(dir).sort();
    return entries.length ? path.join(dir, entries[entries.length - 1]) : null;
}

export function requireSdk() {
    const sdk = androidSdk();
    if (!sdk) throw new Error('Android SDK not found. Set ANDROID_HOME (install via Android Studio).');
    return sdk;
}

export function requireNdk(sdk) {
    // An NDK installed outside the SDK (a CI action, a manual unzip) exports one
    // of these; Android Studio's lives under the SDK.
    const explicit = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT].find(
        (dir) => dir && existsSync(dir));
    if (explicit) return explicit;
    const ndk = newest(path.join(sdk, 'ndk'));
    if (!ndk) {
        throw new Error(`No NDK under ${sdk}/ndk and no ANDROID_NDK_HOME. `
            + "Install one via Android Studio's SDK Manager.");
    }
    return ndk;
}

const exe = process.platform === 'win32' ? '.exe' : '';

/** aapt2 / zipalign / apksigner, from the newest installed build-tools. */
export function buildTool(sdk, name) {
    const dir = newest(path.join(sdk, 'build-tools'));
    if (!dir) throw new Error(`No build-tools under ${sdk}/build-tools. Install them via the SDK Manager.`);
    // apksigner and d8 are JVM launchers — a shell script, or a .bat on Windows;
    // the rest are native binaries.
    const script = name === 'apksigner' || name === 'd8';
    const suffix = script ? (process.platform === 'win32' ? '.bat' : '') : exe;
    const tool = path.join(dir, name + suffix);
    if (!existsSync(tool)) throw new Error(`${name} not found at ${tool}.`);
    return tool;
}

/** The android.jar aapt2 links against; falls back to the newest installed platform. */
export function platformJar(sdk, platform) {
    const wanted = path.join(sdk, 'platforms', platform, 'android.jar');
    if (existsSync(wanted)) return wanted;
    const newestPlatform = newest(path.join(sdk, 'platforms'));
    const jar = newestPlatform && path.join(newestPlatform, 'android.jar');
    if (!jar || !existsSync(jar)) {
        throw new Error(`No android.jar for ${platform} under ${sdk}/platforms. Install it via the SDK Manager.`);
    }
    return jar;
}

/**
 * The JDK the APK step runs on. Packaging needs one for `jar` and `keytool`, and
 * apksigner needs one to launch at all — but a machine that got its JDK through
 * Android Studio has it bundled beside the IDE with nothing exported, so none of
 * them are on PATH. Looks where a JDK actually lives; null when there is none.
 *
 * @param explicit An explicitly configured JDK home (`--jdk`), which always wins.
 */
export function javaHome(explicit) {
    const roots = [
        explicit,
        process.env.ESTELLA_JDK,
        process.env.JAVA_HOME,
        // Android Studio's bundled runtime (JetBrains Runtime), at its default
        // install location per platform.
        ...(process.platform === 'darwin'
            ? ['/Applications/Android Studio.app/Contents/jbr/Contents/Home']
            : process.platform === 'win32'
                ? [
                    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
                    path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'Android Studio', 'jbr'),
                ]
                : ['/opt/android-studio/jbr', path.join(process.env.HOME || '', 'android-studio', 'jbr')]),
    ].filter(Boolean);
    return roots.find((root) => existsSync(path.join(root, 'bin', 'java' + exe))) ?? null;
}

/** A JDK tool (`jar`, `keytool`) from {@link javaHome}, or from PATH when a JDK is
 *  already exported there. */
export function jdkTool(name, explicit) {
    const home = javaHome(explicit);
    if (home) return path.join(home, 'bin', name + exe);
    if (process.env.PATH?.split(path.delimiter).some((dir) => existsSync(path.join(dir, name + exe)))) {
        return name;
    }
    throw new Error(`No JDK found for \`${name}\` (the APK step needs one, as does apksigner). `
        + 'Set JAVA_HOME, or pass --jdk <dir> — Android Studio bundles one at <install>/jbr.');
}

/** The NDK's LLVM toolchain dir — its host tag is the only entry under prebuilt/. */
function llvmPrebuilt(ndk) {
    const prebuilt = path.join(ndk, 'toolchains', 'llvm', 'prebuilt');
    const host = newest(prebuilt);
    if (!host) throw new Error(`No LLVM toolchain under ${prebuilt}.`);
    return host;
}

export function ndkTool(ndk, name) {
    return path.join(llvmPrebuilt(ndk), 'bin', name + exe);
}

/** The shared libc++ an ANDROID_STL=c++_shared build expects inside the APK. */
export function ndkLibcxxShared(ndk, triple = 'aarch64-linux-android') {
    const lib = path.join(llvmPrebuilt(ndk), 'sysroot', 'usr', 'lib', triple, 'libc++_shared.so');
    if (!existsSync(lib)) throw new Error(`libc++_shared.so not found at ${lib}.`);
    return lib;
}

/** Prefer the NDK-bundled CMake (>= 3.22, ships ninja) over whatever is on PATH —
 *  CMake 4.x rejects the pre-3.5 minimums in some transitive deps. */
export function sdkCmake(sdk) {
    const cmakeRoot = newest(path.join(sdk, 'cmake'));
    if (!cmakeRoot) return { cmake: 'cmake', ninja: null };
    const bin = path.join(cmakeRoot, 'bin');
    return { cmake: path.join(bin, 'cmake' + exe), ninja: path.join(bin, 'ninja' + exe) };
}
