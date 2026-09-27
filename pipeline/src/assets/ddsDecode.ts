// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ddsDecode.ts — a DDS image as RGBA8, so a model that ships DDS textures
 *        imports with images the rest of the pipeline takes.
 *
 * Covers the block formats DCC exports and older engines write (BC1–BC5, as the
 * legacy FourCCs and as DX10 DXGI codes) and 32-bit uncompressed; level 0 only,
 * since the cook builds its own mip chain. BC5 is a two-channel normal map, so
 * its Z is rebuilt. BC6H/BC7 are refused by name rather than decoded wrong.
 */

export interface DecodedDds { width: number; height: number; rgba: Uint8Array; format: string }

const DDS_MAGIC = 0x20534444;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;

const DXGI: Record<number, string> = {
    71: 'BC1', 72: 'BC1', 74: 'BC2', 75: 'BC2', 77: 'BC3', 78: 'BC3', 80: 'BC4', 83: 'BC5',
    28: 'RGBA8', 29: 'RGBA8', 87: 'BGRA8', 91: 'BGRA8',
    95: 'BC6H', 96: 'BC6H', 98: 'BC7', 99: 'BC7',
};
const FOURCC: Record<string, string> = {
    DXT1: 'BC1', DXT2: 'BC2', DXT3: 'BC2', DXT4: 'BC3', DXT5: 'BC3',
    ATI1: 'BC4', BC4U: 'BC4', ATI2: 'BC5', BC5U: 'BC5',
};

export function isDds(bytes: Uint8Array): boolean {
    return bytes.byteLength >= 128 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === DDS_MAGIC;
}

function rgb565(c: number): [number, number, number] {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** The colour half of a BC1/BC2/BC3 block: four colours indexed per texel. */
function colorBlock(v: DataView, at: number, out: Uint8Array, x0: number, y0: number, w: number, h: number, bc1: boolean): void {
    const c0 = v.getUint16(at, true), c1 = v.getUint16(at + 2, true);
    const a = rgb565(c0), b = rgb565(c1);
    const palette: number[][] = [[...a, 255], [...b, 255]];
    if (!bc1 || c0 > c1) {
        palette.push(a.map((x, i) => Math.round((2 * x + b[i]) / 3)).concat(255));
        palette.push(a.map((x, i) => Math.round((x + 2 * b[i]) / 3)).concat(255));
    } else {
        palette.push(a.map((x, i) => Math.round((x + b[i]) / 2)).concat(255));
        palette.push([0, 0, 0, 0]);
    }
    const bits = v.getUint32(at + 4, true);
    for (let i = 0; i < 16; i++) {
        const x = x0 + (i & 3), y = y0 + (i >> 2);
        if (x >= w || y >= h) continue;
        const p = palette[(bits >>> (2 * i)) & 3];
        out.set(p, (y * w + x) * 4);
    }
}

/** A BC4 channel block (BC3's alpha, BC5's two channels): eight values interpolated from two. */
function channelBlock(v: DataView, at: number): Uint8Array {
    const a0 = v.getUint8(at), a1 = v.getUint8(at + 1);
    const values = [a0, a1];
    if (a0 > a1) for (let i = 1; i < 7; i++) values.push(Math.round(((7 - i) * a0 + i * a1) / 7));
    else {
        for (let i = 1; i < 5; i++) values.push(Math.round(((5 - i) * a0 + i * a1) / 5));
        values.push(0, 255);
    }
    // 48 bits of 3-bit indices, little-endian across six bytes.
    let bits = 0n;
    for (let i = 0; i < 6; i++) bits |= BigInt(v.getUint8(at + 2 + i)) << BigInt(8 * i);
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = values[Number((bits >> BigInt(3 * i)) & 7n)];
    return out;
}

function decodeBlocks(format: string, v: DataView, start: number, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h * 4);
    const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
    const blockBytes = format === 'BC1' || format === 'BC4' ? 8 : 16;
    if (start + bw * bh * blockBytes > v.byteLength) throw new Error(`DDS ${format}: the file ends inside level 0`);
    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            const at = start + (by * bw + bx) * blockBytes;
            const x0 = bx * 4, y0 = by * 4;
            const put = (i: number, c: number, value: number): void => {
                const x = x0 + (i & 3), y = y0 + (i >> 2);
                if (x < w && y < h) out[(y * w + x) * 4 + c] = value;
            };
            if (format === 'BC1') colorBlock(v, at, out, x0, y0, w, h, true);
            else if (format === 'BC2') {
                colorBlock(v, at + 8, out, x0, y0, w, h, false);
                for (let i = 0; i < 16; i++) put(i, 3, ((v.getUint8(at + (i >> 1)) >> ((i & 1) * 4)) & 15) * 17);
            } else if (format === 'BC3') {
                colorBlock(v, at + 8, out, x0, y0, w, h, false);
                const alpha = channelBlock(v, at);
                for (let i = 0; i < 16; i++) put(i, 3, alpha[i]);
            } else if (format === 'BC4') {
                const r = channelBlock(v, at);
                for (let i = 0; i < 16; i++) { put(i, 0, r[i]); put(i, 1, r[i]); put(i, 2, r[i]); put(i, 3, 255); }
            } else {
                // BC5: a tangent-space normal's X and Y; Z is what makes it unit length.
                const r = channelBlock(v, at), g = channelBlock(v, at + 8);
                for (let i = 0; i < 16; i++) {
                    const nx = r[i] / 127.5 - 1, ny = g[i] / 127.5 - 1;
                    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
                    put(i, 0, r[i]); put(i, 1, g[i]); put(i, 2, Math.round((nz + 1) * 127.5)); put(i, 3, 255);
                }
            }
        }
    }
    return out;
}

/** Level 0 of a DDS as RGBA8, rows top to bottom as the file stores them. */
export function decodeDds(bytes: Uint8Array): DecodedDds {
    if (!isDds(bytes)) throw new Error('not a DDS file');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const height = v.getUint32(12, true), width = v.getUint32(16, true);
    const flags = v.getUint32(80, true);
    const fourcc = String.fromCharCode(...bytes.subarray(84, 88));
    let format: string | undefined;
    let start = 128;
    if (flags & DDPF_FOURCC) {
        if (fourcc === 'DX10') {
            format = DXGI[v.getUint32(128, true)];
            start = 148;
            if (!format) throw new Error(`DDS: DXGI format ${v.getUint32(128, true)} is not one this importer reads`);
        } else {
            format = FOURCC[fourcc];
            if (!format) throw new Error(`DDS: FourCC "${fourcc}" is not one this importer reads`);
        }
    } else if (flags & DDPF_RGB && v.getUint32(88, true) === 32) {
        format = v.getUint32(92, true) === 0x00ff0000 ? 'BGRA8' : 'RGBA8';
    } else {
        throw new Error('DDS: only block-compressed and 32-bit RGBA files are read');
    }
    if (format === 'BC6H' || format === 'BC7') {
        throw new Error(`DDS: ${format} is not decoded yet — convert it to PNG or KTX2 first`);
    }
    if (format === 'RGBA8' || format === 'BGRA8') {
        const n = width * height * 4;
        if (start + n > bytes.byteLength) throw new Error(`DDS ${format}: the file ends inside level 0`);
        const rgba = bytes.slice(start, start + n);
        if (format === 'BGRA8') for (let i = 0; i < n; i += 4) { const t = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = t; }
        return { width, height, rgba, format };
    }
    return { width, height, rgba: decodeBlocks(format, v, start, width, height), format };
}
