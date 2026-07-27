// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for aab.js — the module is plain ESM so the CLI can run it unbuilt, and
// this is how the editor's TypeScript sees it.

import type { SigningKey } from './androidKeystore';
import type { ApkAppIdentity } from './apk';

export function assembleAab(options: {
    /** An installed android runtime template. */
    templateDir: string;
    /** The export: cooked content plus the two configs. */
    contentDir: string;
    app: ApkAppIdentity;
    key: SigningKey;
}): Buffer;

export function aabFileName(appId: string): string;
