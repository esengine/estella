// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The Android SDK, or null when none is found. */
export function androidSdk(): string | null;
/** The newest entry under `dir`, or null. */
export function newest(dir: string): string | null;
/** The SDK, or a throw that says how to install one. */
export function requireSdk(): string;
/** The NDK (ANDROID_NDK_HOME / ANDROID_NDK_ROOT, else the newest under the SDK), or a throw. */
export function requireNdk(sdk: string): string;
/** aapt2 / zipalign / apksigner, from the newest installed build-tools. */
export function buildTool(sdk: string, name: string): string;
export function platformJar(sdk: string, platform?: string): string;
export function javaHome(explicit?: string): string | null;
export function jdkTool(name: string, explicit?: string): string;
/** A tool of the NDK's LLVM toolchain (clang, llvm-readelf, …), with the host's executable suffix. */
export function ndkTool(ndk: string, name: string): string;
export function ndkLibcxxShared(ndk: string, triple?: string): string;
export function sdkCmake(sdk: string): string | null;
