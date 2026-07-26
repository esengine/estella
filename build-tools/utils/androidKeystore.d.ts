// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for androidKeystore.js — the module is plain ESM so the CLI can run it
// unbuilt, and this is how the editor's TypeScript sees it.

import type { KeyObject } from 'node:crypto';

/** What an APK is signed with: the key, and the certificate that goes inside. */
export interface SigningKey {
    privateKey: KeyObject;
    /** DER-encoded X.509. */
    certificate: Buffer;
    /** Who it says signed — for the line the packager prints. */
    name: string;
}

export function debugKeyDir(): string;
export function debugSigningKey(): SigningKey;
export function signingKeyFromPem(files: { key: string; cert: string; passphrase?: string }): SigningKey;
