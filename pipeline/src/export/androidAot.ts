// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    androidAot.ts
 * @brief   Compiled systems for an Android package: the NDK's clang, once per ABI
 *          the package carries.
 *
 * The same C the desktop builds, and the same 64-bit handshake: a phone's
 * interpreter is the QuickJS the desktop host embeds, and a compiled system takes
 * its frame from ~10 us/entity to tens of ns there. What differs is only WHERE the
 * machine code comes from (a cross-compiler, not the host's cc) and where it is
 * put: `lib/<abi>/` of the APK, as a `lib*.so`, which the system linker finds by
 * its bare name for whichever ABI the phone installed. So the package config
 * names the library bare, and each ABI directory holds its own build of it.
 *
 * A 32-bit ABI is left out: the handshake carries the address width, and a module
 * built with 8-byte addresses is refused by a 4-byte host — that ABI's systems
 * stay interpreted rather than read half a pointer.
 */
import { existsSync } from 'node:fs';
import { androidSdk, requireNdk, ndkTool } from '../../../build-tools/utils/android.js';

/** The library a packaged Android game's compiled systems are, in every `lib/<abi>/`. */
export const ANDROID_AOT_LIBRARY = 'libestella_systems.so';

/** The lowest Android the package installs on (the manifest's minSdk); the code is built for it. */
const ANDROID_API = 29;

/** ABIs a compiled module is built for, and the clang target of each. 64-bit only, see the file comment. */
const ANDROID_AOT_TRIPLES: Readonly<Record<string, string>> = {
    'arm64-v8a': 'aarch64-linux-android',
    'x86_64': 'x86_64-linux-android',
};

/** One compiler invocation: the NDK's clang, aimed at one ABI. */
export interface AndroidAotCompiler {
    abi: string;
    cc: string;
    flags: string[];
}

/**
 * The compilers for the @p abis a package carries, or a reason there are none.
 * ABIs with no 64-bit triple are reported in `skipped`, not refused.
 */
export function androidAotCompilers(abis: readonly string[]): {
    compilers: AndroidAotCompiler[]; skipped: string[]; missing: string | null;
} {
    const skipped = abis.filter((abi) => !ANDROID_AOT_TRIPLES[abi]);
    const wanted = abis.filter((abi) => ANDROID_AOT_TRIPLES[abi]);
    if (wanted.length === 0) return { compilers: [], skipped, missing: null };
    let ndk: string;
    try {
        const sdk = androidSdk();
        ndk = requireNdk(sdk ?? '');
    } catch (err) {
        return { compilers: [], skipped, missing: err instanceof Error ? err.message : String(err) };
    }
    const clang = ndkTool(ndk, 'clang');
    if (!existsSync(clang)) return { compilers: [], skipped, missing: `the NDK at ${ndk} has no clang (${clang})` };
    return {
        compilers: wanted.map((abi) => ({
            abi, cc: clang,
            // A position-independent shared object the system linker loads; the
            // exports are the module's own ES_EXPORT names.
            flags: [`--target=${ANDROID_AOT_TRIPLES[abi]}${ANDROID_API}`, '-shared', '-fPIC'],
        })),
        skipped, missing: null,
    };
}

/** Whether this machine can build an Android module at all (the editor's prerequisite probe). */
export function hasAndroidAotCompiler(): boolean {
    return androidAotCompilers(['arm64-v8a']).compilers.length > 0;
}
