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

export function assembleMacApp(options: {
    /** An installed macos runtime template. */
    templateDir: string;
    /** The export: cooked content plus the two configs. */
    contentDir: string;
    /** Where `<name>.app` is written. */
    outDir: string;
    app: DesktopAppIdentity;
    /** Square PNG; the template's mark is used when absent. */
    iconPng?: string;
    macosMin?: string;
    /** codesign identity; ad-hoc when absent. */
    signIdentity?: string;
    /** Told when the bundle could not be signed (assembling off macOS). */
    warn?: (message: string) => void;
}): Promise<string>;
