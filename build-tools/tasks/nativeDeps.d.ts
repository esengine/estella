// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for nativeDeps.js, which is plain ESM so the CLI runs it unbuilt.

/** One pinned dependency, as toolchain.manifest.json carries it. */
export interface NativePin {
    repo: string;
    commit: string;
}

export interface NativePins {
    dawn: NativePin;
    quickjs: NativePin;
    sdl?: NativePin;
}

export function nativeDepsDir(rootDir?: string): string;
export function nativePins(rootDir?: string): NativePins;

/** Whether a target's window and gamepads come from SDL rather than the OS's own
 *  app framework — which is also what decides whether SDL keys its cache. */
export function isDesktopTarget(target: string): boolean;

/** The cache key for a target's prebuilt dependencies: every pin that build
 *  consumes, and only those. */
export function depsCacheKey(target: string, rootDir?: string): string;

export function pinnedDep(name: string, rootDir?: string): string | null;
export function fetchNativeDeps(options?: Record<string, unknown>): Promise<void>;
export function ensureSdlBuild(options: Record<string, unknown>): Promise<string>;
export function ensureDawnBuild(options: Record<string, unknown>): Promise<string>;
export function dawnLibrary(dawnBuild: string, target: string): string;
export function dawnBuildDir(dawn: string, target: string, abi?: string): string;
export const DAWN_TARGETS: Record<string, unknown>;
export const MACOS_MIN: string;
