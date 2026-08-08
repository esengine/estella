// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A real PNG, for the tests that feed one to something that reads it.
 *
 * One generator rather than one per test file: the icns writer reads only IHDR
 * and the PE icon writer decodes the pixels, so a stub that satisfied the first
 * silently failed the second the day it arrived.
 */
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
    let c = ~0;
    for (const byte of buf) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c;
}

function chunk(type: string, body: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
}

/** A square 8-bit RGBA PNG of one colour. */
export function solidPng(size: number, rgba: [number, number, number, number] = [0, 0, 0, 255]): Buffer {
    const stride = size * 4 + 1;   // one filter byte per row
    const raw = Buffer.alloc(stride * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const at = y * stride + 1 + x * 4;
            raw[at] = rgba[0];
            raw[at + 1] = rgba[1];
            raw[at + 2] = rgba[2];
            raw[at + 3] = rgba[3];
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;    // bit depth
    ihdr[9] = 6;    // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
