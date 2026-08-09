// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for desktopApp.js, which is plain ESM so the CLI runs it unbuilt.

export interface DesktopAppIdentity {
    id: string;
    name: string;
    version: string;
    versionCode: number;
}

export function assembleDesktopApp(options: {
    /** Which desktop OS the app is for; also which template layout is read. */
    platform: 'macos' | 'windows' | 'linux';
    /** An installed runtime template for that OS. */
    templateDir: string;
    /** The export: cooked content plus the two configs. */
    contentDir: string;
    /** Where the app directory is written. */
    outDir: string;
    app: DesktopAppIdentity;
    /** Square PNG; the template's mark is used when absent. */
    iconPng?: string;
    macosMin?: string;
    /** codesign identity; ad-hoc when absent. */
    signIdentity?: string;
    /** A Steamworks SDK on this machine; its redistributable ships in the app.
     *  Beats one the template was built with — an explicit setting wins. */
    steamSdkDir?: string;
    /** Told when the bundle could not be signed (assembling off macOS), or when a
     *  named SDK held no redistributable. */
    warn?: (message: string) => void;
}): Promise<{
    /** The app directory. */
    dir: string;
    /** The store library shipped inside it, or null — without one the game runs
     *  and every achievement silently reaches nobody. */
    steamLibrary: string | null;
}>;
