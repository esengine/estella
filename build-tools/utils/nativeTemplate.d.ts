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
    abi: string;
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
    abi?: string;
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
export const DEFAULT_ABI: Readonly<Record<NativePlatform, string>>;

export function templateId(platform: NativePlatform, abi: string): string;
export function requiredTemplateFiles(platform: NativePlatform, options?: { abi?: string }): string[];
export function missingTemplateFiles(dir: string, platform: NativePlatform, options?: { abi?: string }): string[];
export function readTemplateManifest(dir: string): NativeTemplateManifest | null;
export function templateMatches(manifest: NativeTemplateManifest | null, want: TemplateWant): boolean;
export function templateZipName(platform: NativePlatform, abi: string, engineVersion: string): string;
export function estellaDataDir(): string;
export function templateStoreDir(): string;
export function installedTemplateDir(
    engineVersion: string, platform: NativePlatform, abi: string, storeDir?: string): string;
export function findTemplate(want: TemplateWant, storeDir?: string): FoundTemplate | null;
export function iosTemplateSources(dir: string): {
    xcframework: string;
    mainM: string;
    infoPlistIn: string;
};
