// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Valve's KeyValues text format, written.
 *
 * SteamPipe's build scripts are KeyValues, and the only reader that matters is
 * steamcmd's — so what this has to get right is quoting and nesting, and nothing
 * else. Written rather than depended on for the reason every other format here is:
 * a package must be producible without installing anything.
 */

/**
 * Escape a value for a quoted KeyValues token.
 *
 * Backslashes matter and are the reason this exists: a Windows content root
 * pasted in raw turns `C:\build` into a `\b`, and steamcmd then looks for a
 * directory nobody named.
 */
function token(text) {
    return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Serialize @p value as KeyValues under @p rootKey.
 *
 * Objects nest; everything else is a leaf. Key ORDER is the object's own, which
 * matters only for how a human reads the result — steamcmd does not care, and a
 * diff does.
 *
 * @param {string} rootKey
 * @param {Record<string, unknown>} value
 * @returns {string} the document, newline-terminated.
 */
export function writeVdf(rootKey, value) {
    const lines = [];
    const emit = (key, node, depth) => {
        const pad = '\t'.repeat(depth);
        if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
            lines.push(`${pad}${token(key)}`, `${pad}{`);
            for (const [k, v] of Object.entries(node)) emit(k, v, depth + 1);
            lines.push(`${pad}}`);
            return;
        }
        lines.push(`${pad}${token(key)}\t\t${token(node)}`);
    };
    emit(rootKey, value, 0);
    return `${lines.join('\n')}\n`;
}
