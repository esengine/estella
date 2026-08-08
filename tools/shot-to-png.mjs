#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
/**
 * @file  shot-to-png.mjs — a native host capture (ESTELLA_SHOT, see
 *        native/host/Shot.hpp), as a PNG.
 *
 *     node tools/shot-to-png.mjs <shot.rgba> <width> <height> [--rgba] [-o out.png]
 *
 * Input is bottom-up (GfxDevice::takeReadback) and BGRA unless --rgba says so;
 * the host logs which it wrote. The encoder is here rather than in the host
 * because the verdict the host logs is what decides anything — a shipped binary
 * should not carry an image format for a human's occasional look.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('-'));
const [input, widthArg, heightArg] = positional;
if (!input || !widthArg || !heightArg) {
    console.error('usage: shot-to-png.mjs <shot.rgba> <width> <height> [--rgba] [-o out.png]');
    process.exit(2);
}
const width = Number(widthArg);
const height = Number(heightArg);
const isRgba = args.includes('--rgba');
const outIndex = args.indexOf('-o');
const output = outIndex >= 0 ? args[outIndex + 1] : input.replace(/\.[^.]*$/, '') + '.png';

const raw = readFileSync(input);
const expected = width * height * 4;
if (raw.length !== expected) {
    console.error(`${input} is ${raw.length} bytes; ${width}x${height} RGBA is ${expected}.`);
    process.exit(1);
}

// PNG wants top-down rows, each prefixed with a filter byte (0 = None).
const stride = width * 4;
const scanlines = Buffer.alloc((stride + 1) * height);
for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * stride;
    const dst = y * (stride + 1);
    scanlines[dst] = 0;
    raw.copy(scanlines, dst + 1, src, src + stride);
    if (!isRgba) {
        for (let x = dst + 1; x < dst + 1 + stride; x += 4) {
            const b = scanlines[x];
            scanlines[x] = scanlines[x + 2];
            scanlines[x + 2] = b;
        }
    }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 6;    // colour type: RGBA
// 10/11/12 stay 0: deflate, adaptive filtering, no interlace.

writeFileSync(output, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${output} (${width}x${height}, from ${isRgba ? 'RGBA' : 'BGRA'} bottom-up)`);
