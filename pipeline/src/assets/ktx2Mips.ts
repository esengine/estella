// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ktx2Mips.ts — a mip chain under an authored single-level UASTC KTX2,
 *        with its level 0 kept bit for bit.
 *
 * A KTX2 made elsewhere often carries one level, and a compressed level cannot
 * have a chain generated on the device. The cook encodes the levels below it
 * from a half-size image and splices them under the file's own level 0: every
 * level is stored (and supercompressed) on its own, so the base is never
 * decoded and re-encoded.
 */

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 80;
const LEVEL_ENTRY_BYTES = 24;
const KHR_DF_MODEL_UASTC = 166;
const KHR_DF_TRANSFER_SRGB = 2;
const SCHEME_NONE = 0;
/** UASTC is 4x4 blocks of 16 bytes: the plain layout aligns levels to them. */
const UASTC_BLOCK_BYTES = 16;

export interface Ktx2Level { offset: number; length: number; uncompressed: number }

export interface Ktx2Layout {
    width: number;
    height: number;
    scheme: number;
    /** The data format descriptor's colour model; UASTC is 166. */
    colorModel: number;
    srgb: boolean;
    dfd: { offset: number; length: number };
    kvd: { offset: number; length: number };
    sgdLength: number;
    levels: Ktx2Level[];
}

/** The layout of a KTX2, or null when the bytes are not one. */
export function readKtx2Layout(bytes: Uint8Array): Ktx2Layout | null {
    if (bytes.byteLength < HEADER_BYTES || IDENTIFIER.some((b, i) => bytes[i] !== b)) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const levelCount = Math.max(1, v.getUint32(40, true));
    if (HEADER_BYTES + levelCount * LEVEL_ENTRY_BYTES > bytes.byteLength) return null;
    const dfd = { offset: v.getUint32(48, true), length: v.getUint32(52, true) };
    const levels: Ktx2Level[] = [];
    for (let i = 0; i < levelCount; i++) {
        const at = HEADER_BYTES + i * LEVEL_ENTRY_BYTES;
        levels.push({
            offset: Number(v.getBigUint64(at, true)),
            length: Number(v.getBigUint64(at + 8, true)),
            uncompressed: Number(v.getBigUint64(at + 16, true)),
        });
    }
    // The basic descriptor block starts after the 4-byte total size: colour model
    // at +8 of the block, transfer function at +10.
    const hasDfd = dfd.length >= 16 && dfd.offset + 16 <= bytes.byteLength;
    return {
        width: v.getUint32(20, true),
        height: v.getUint32(24, true),
        scheme: v.getUint32(44, true),
        colorModel: hasDfd ? bytes[dfd.offset + 12] : -1,
        srgb: hasDfd && bytes[dfd.offset + 14] === KHR_DF_TRANSFER_SRGB,
        dfd,
        kvd: { offset: v.getUint32(56, true), length: v.getUint32(60, true) },
        sgdLength: Number(v.getBigUint64(72, true)),
        levels,
    };
}

/** Whether the cook can give this file a chain: one UASTC level, bigger than 1x1. */
export function wantsMipChain(layout: Ktx2Layout | null): layout is Ktx2Layout {
    return layout !== null && layout.levels.length === 1 && layout.colorModel === KHR_DF_MODEL_UASTC
        && layout.sgdLength === 0 && Math.max(layout.width, layout.height) > 1;
}

