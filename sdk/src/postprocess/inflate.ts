// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    inflate.ts
 * @brief   A synchronous raw-deflate decoder (RFC 1951), for the few kilobytes of data the SDK carries compressed.
 *
 * @details `DecompressionStream` is asynchronous and absent from mini-game runtimes, and the AgX tables are needed the moment their
 *          effect is built. This is the small decoder of zlib's `puff.c`: canonical Huffman codes read bit by bit, slow beside
 *          a table-driven one and plenty for a hundred kilobytes decoded once.
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
    for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len]! + count[len]!;
    for (let i = 0; i < n; i++) if (lengths[i]) symbol[offsets[lengths[i]!]!++] = i;
    return { count, symbol };
}

let fixedLiteral: Huffman | undefined, fixedDistance: Huffman | undefined;

/** Inflate a raw deflate stream whose decoded size is `size` bytes. */
export function inflateRaw(input: Uint8Array, size: number): Uint8Array {
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
            const len = input[inPos]! | (input[inPos + 1]! << 8);
            inPos += 4;
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
            const lengths = new Uint8Array(320);
            for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]!] = bits(3);
            const codeLengths = huffman(lengths.subarray(0, 19), 19);
            const all = new Uint8Array(nlen + ndist);
            for (let i = 0; i < nlen + ndist;) {
                const sym = decode(codeLengths);
                if (sym < 16) { all[i++] = sym; continue; }
                let repeat: number, value = 0;
                if (sym === 16) { value = all[i - 1]!; repeat = 3 + bits(2); }
                else if (sym === 17) repeat = 3 + bits(3);
                else repeat = 11 + bits(7);
                while (repeat--) all[i++] = value;
            }
            literal = huffman(all.subarray(0, nlen), nlen);
            distance = huffman(all.subarray(nlen), ndist);
        } else throw new Error('inflate: not a deflate block');

        for (;;) {
            const sym = decode(literal);
            if (sym < 256) { out[outPos++] = sym; continue; }
            if (sym === 256) break;
            const lengthIndex = sym - 257;
            const length = LENGTH_BASE[lengthIndex]! + bits(LENGTH_EXTRA[lengthIndex]!);
            const distanceSymbol = decode(distance);
            const back = DISTANCE_BASE[distanceSymbol]! + bits(DISTANCE_EXTRA[distanceSymbol]!);
            for (let i = 0; i < length; i++, outPos++) out[outPos] = out[outPos - back]!;
        }
    }
    return out;
}
