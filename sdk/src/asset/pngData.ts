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

/** Undo one filter into a packed RGBA row or in place in the inflated scanlines. */
function restoreRow(raw: Uint8Array, src: number, out: Uint8Array, dst: number, up: number, stride: number, step: number): void {
    const filter = raw[src - 1];
    if (filter === 1) {
        if (raw !== out) out.set(raw.subarray(src, src + step), dst);
        for (let x = step; x < stride; x++) out[dst + x] = raw[src + x]! + out[dst + x - step]!;
    } else if (filter === 2 && up >= 0) {
        for (let x = 0; x < stride; x++) out[dst + x] = raw[src + x]! + out[up + x]!;
    } else if (filter === 3) {
        for (let x = 0; x < stride; x++) {
            const left = x >= step ? out[dst + x - step]! : 0;
            const above = up >= 0 ? out[up + x]! : 0;
            out[dst + x] = raw[src + x]! + ((left + above) >> 1);
        }
    } else if (filter === 4) {
        for (let x = 0; x < stride; x++) {
            const left = x >= step ? out[dst + x - step]! : 0;
            const above = up >= 0 ? out[up + x]! : 0;
            const corner = up >= 0 && x >= step ? out[up + x - step]! : 0;
            out[dst + x] = raw[src + x]! + paeth(left, above, corner);
        }
    } else if (raw !== out) {
        out.set(raw.subarray(src, src + stride), dst);
    }
}

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
    const direct = channels === 4 && size === 1;
    const pixels = new Uint8Array(width * height * 4);
    const wide = size === 2 ? new Uint16Array(width * height) : undefined;
    const rows = direct ? pixels : raw;
    const rowSize = direct ? stride : stride + 1;
    const green = channels > 2 ? size : 0, blue = green * 2;
    const alpha = channels === 2 || channels === 4 ? (channels - 1) * size : -1;
    for (let y = 0; y < height; y++) {
        const src = y * (stride + 1) + 1, dst = direct ? y * stride : src;
        restoreRow(raw, src, rows, dst, y > 0 ? dst - rowSize : -1, stride, step);
        if (direct) continue;
        // At 16 bits a channel the bytes are big-endian: RGBA keeps each high byte.
        const first = y * width;
        for (let x = 0; x < width; x++) {
            const at = src + x * step, i = first + x, d = i * 4;
            const high = raw[at]!;
            pixels[d] = high;
            pixels[d + 1] = raw[at + green]!;
            pixels[d + 2] = raw[at + blue]!;
            pixels[d + 3] = alpha < 0 ? 255 : raw[at + alpha]!;
            if (wide) wide[i] = (high << 8) | raw[at + 1]!;
        }
    }
    return wide ? { width, height, pixels, wide } : { width, height, pixels };
}
