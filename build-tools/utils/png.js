// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Read a PNG, for the one question a screenshot has to answer.
//
// A frame captured off a simulator is judged by whether anything was drawn into
// it, which needs pixels — and the encoders this repo already writes rather than
// depends on (solidPng.mjs, zip.js) set the precedent for the other direction.
// The alternative is reaching into desktop/node_modules for pngjs from a tool
// that has no other reason to know the editor exists.
//
// Scope is what a screen capture produces: 8 bits per channel, non-interlaced.
// Anything else throws by name rather than decoding to garbage.

import { inflateSync } from 'zlib';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decode a PNG to interleaved 8-bit samples.
 *
 * @param {Buffer} buf
 * @returns {{width: number, height: number, channels: number, data: Buffer}}
 */
export function decodePng(buf) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

    let width = 0; let height = 0; let depth = 0; let colorType = 0; let interlace = 0;
    const idat = [];
    for (let at = 8; at + 8 <= buf.length;) {
        const len = buf.readUInt32BE(at);
        const type = buf.toString('ascii', at + 4, at + 8);
        const body = buf.subarray(at + 8, at + 8 + len);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            depth = body[8];
            colorType = body[9];
            interlace = body[12];
        } else if (type === 'IDAT') {
            idat.push(body);
        } else if (type === 'IEND') {
            break;
        }
        at += 12 + len;
    }

    if (depth !== 8) throw new Error(`PNG bit depth ${depth} — this decoder reads 8`);
    if (interlace !== 0) throw new Error('interlaced PNG — this decoder reads non-interlaced');
    const channels = CHANNELS[colorType];
    if (!channels || colorType === 3) throw new Error(`PNG color type ${colorType} is not supported`);
    if (!width || !height || idat.length === 0) throw new Error('PNG carries no image data');

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const out = Buffer.alloc(stride * height);

    // Undo the per-scanline filter. `prev` is the already-reconstructed line
    // above, which is what makes this sequential rather than parallel.
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const line = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? line[x - channels] : 0;
            const b = prev ? prev[x] : 0;
            const c = prev && x >= channels ? prev[x - channels] : 0;
            let value = src[x];
            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
                value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            } else if (filter !== 0) {
                throw new Error(`unknown PNG scanline filter ${filter}`);
            }
            line[x] = value & 0xff;
        }
    }

    return { width, height, channels, data: out };
}

/**
 * How many distinct colors a frame holds, counted up to @p cap.
 *
 * The question a captured frame is asked is "was anything drawn", and a clear
 * that never got a scene is one flat color — which is the failure a launch that
 * merely did not crash still hides.
 */
export function distinctColors(image, cap = 4096) {
    const { data, channels } = image;
    const seen = new Set();
    for (let i = 0; i + channels <= data.length; i += channels) {
        const r = data[i];
        const g = channels >= 3 ? data[i + 1] : r;
        const b = channels >= 3 ? data[i + 2] : r;
        seen.add((r << 16) | (g << 8) | b);
        if (seen.size >= cap) break;
    }
    return seen.size;
}
