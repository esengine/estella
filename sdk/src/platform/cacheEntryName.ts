// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  cacheEntryName.ts — the file a content cache key is stored under.
 */
import { contentHashHex } from '../asset/contentHash';
import { encodeUtf8 } from '../util/utf8';

/**
 * The key's XXH64, as 16 hex digits. A key is a content-addressed url, which no
 * filesystem name holds as-is, and the native host refuses any name outside
 * `[A-Za-z0-9._-]` — so every platform with a disk cache stores under this.
 */
export function cacheEntryName(key: string): string {
    return contentHashHex(encodeUtf8(key));
}
