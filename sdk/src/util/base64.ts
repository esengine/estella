// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LOOKUP = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
    table[43] = 62; table[45] = 62;
    table[47] = 63; table[95] = 63;
    return table;
})();

/** Decode either Base64 alphabet on every runtime. Legacy callers tolerate nonalphabet characters. */
export function decodeBase64Bytes(text: string): Uint8Array {
    const out = new Uint8Array(Math.floor(text.length * 3 / 4));
    let bits = 0, accumulator = 0, offset = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const digit = code < 128 ? LOOKUP[code] : -1;
        if (digit < 0) continue;
        accumulator = (accumulator << 6) | digit;
        bits += 6;
        if (bits >= 8) { bits -= 8; out[offset++] = (accumulator >> bits) & 0xff; }
    }
    return out.subarray(0, offset);
}
