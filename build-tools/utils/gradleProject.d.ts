// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for gradleProject.js — the module is plain ESM so the CLI can run it
// unbuilt, and this is how the editor's TypeScript sees it. The Android side of
// iosProject.d.ts, down to the shape.

/**
 * The prebuilt pieces a project is wrapped around, named directory by directory:
 * they come from a runtime template, whose layout table is the only thing that
 * knows where they sit inside it (see nativeTemplate.js).
 */
export interface AndroidProjectSources {
    /** The engine's shared libraries, one directory per ABI. */
    libs: string;
    /** The host's Java shim, as source — what the project compiles. */
    java: string;
    /** The manifest template the app's identity is substituted into. */
    manifestIn: string;
    /** The template's default launcher icon, used when the project sets none. */
    icon: string;
    /** Precompiled SDK bytecode, if the template carries it. */
    bytecode?: string;
}

export interface AndroidAppIdentity {
    id: string;
    name: string;
    version: string;
    versionCode: number;
    orientation: 'landscape' | 'portrait';
}

/** The manifest a Gradle build wants, plus the SDK levels it took out of it. */
export function gradleManifest(
    templateXml: string,
    app: AndroidAppIdentity,
): { xml: string; minSdk: number; targetSdk: number };

export function renderSettingsGradle(name: string): string;
export function renderRootGradle(): string;
export function renderAppGradle(o: {
    appId: string;
    version: string;
    versionCode: number;
    minSdk: number;
    targetSdk: number;
    abis: string[];
}): string;
export function renderGradleProperties(): string;
export function renderProjectReadme(o: { name: string; abis: string[] }): string;
export function renderGitignore(): string;

export function emitAndroidGradleProject(
    contentDir: string,
    app: AndroidAppIdentity,
    sources: AndroidProjectSources,
    icon?: Buffer,
): Promise<string>;
