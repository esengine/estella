// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    inflate.ts
 * @brief   A synchronous deflate decoder for hosts without streaming decompression.
 *
 * @details Canonical Huffman codes are read bit by bit as in zlib's `puff.c`.
 *          Both PNG rows and the AgX tables provide their exact output size.
 */

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes there are of each length, and the symbols in code order. */
interface Huffman { count: Uint16Array; symbol: Uint16Array }

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
    const count = new Uint16Array(16), symbol = new Uint16Array(n), offsets = new Uint16Array(16);
    for (let i = 0; i < n; i++) count[lengths[i]!]!++;
    let slots = 1;
    for (let len = 1; len <= 15; len++) {
        slots = slots * 2 - count[len]!;
        if (slots < 0) throw new Error('inflate: oversubscribed Huffman codes');
    }
    for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len]! + count[len]!;
    for (let i = 0; i < n; i++) if (lengths[i]) symbol[offsets[lengths[i]!]!++] = i;
    return { count, symbol };
}

let fixedLiteral: Huffman | undefined, fixedDistance: Huffman | undefined;

/** Inflate a raw deflate stream whose decoded size is `size` bytes. */
export function inflateRaw(input: Uint8Array, size: number): Uint8Array {
    // A deflate symbol takes at least one bit and can produce at most 258 bytes.
    if (!Number.isSafeInteger(size) || size < 0 || size > input.length * 8 * 258) throw new Error('inflate: impossible output size');
    const out = new Uint8Array(size);
    let inPos = 0, bitBuf = 0, bitCount = 0, outPos = 0;

    const bits = (need: number): number => {
        let value = bitBuf;
        while (bitCount < need) {
            if (inPos >= input.length) throw new Error('inflate: the data ends early');
            value |= input[inPos++]! << bitCount;
            bitCount += 8;
        }
        bitBuf = value >>> need;
        bitCount -= need;
        return value & ((1 << need) - 1);
    };
    const decode = (h: Huffman): number => {
        let code = 0, first = 0, index = 0;
        for (let len = 1; len <= 15; len++) {
            code |= bits(1);
            const count = h.count[len]!;
            if (code - count < first) return h.symbol[index + (code - first)]!;
            index += count; first += count; first <<= 1; code <<= 1;
        }
        throw new Error('inflate: a code that is not one');
    };

    let last = 0;
    while (!last) {
        last = bits(1);
        const type = bits(2);
        if (type === 0) {
            bitBuf = 0; bitCount = 0; // stored: skip to the byte boundary
            if (inPos + 4 > input.length) throw new Error('inflate: the data ends early');
            const len = input[inPos]! | (input[inPos + 1]! << 8);
            const complement = input[inPos + 2]! | (input[inPos + 3]! << 8);
            inPos += 4;
            if ((len ^ complement) !== 0xffff || inPos + len > input.length || outPos + len > size) {
                throw new Error('inflate: invalid stored block length');
            }
            out.set(input.subarray(inPos, inPos + len), outPos);
            inPos += len; outPos += len;
            continue;
        }
        let literal: Huffman, distance: Huffman;
        if (type === 1) {
            if (!fixedLiteral) {
                const lengths = new Uint8Array(288);
                lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280, 288);
                fixedLiteral = huffman(lengths, 288);
                fixedDistance = huffman(new Uint8Array(30).fill(5), 30);
            }
            literal = fixedLiteral; distance = fixedDistance!;
        } else if (type === 2) {
            const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
            if (nlen > 286) throw new Error('inflate: invalid literal count');
            const lengths = new Uint8Array(320);
            for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]!] = bits(3);
            const codeLengths = huffman(lengths.subarray(0, 19), 19);
            const all = new Uint8Array(nlen + ndist);
            for (let i = 0; i < nlen + ndist;) {
                const sym = decode(codeLengths);
                if (sym < 16) { all[i++] = sym; continue; }
                let repeat: number, value = 0;
                if (sym === 16) {
                    if (!i) throw new Error('inflate: no previous code length');
                    value = all[i - 1]!;
                    repeat = 3 + bits(2);
                }
                else if (sym === 17) repeat = 3 + bits(3);
                else repeat = 11 + bits(7);
                if (i + repeat > nlen + ndist) throw new Error('inflate: repeated code lengths exceed the tree');
                while (repeat--) all[i++] = value;
            }
            if (!all[256]) throw new Error('inflate: missing end of block code');
            literal = huffman(all.subarray(0, nlen), nlen);
            distance = huffman(all.subarray(nlen), ndist);
        } else throw new Error('inflate: not a deflate block');

        for (;;) {
            const sym = decode(literal);
            if (sym < 256) {
                if (outPos >= size) throw new Error('inflate: too much data');
                out[outPos++] = sym;
                continue;
            }
            if (sym === 256) break;
            const lengthIndex = sym - 257;
            if (lengthIndex >= LENGTH_BASE.length) throw new Error('inflate: invalid length code');
            const length = LENGTH_BASE[lengthIndex]! + bits(LENGTH_EXTRA[lengthIndex]!);
            const distanceSymbol = decode(distance);
            if (distanceSymbol >= DISTANCE_BASE.length) throw new Error('inflate: invalid distance code');
            const back = DISTANCE_BASE[distanceSymbol]! + bits(DISTANCE_EXTRA[distanceSymbol]!);
            if (back > outPos || outPos + length > size) throw new Error('inflate: invalid copy range');
            for (let i = 0; i < length; i++, outPos++) out[outPos] = out[outPos - back]!;
        }
    }
    if (outPos !== size) throw new Error('inflate: wrong output size');
    return out;
}

/** Inflate a zlib stream with no preset dictionary and check its Adler-32 trailer. */
export function inflateZlib(input: Uint8Array, size: number): Uint8Array {
    const cmf = input[0]!, flags = input[1]!;
    if (input.length < 6 || (cmf & 15) !== 8 || (cmf >>> 4) > 7 || (flags & 32) || ((cmf << 8) | flags) % 31 !== 0) {
        throw new Error('inflate: invalid zlib header');
    }
    const end = input.length - 4;
    const out = inflateRaw(input.subarray(2, end), size);
    let a = 1, b = 0;
    for (const byte of out) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    if (((b << 16) | a) >>> 0 !== new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(end)) {
        throw new Error('inflate: incorrect zlib checksum');
    }
    return out;
}
