// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pngData.ts
 * @brief   A PNG read as data: its bytes exactly as stored, for an image that is numbers (a heightmap, a splatmap).
 *
 * The image path decodes through a 2D canvas, which keeps colour premultiplied by alpha: a texel whose alpha is 0 comes back
 * with red, green and blue at 0 too. For a picture that is right; for a splatmap whose alpha is the fourth layer's weight it
 * erased the other three wherever that layer was absent. This inflates the stream and undoes the row filters directly.
 */
import type { DecodedPixels } from './imageDecode';
import { inflateZlib } from '../util/inflate';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** A PNG read as data: its RGBA bytes, and for one of 16 bits a channel its first channel at full depth too. */
export interface PngData extends DecodedPixels {
    /** The first channel (grey, or red) of each pixel as the file holds it, 0 to 65535: present only for a PNG of 16 bits a channel. */
    wide?: Uint16Array;
}

/** Whether `bytes` is a PNG this reader takes: 8 or 16 bits a channel, grey, grey+alpha, RGB or RGBA, not interlaced. */
function header(bytes: Uint8Array): { width: number; height: number; channels: number; depth: number } | null {
    if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    const depth = bytes[24], type = bytes[25], interlace = bytes[28];
    const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type!];
    if ((depth !== 8 && depth !== 16) || !channels || interlace !== 0 || !width || !height) return null;
    return { width, height, channels, depth };
}

async function inflate(data: Uint8Array<ArrayBuffer>, size: number): Promise<Uint8Array> {
    if (typeof DecompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') {
        return inflateZlib(data, size);
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * The RGBA bytes of a PNG, top row first, as stored; null when it uses an unsupported PNG format.
 */
export async function decodePngData(bytes: Uint8Array): Promise<PngData | null> {
    const head = header(bytes);
    if (!head) return null;
    const { width, height, channels, depth } = head;
    // The row filters work on bytes, a pixel's width apart: two bytes a channel at 16 bits.
    const size = depth / 8, step = channels * size;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts: Uint8Array[] = [];
    for (let at = 8; at + 8 <= bytes.length;) {
        const length = view.getUint32(at);
        if (at + 12 + length > bytes.length) return null;
        const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
        if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length));
        if (type === 'IEND') break;
        at += 12 + length;
    }
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (joined.set(p, at), at + p.length), 0);
    const stride = width * step;
    const rawSize = (stride + 1) * height;
    const raw = await inflate(joined, rawSize);
    if (raw.length !== rawSize) return null;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]!;
        const src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= step ? rows[dst + x - step]! : 0;
            const b = y > 0 ? rows[up + x]! : 0;
            const c = x >= step && y > 0 ? rows[up + x - step]! : 0;
            const v = raw[src + x]!;
            rows[dst + x] = (filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1)
                : filter === 4 ? v + paeth(a, b, c) : v) & 255;
        }
    }
    if (channels === 4 && size === 1) return { width, height, pixels: rows };
    // At 16 bits a channel the bytes are big-endian: the RGBA bytes keep each channel's high byte.
    const at = (i: number, ch: number): number => rows[i * step + ch * size]!;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const d = i * 4;
        const grey = channels <= 2;
        pixels[d] = at(i, 0);
        pixels[d + 1] = grey ? at(i, 0) : at(i, 1);
        pixels[d + 2] = grey ? at(i, 0) : at(i, 2);
        pixels[d + 3] = channels === 2 ? at(i, 1) : channels === 4 ? at(i, 3) : 255;
    }
    if (size === 1) return { width, height, pixels };
    const wide = new Uint16Array(width * height);
    for (let i = 0; i < width * height; i++) wide[i] = (rows[i * step]! << 8) | rows[i * step + 1]!;
    return { width, height, pixels, wide };
}
