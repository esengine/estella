// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for nativeTemplate.js — the module is plain ESM so the CLI can run it
// unbuilt, and this is how the editor's TypeScript sees it.

export type NativePlatform = 'android' | 'ios';

export interface NativeTemplateManifest {
    kind: 'estella-native-template';
    formatVersion: number;
    id: string;
    platform: NativePlatform;
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
    platform: NativePlatform;
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

export function templateId(platform: NativePlatform): string;
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

export function templateLayout(platform: NativePlatform, options?: { abis?: readonly string[] }): TemplateEntry[];
export function requiredTemplateFiles(platform: NativePlatform, options?: { abis?: readonly string[] }): string[];
export function missingTemplateFiles(dir: string, platform: NativePlatform, options?: { abis?: readonly string[] }): string[];
export function readTemplateManifest(dir: string): NativeTemplateManifest | null;
export function templateMatches(manifest: NativeTemplateManifest | null, want: TemplateWant): boolean;
export function templateZipName(platform: NativePlatform, engineVersion: string): string;
export function estellaDataDir(): string;
export function templateStoreDir(): string;
export function installedTemplateDir(
    engineVersion: string, platform: NativePlatform, storeDir?: string): string;
export function findTemplate(want: TemplateWant, storeDir?: string): FoundTemplate | null;
export interface PublishedTemplate {
    id: string;
    platform: NativePlatform;
    /** Archive filename, resolved against the release's asset base. */
    file: string;
    bytes: number;
    sha256: string;
}

export const TEMPLATE_INDEX: string;
export function releaseAssetBase(engineVersion: string): string;
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
