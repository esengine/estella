// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for nativeTemplate.js — the module is plain ESM so the CLI can run it
// unbuilt, and this is how the editor's TypeScript sees it.

/** Every platform a runtime template exists for. `macos` is one of them because a
 *  desktop package is assembled from a template exactly as a phone's is — that
 *  sameness is the point (see docs/REARCH_STEAM.md §6.0). */
/**
 * Every platform a runtime TEMPLATE is published for. Distinct from the export
 * target vocabulary in desktop/src/project/platforms.ts, which spells the three
 * desktop OSes as one `desktop` target — the two shared the name `NativePlatform`,
 * and every layer above hand-narrowed this one back to the mobile pair.
 */
export type TemplatePlatform = 'android' | 'ios' | 'macos' | 'windows' | 'linux';

export interface NativeTemplateManifest {
    kind: 'estella-native-template';
    formatVersion: number;
    id: string;
    platform: TemplatePlatform;
    /** Android only: the architectures this template carries. */
    abis?: string[];
    /** Matched EXACTLY against the editor's version: the SDK bundle is compiled
     *  into the host binary, so a near-miss fails on a device. */
    engineVersion: string;
    spineVersion: string;
    /** iOS only. */
    deploymentTarget?: string;
    /** Android only. */
    androidPlatform?: string;
}

export interface TemplateWant {
    platform: TemplatePlatform;
    engineVersion: string;
}

export interface FoundTemplate {
    dir: string;
    manifest: NativeTemplateManifest;
    /** Required files the directory does not actually hold. */
    missing: string[];
}

export const TEMPLATE_FORMAT: number;
export const TEMPLATE_MANIFEST: string;
export const BYTECODE_FILE: string;
export const ANDROID_ABIS: readonly string[];

export function templateId(platform: TemplatePlatform): TemplatePlatform;

/** Every platform a template is built and published for — the one list the
 *  layouts and the release verifier both ask. */
export const TEMPLATE_PLATFORMS: readonly TemplatePlatform[];
export function isTemplatePlatform(platform: unknown): platform is TemplatePlatform;
export function templateAbis(dir: string): string[];
export interface TemplateEntry {
    /** Path inside the template. */
    rel: string;
    /** Android: which architecture this file belongs to. */
    abi?: string;
    kind?: 'dir';
    optional?: boolean;
    /** Produced by the emitter rather than copied (the Java shim's dex). */
    produced?: boolean;
}

export function templateLayout(platform: TemplatePlatform, options?: { abis?: readonly string[] }): TemplateEntry[];
export function requiredTemplateFiles(platform: TemplatePlatform, options?: { abis?: readonly string[]; release?: boolean }): string[];
export function missingTemplateFiles(dir: string, platform: TemplatePlatform, options?: { abis?: readonly string[] }): string[];
/** The same question asked of a NAME LIST rather than a directory — what a zip
 *  is missing, checked before it is unpacked. */
export function missingTemplateEntries(
  names: readonly string[],
  platform: TemplatePlatform,
  options?: { abis?: readonly string[]; release?: boolean },
): string[];
export function writeTemplateManifest(
  dir: string,
  meta: { platform: TemplatePlatform; engineVersion: string; abi?: string } & Record<string, unknown>,
): NativeTemplateManifest;
export function readTemplateManifest(dir: string): NativeTemplateManifest | null;
export function templateMatches(manifest: NativeTemplateManifest | null, want: TemplateWant): boolean;
export function templateZipName(platform: TemplatePlatform, engineVersion: string): string;
export function estellaDataDir(): string;
export function templateStoreDir(): string;
export function installedTemplateDir(
    engineVersion: string, platform: TemplatePlatform, storeDir?: string): string;
export function findTemplate(want: TemplateWant, storeDir?: string): FoundTemplate | null;
export interface PublishedTemplate {
    id: string;
    platform: TemplatePlatform;
    /** Archive filename, resolved against the release's asset base. */
    file: string;
    bytes: number;
    sha256: string;
}

export const TEMPLATE_INDEX: string;
export const RELEASE_MIRROR_ENV: string;
export const DEFAULT_RELEASE_MIRROR: string;
export const RELEASE_ORIGIN: string;

/** Mirrors to try before the origin, fastest-first. */
export function releaseMirrors(env?: NodeJS.ProcessEnv): string[];

export function releaseAssetBase(engineVersion: string): string;

/** Every base to try for one version: the mirrors, then the origin. */
export function releaseAssetBases(engineVersion: string, env?: NodeJS.ProcessEnv): string[];
export function parseTemplateIndex(doc: unknown, engineVersion?: string): PublishedTemplate[] | null;
export const DEFAULT_ICON: string;
/** The pieces an exported Android Studio project is assembled from. */
export function androidTemplateSources(dir: string): {
    /** The engine's shared libraries, one directory per ABI. */
    libs: string;
    /** The host's Java shim, as source. */
    java: string;
    /** The same shim precompiled, for the package path that needs no JDK. */
    dex: string;
    manifestIn: string;
    /** The default launcher icon, used when the project sets none. */
    icon: string;
    /** Precompiled SDK bytecode, when the template's build machine could produce it. */
    bytecode: string;
};

export function desktopTemplateSources(dir: string, platform?: TemplatePlatform): {
    /** The runtime binary; the assembler renames it to the app. */
    executable: string;
    infoPlistIn: string;
    icon: string;
    bytecode: string;
    /** Windows only. */
    d3dCompiler: string;
    /** Steam's redistributable, when the template was emitted with an SDK. */
    steamRedist: string;
};

export function iosTemplateSources(dir: string): {
    xcframework: string;
    mainM: string;
    infoPlistIn: string;
    /** The default launcher icon, used when the project sets none. */
    icon: string;
    /** Precompiled SDK bytecode, when the template's build machine could produce
     *  it — the difference between a fast first launch and a parse. */
    bytecode: string;
};
