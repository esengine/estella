// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** One ordered pair of names. Escaping the first part leaves the second free to contain any path or URI. */
export function assetPairKey(first: string, second: string): string {
    return `${first.replace(/[%:]/g, c => c === ':' ? '%3A' : '%25')}:${second}`;
}
