// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for apk.js — the module is plain ESM so the CLI can run it unbuilt, and
// this is how the editor's TypeScript sees it.

import type { SigningKey } from './androidKeystore';

export interface ApkAppIdentity {
    id: string;
    name: string;
    version: string;
    versionCode: number;
    orientation: 'landscape' | 'portrait';
}

export function assembleApk(options: {
    /** An installed android runtime template. */
    templateDir: string;
    /** The export: cooked content plus the two configs. */
    contentDir: string;
    app: ApkAppIdentity;
    key: SigningKey;
    abi: string;
}): Buffer;

export function signApkV2(zip: Buffer, key: SigningKey): Buffer;
export function packageEntries(dir: string, prefix: string): Array<{ name: string; data: Buffer }>;
export function apkFileName(appId: string): string;
