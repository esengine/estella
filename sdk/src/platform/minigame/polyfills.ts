// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    polyfills.ts
 * @brief   Vendor-neutral global polyfills for mini-game runtimes (performance,
 *          TextEncoder/TextDecoder). Fetch and WebAssembly polyfills live with
 *          their implementations (fetch.ts / the vendor's wasm module) because
 *          they depend on the host global / vendor WASM entry point.
 */

export function polyfillPerformance(): void {
    const g = globalThis as unknown as { performance?: { now(): number } };
    if (typeof g.performance !== 'undefined') return;
    const start = Date.now();
    g.performance = { now: (): number => Date.now() - start };
}

export function polyfillTextEncoder(): void {
    const g = globalThis as unknown as { TextEncoder?: unknown; TextDecoder?: unknown };
    if (typeof g.TextEncoder === 'undefined') {
        g.TextEncoder = class {
            encode(str: string): Uint8Array {
                const buf = new ArrayBuffer(str.length * 3);
                const bytes = new Uint8Array(buf);
                let pos = 0;
                for (let i = 0; i < str.length; i++) {
                    let code = str.charCodeAt(i);
                    if (code < 0x80) {
                        bytes[pos++] = code;
                    } else if (code < 0x800) {
                        bytes[pos++] = 0xc0 | (code >> 6);
                        bytes[pos++] = 0x80 | (code & 0x3f);
                    } else if (code >= 0xd800 && code <= 0xdbff) {
                        const next = str.charCodeAt(++i);
                        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
                        bytes[pos++] = 0xf0 | (code >> 18);
                        bytes[pos++] = 0x80 | ((code >> 12) & 0x3f);
                        bytes[pos++] = 0x80 | ((code >> 6) & 0x3f);
                        bytes[pos++] = 0x80 | (code & 0x3f);
                    } else {
                        bytes[pos++] = 0xe0 | (code >> 12);
                        bytes[pos++] = 0x80 | ((code >> 6) & 0x3f);
                        bytes[pos++] = 0x80 | (code & 0x3f);
                    }
                }
                return bytes.subarray(0, pos);
            }
        };
    }
    if (typeof g.TextDecoder === 'undefined') {
        g.TextDecoder = class {
            decode(buf: ArrayBuffer | Uint8Array): string {
                const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
                let str = '';
                for (let i = 0; i < bytes.length;) {
                    const b = bytes[i];
                    if (b < 0x80) {
                        str += String.fromCharCode(b);
                        i++;
                    } else if ((b & 0xe0) === 0xc0) {
                        str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
                        i += 2;
                    } else if ((b & 0xf0) === 0xe0) {
                        str += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
                        i += 3;
                    } else {
                        const code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
                        const offset = code - 0x10000;
                        str += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
                        i += 4;
                    }
                }
                return str;
            }
        };
    }
}
