// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  types.ts — the message-entry shape shared by every per-area catalog
 *        module. Both languages live on ONE entry, so a key can never exist in
 *        one locale and not the other; `defineMessages` (an identity function)
 *        checks the shape while keeping literal key inference for the typed
 *        t(key) union. Adding a locale later = widen Message; tsc then flags
 *        every entry missing it.
 */

/** One user-facing string in every supported editor language. */
export interface Message {
    en: string;
    zh: string;
}

export type MessageMap = Record<string, Message>;

/** Identity with shape-checking; preserves literal keys for the MsgKey union. */
export function defineMessages<T extends MessageMap>(messages: T): T {
    return messages;
}
