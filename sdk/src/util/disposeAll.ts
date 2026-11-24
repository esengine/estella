// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Dispose a detached batch completely; report its first failure unchanged. */
export function disposeAll<T>(items: readonly T[], dispose: (item: T) => void, reverse = false): void {
    let failed = false, reason: unknown;
    for (let n = 0; n < items.length; n++) {
        try { dispose(items[reverse ? items.length - 1 - n : n]!); }
        catch (error) {
            if (!failed) {
                failed = true;
                reason = error;
            }
        }
    }
    if (failed) throw reason;
}