const toLinear = new Float32Array(256).map((_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function toSrgbByte(linear: number): number {
    const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** The share of texels whose alpha reaches @p cutoff (0..1 against 0..255 bytes). */
export function alphaCoverage(rgba: Uint8Array, cutoff: number, scale = 1): number {
    const threshold = cutoff * 255;
    let above = 0;
    for (let i = 3; i < rgba.length; i += 4) if (Math.min(255, rgba[i]! * scale) >= threshold) above++;
    return above / (rgba.length / 4);
}

/**
 * Scale @p rgba's alpha in place so the share of texels at or above @p cutoff is
 * @p coverage. Averaging moves the share either way — a sparse cutout (a railing) thins away, a dense fine one (hair) closes into a
 * sheet — so the scale goes either way too: the smallest that reaches the share, by bisection. A level already at the share is left
 * alone; for a fully opaque image the smallest scale reaching 100% is the cutoff itself, which would pull every alpha down onto it.
 */
export function preserveAlphaCoverage(rgba: Uint8Array, cutoff: number, coverage: number): void {
    const now = alphaCoverage(rgba, cutoff);
    if (now === coverage) return;
    let lo = now < coverage ? 1 : 0, hi = now < coverage ? 4 : 1;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (alphaCoverage(rgba, cutoff, mid) < coverage) lo = mid; else hi = mid;
    }
    const scale = hi;
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.min(255, Math.round(rgba[i]! * scale));
}

/**
 * The next level down: each pixel the mean of the (up to) four above it. Colour
 * stored as sRGB is averaged as light, not as its encoding, or every level comes
 * out darker than the one it was made from; alpha is averaged as it is.
 */
export function halveRgba(rgba: Uint8Array, width: number, height: number, srgb: boolean): {
    rgba: Uint8Array; width: number; height: number;
} {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const r0 = Math.min(height - 1, y * 2) * width, r1 = Math.min(height - 1, y * 2 + 1) * width;
        for (let x = 0; x < w; x++) {
            const x0 = Math.min(width - 1, x * 2), x1 = Math.min(width - 1, x * 2 + 1);
            const a = (r0 + x0) * 4, b = (r0 + x1) * 4, c = (r1 + x0) * 4, d = (r1 + x1) * 4;
            const o = (y * w + x) * 4;
            for (let k = 0; k < 3; k++) {
                out[o + k] = srgb
                    ? toSrgbByte((toLinear[rgba[a + k]!]! + toLinear[rgba[b + k]!]! + toLinear[rgba[c + k]!]! + toLinear[rgba[d + k]!]!) / 4)
                    : Math.round((rgba[a + k]! + rgba[b + k]! + rgba[c + k]! + rgba[d + k]!) / 4);
            }
            out[o + 3] = Math.round((rgba[a + 3]! + rgba[b + 3]! + rgba[c + 3]! + rgba[d + 3]!) / 4);
        }
    }
    return { rgba: out, width: w, height: h };
}

/**
 * `base`'s level 0 over every level of `below` (encoded from the half-size
 * image, so its level 0 is the base's level 1), as one KTX2 with `base`'s
 * header and descriptors. Throws when the two cannot be one file.
 */
export function spliceMipChain(base: Uint8Array, below: Uint8Array): Uint8Array {
    const top = readKtx2Layout(base);
    if (!top) throw new Error('spliceMipChain: not a KTX2');
    if (top.levels.length !== 1) throw new Error(`spliceMipChain: base has ${top.levels.length} levels, not 1`);
    return joinMipLevels([base, below]);
}

export function stackStrips(strips: Uint8Array[]): Uint8Array {
    const layouts = strips.map((p) => readKtx2Layout(p));
    if (strips.length === 0 || layouts.some((l) => !l)) throw new Error('stackStrips: not a KTX2');
    const top = layouts[0]!;
    const base = strips[0]!;
    let height = 0, length = 0, uncompressed = 0;
    layouts.forEach((layout, i) => {
        const l = layout!;
        if (l.colorModel !== KHR_DF_MODEL_UASTC) throw new Error('stackStrips: every strip must be UASTC');
        if (l.levels.length !== 1) throw new Error(`stackStrips: a strip has ${l.levels.length} levels, not 1`);
        if (l.scheme !== top.scheme || l.srgb !== top.srgb) throw new Error('stackStrips: the strips were not encoded alike');
        if (l.sgdLength) throw new Error('stackStrips: global data cannot be stacked');
        if (l.width !== top.width) throw new Error(`stackStrips: a strip is ${l.width} wide under one of ${top.width}`);
        if (i < strips.length - 1 && l.height % 4 !== 0) throw new Error(`stackStrips: a strip of ${l.height} rows above another does not end on a block`);
        height += l.height;
        length += l.levels[0]!.length;
        uncompressed += l.levels[0]!.uncompressed;
    });
    const align = top.scheme === SCHEME_NONE ? UASTC_BLOCK_BYTES : 1;
    let cursor = HEADER_BYTES + LEVEL_ENTRY_BYTES;
    const dfdAt = cursor;
    cursor += top.dfd.length;
    const kvdAt = top.kvd.length ? cursor : 0;
    cursor += top.kvd.length;
    cursor = Math.ceil(cursor / align) * align;
    const dataAt = cursor;
    const out = new Uint8Array(dataAt + length);
    const v = new DataView(out.buffer);
    out.set(base.subarray(0, 48), 0);
    v.setUint32(24, height, true);
    v.setUint32(40, 1, true);
    v.setUint32(48, dfdAt, true); v.setUint32(52, top.dfd.length, true);
    v.setUint32(56, kvdAt, true); v.setUint32(60, top.kvd.length, true);
    v.setBigUint64(64, 0n, true); v.setBigUint64(72, 0n, true);
    out.set(base.subarray(top.dfd.offset, top.dfd.offset + top.dfd.length), dfdAt);
    if (top.kvd.length) out.set(base.subarray(top.kvd.offset, top.kvd.offset + top.kvd.length), kvdAt);
    v.setBigUint64(HEADER_BYTES, BigInt(dataAt), true);
    v.setBigUint64(HEADER_BYTES + 8, BigInt(length), true);
    v.setBigUint64(HEADER_BYTES + 16, BigInt(uncompressed), true);
    let at = dataAt;
    strips.forEach((strip, i) => {
        const level = layouts[i]!.levels[0]!;
        out.set(strip.subarray(level.offset, level.offset + level.length), at);
        at += level.length;
    });
    return out;
}

/**
 * One UASTC KTX2 of every level the parts hold, in order: each part's first level
 * must be half the size of the previous part's last. The first part's header and
 * descriptors are the result's.
 */
export function joinMipLevels(parts: Uint8Array[]): Uint8Array {
    const layouts = parts.map((p) => readKtx2Layout(p));
    if (layouts.some((l) => !l)) throw new Error('joinMipLevels: not a KTX2');
    const top = layouts[0]!;
    const base = parts[0]!;
    const sources: Array<{ bytes: Uint8Array; level: Ktx2Level }> = [];
    let expect: [number, number] | null = null;
    layouts.forEach((layout, i) => {
        const l = layout!;
        if (l.scheme !== top.scheme) throw new Error(`joinMipLevels: supercompression differs (${top.scheme} and ${l.scheme})`);
        if (l.colorModel !== KHR_DF_MODEL_UASTC) throw new Error('joinMipLevels: every part must be UASTC');
        if (l.sgdLength) throw new Error('joinMipLevels: global data cannot be joined');
        if (expect && (l.width !== expect[0] || l.height !== expect[1])) {
            throw new Error(`joinMipLevels: ${l.width}x${l.height} is not the level under ${expect[0] * 2}x${expect[1] * 2}`);
        }
        l.levels.forEach((level) => sources.push({ bytes: parts[i]!, level }));
        const w = Math.max(1, l.width >> (l.levels.length - 1)), h = Math.max(1, l.height >> (l.levels.length - 1));
        expect = [Math.max(1, w >> 1), Math.max(1, h >> 1)];
    });
    const count = sources.length;
    const align = top.scheme === SCHEME_NONE ? UASTC_BLOCK_BYTES : 1;
    const round = (n: number) => Math.ceil(n / align) * align;

    let cursor = HEADER_BYTES + count * LEVEL_ENTRY_BYTES;
    const dfdAt = cursor;
    cursor += top.dfd.length;
    const kvdAt = top.kvd.length ? cursor : 0;
    cursor += top.kvd.length;
    // Smallest level first, as the format lays them out.
    const placed = new Array<number>(count);
    for (let i = count - 1; i >= 0; i--) {
        cursor = round(cursor);
        placed[i] = cursor;
        cursor += sources[i].level.length;
    }

    const out = new Uint8Array(cursor);
    const v = new DataView(out.buffer);
    out.set(base.subarray(0, 48), 0);
    v.setUint32(40, count, true);
    v.setUint32(48, dfdAt, true); v.setUint32(52, top.dfd.length, true);
    v.setUint32(56, kvdAt, true); v.setUint32(60, top.kvd.length, true);
    v.setBigUint64(64, 0n, true); v.setBigUint64(72, 0n, true);
    out.set(base.subarray(top.dfd.offset, top.dfd.offset + top.dfd.length), dfdAt);
    if (top.kvd.length) out.set(base.subarray(top.kvd.offset, top.kvd.offset + top.kvd.length), kvdAt);
    sources.forEach(({ bytes, level }, i) => {
        const at = HEADER_BYTES + i * LEVEL_ENTRY_BYTES;
        v.setBigUint64(at, BigInt(placed[i]), true);
        v.setBigUint64(at + 8, BigInt(level.length), true);
        v.setBigUint64(at + 16, BigInt(level.uncompressed), true);
        out.set(bytes.subarray(level.offset, level.offset + level.length), placed[i]);
    });
    return out;
}
