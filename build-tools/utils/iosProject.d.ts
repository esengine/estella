// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for iosProject.js — the module is plain ESM so the CLI can run it unbuilt,
// and this is how the editor's TypeScript sees it.

/**
 * The prebuilt pieces a project is wrapped around, named file by file: they come
 * from a runtime template, whose layout table is the only thing that knows where
 * they sit inside it (see nativeTemplate.js).
 */
export interface IosProjectSources {
    /** The engine, built for device + simulator. */
    xcframework: string;
    /** The app shell's entry point — it calls `EstellaRunApp()`. */
    mainM: string;
    /** The Info.plist template the app's identity is substituted into. */
    infoPlistIn: string;
    /** The template's default launcher icon, used when the project sets none. */
    icon: string;
    /** Precompiled SDK bytecode, if the template carries it. */
    bytecode?: string;
}

export interface IosAppIdentity {
    id: string;
    name: string;
    version: string;
    versionCode: number;
    orientation: 'landscape' | 'portrait';
}

export function emitIosXcodeProject(
    contentDir: string,
    app: IosAppIdentity,
    sources: IosProjectSources,
    deploymentTarget?: string,
    icon?: Buffer,
): Promise<string>;
