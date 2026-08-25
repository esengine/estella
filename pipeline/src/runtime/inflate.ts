// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  inflate.ts — raw DEFLATE, for the payloads a single-file build inlines.
 *
 *        A playable ad is one HTML file under a hard byte cap, so its engine
 *        arrives as text: base64 costs +33% over the binary, and the binary
 *        itself is a 1.5MB wasm that deflates to 29% of that. Compressing before
 *        encoding is worth more than any denser encoding could be.
 *
 *        The browser has `DecompressionStream`, and this does not use it. It
 *        landed in Safari 16.4, and a playable that white-screens on the older
 *        WebViews still in an ad network's traffic is worse than one that is
 *        larger — the impression is paid for either way. A fallback path would
 *        be a second decoder that only some devices ever run, which is the shape
 *        every "it works on the machine that tested it" bug comes in. So there
 *        is one path, it runs everywhere, and every device exercises the code
 *        the tests exercise.
 *
 *        RAW deflate (no zlib or gzip wrapper): the producer is
 *        `deflateRawSync`, the size is known from the manifest, and the checksum
 *        a wrapper carries would only re-answer what `WebAssembly.instantiate`
 *        answers immediately after.
 *
 *        Structure follows zlib's `puff.c` — the canonical-Huffman decode walks
 *        code lengths a bit at a time rather than building a lookup table.
 *        Measured on the engine's own wasm, that is fast enough to not be worth
 *        the bigger decoder (see inflate.test.ts, which holds the rate).
 */

/** Longest Huffman code DEFLATE permits. */
const MAX_BITS = 15;

/** RFC 1951 §3.2.5 — length codes 257..285. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
  67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
  4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/** RFC 1951 §3.2.5 — distance codes 0..29. */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
  9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** RFC 1951 §3.2.7 — the order code lengths are themselves written in. */
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/**
 * A canonical Huffman table as counts-per-length plus symbols in canonical
 * order — the two arrays the length-walking decode needs, and nothing else.
 */
interface Huffman {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array, n: number): Huffman {
  const counts = new Int32Array(MAX_BITS + 1);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Int32Array(MAX_BITS + 1);
  for (let len = 1; len <= MAX_BITS; len++) offsets[len] = offsets[len - 1] + counts[len - 1];
  const symbols = new Int32Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

/** The fixed tables of RFC 1951 §3.2.6, built once. */
function fixedTables(): { lit: Huffman; dist: Huffman } {
  const litLengths = new Uint8Array(288);
  litLengths.fill(8, 0, 144);
  litLengths.fill(9, 144, 256);
  litLengths.fill(7, 256, 280);
  litLengths.fill(8, 280, 288);
  const distLengths = new Uint8Array(30).fill(5);
  return { lit: buildHuffman(litLengths, 288), dist: buildHuffman(distLengths, 30) };
}
let FIXED: { lit: Huffman; dist: Huffman } | null = null;

/**
 * Decompress raw DEFLATE.
 *
 * @param src           the deflated bytes
 * @param expectedSize  the original length, which the caller knows: the output
 *                      is allocated once at the right size rather than grown,
 *                      and a stream that does not fill it exactly is corrupt
 *                      and says so here rather than at some later use.
 */
export function inflateRaw(src: Uint8Array, expectedSize: number): Uint8Array {
  const out = new Uint8Array(expectedSize);
  let outPos = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;

  const need = (n: number): number => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('inflate: ran out of input');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };

  // Walk code lengths shortest-first, comparing against the canonical first code
  // of each length — no table, so nothing to build per block.
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= need(1);
      const count = h.counts[len];
      if (code - first < count) return h.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: bad Huffman code');
  };

  for (;;) {
    const last = need(1);
    const type = need(2);

    if (type === 0) {
      // Stored: skip to the byte boundary, then a length and its complement.
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > src.length) throw new Error('inflate: truncated stored block');
      const len = src[pos] | (src[pos + 1] << 8);
      const nlen = src[pos + 2] | (src[pos + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored length mismatch');
      pos += 4;
      if (pos + len > src.length) throw new Error('inflate: truncated stored block');
      if (outPos + len > expectedSize) throw new Error('inflate: output longer than expected');
      out.set(src.subarray(pos, pos + len), outPos);
      pos += len;
      outPos += len;
    } else if (type === 1 || type === 2) {
      let lit: Huffman;
      let dist: Huffman;
      if (type === 1) {
        FIXED ??= fixedTables();
        ({ lit, dist } = FIXED);
      } else {
        const nlen = need(5) + 257;
        const ndist = need(5) + 1;
        const ncode = need(4) + 4;
        const clen = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) clen[CLEN_ORDER[i]] = need(3);
        const clenHuff = buildHuffman(clen, 19);
        // Literal/length and distance lengths are one run, coded together.
        const lengths = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(clenHuff);
          if (sym < 16) {
            lengths[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new Error('inflate: repeat with no previous length');
            const prev = lengths[i - 1];
            for (let r = need(2) + 3; r > 0; r--) lengths[i++] = prev;
          } else if (sym === 17) {
            i += need(3) + 3;
          } else {
            i += need(7) + 11;
          }
        }
        if (lengths.length < nlen + ndist) throw new Error('inflate: code length overflow');
        lit = buildHuffman(lengths.subarray(0, nlen), nlen);
        dist = buildHuffman(lengths.subarray(nlen), ndist);
      }

      for (;;) {
        const sym = decode(lit);
        if (sym === 256) break;
        if (sym < 256) {
          if (outPos >= expectedSize) throw new Error('inflate: output longer than expected');
          out[outPos++] = sym;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw new Error('inflate: bad length code');
          const len = LENGTH_BASE[li] + need(LENGTH_EXTRA[li]);
          const di = decode(dist);
          if (di >= DIST_BASE.length) throw new Error('inflate: bad distance code');
          const d = DIST_BASE[di] + need(DIST_EXTRA[di]);
          if (d > outPos) throw new Error('inflate: distance before start of output');
          if (outPos + len > expectedSize) throw new Error('inflate: output longer than expected');
          // Byte at a time on purpose: DEFLATE allows the match to overlap what
          // it is still writing (a run is coded as distance 1), so a block copy
          // would read bytes that do not exist yet.
          let from = outPos - d;
          for (let k = 0; k < len; k++) out[outPos++] = out[from++];
        }
      }
    } else {
      throw new Error('inflate: reserved block type');
    }

    if (last) break;
  }

  if (outPos !== expectedSize) {
    throw new Error(`inflate: expected ${expectedSize} bytes, produced ${outPos}`);
  }
  return out;
}
