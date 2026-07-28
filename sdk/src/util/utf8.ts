// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    utf8.ts
 * @brief   UTF-8 conversion that does not assume a browser.
 *
 * @details `TextEncoder` is a web platform API, not a JavaScript one. The engine
 *          runs on a device inside QuickJS, which does not have it — so SDK code
 *          that reaches for the global works everywhere it was tested and throws
 *          on the one target nobody can test in a unit test. That is how a
 *          skeleton loader shipped in an APK that failed at boot.
 *
 *          So: use the platform's encoder when it exists, because it is faster and
 *          correct, and fall back to doing the arithmetic. The fallback is not a
 *          nicety — on a native host it is the only path.
 */

const nativeEncoder: TextEncoder | null =
    typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const nativeDecoder: TextDecoder | null =
    typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

/** `str` as UTF-8 bytes. */
export function encodeUtf8(str: string): Uint8Array {
    if (nativeEncoder) return nativeEncoder.encode(str);

    // Two passes: measure, then fill. One allocation of the right size beats
    // growing a buffer for what is usually a whole asset file.
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.codePointAt(i)!;
        if (c > 0xffff) i++; // a surrogate pair is one code point, two units
        bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }

    const out = new Uint8Array(bytes);
    let at = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.codePointAt(i)!;
        if (c > 0xffff) i++;
        if (c < 0x80) {
            out[at++] = c;
        } else if (c < 0x800) {
            out[at++] = 0xc0 | (c >> 6);
            out[at++] = 0x80 | (c & 0x3f);
        } else if (c < 0x10000) {
            out[at++] = 0xe0 | (c >> 12);
            out[at++] = 0x80 | ((c >> 6) & 0x3f);
            out[at++] = 0x80 | (c & 0x3f);
        } else {
            out[at++] = 0xf0 | (c >> 18);
            out[at++] = 0x80 | ((c >> 12) & 0x3f);
            out[at++] = 0x80 | ((c >> 6) & 0x3f);
            out[at++] = 0x80 | (c & 0x3f);
        }
    }
    return out;
}

/** UTF-8 `bytes` as a string. Malformed input yields U+FFFD, as the platform's
 *  decoder does in its non-fatal mode. */
export function decodeUtf8(bytes: Uint8Array): string {
    if (nativeDecoder) return nativeDecoder.decode(bytes);

    // Built in chunks: one big String.fromCharCode(...spread) blows the argument
    // limit on an asset-sized buffer.
    const parts: string[] = [];
    let units: number[] = [];
    for (let i = 0; i < bytes.length;) {
        const b = bytes[i];
        let code: number;
        let len: number;
        if (b < 0x80) { code = b; len = 1; }
        else if ((b & 0xe0) === 0xc0) { code = b & 0x1f; len = 2; }
        else if ((b & 0xf0) === 0xe0) { code = b & 0x0f; len = 3; }
        else if ((b & 0xf8) === 0xf0) { code = b & 0x07; len = 4; }
        else { code = 0xfffd; len = 1; }

        if (len > 1) {
            if (i + len > bytes.length) { code = 0xfffd; len = 1; }
            else {
                for (let k = 1; k < len; k++) {
                    const cont = bytes[i + k];
                    if ((cont & 0xc0) !== 0x80) { code = 0xfffd; len = 1; break; }
                    code = (code << 6) | (cont & 0x3f);
                }
            }
        }
        i += len;

        if (code > 0xffff) {
            const v = code - 0x10000;
            units.push(0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff));
        } else {
            units.push(code);
        }
        if (units.length >= 4096) {
            parts.push(String.fromCharCode(...units));
            units = [];
        }
    }
    if (units.length) parts.push(String.fromCharCode(...units));
    return parts.join('');
}
