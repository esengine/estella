// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    chunkCodec.ts
 * @brief   Decode the `tilemap_exportChunks` blob (REARCH_TILEMAP T4) so the SDK can
 *          read painted tiles back — used to derive runtime collision from a tilemap's
 *          collidable tiles. Format (little-endian, base64url):
 *            u32 magic 'ESTM' · u32 chunkCount · per chunk: i32 x, i32 y, u16 tiles[256]
 *          (CHUNK_SIZE = 16; empty chunks are omitted by the exporter.)
 */

/** Tiles per chunk side (mirrors C++ `tilemap::CHUNK_SIZE`). */
export const CHUNK_SIZE = 16;
const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;
const ESTM_MAGIC = 0x4d545345;

/** One decoded chunk: its chunk-grid coords + the 16×16 row-major tile ids. */
export interface DecodedChunk {
  x: number;
  y: number;
  tiles: Uint16Array;
}

// Self-contained base64 decode (no `atob` — it's absent on some targets, e.g. wechat).
// Accepts both the url-safe (-_) and standard (+/) alphabets; ignores padding/whitespace.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  t[43] = 62; t[45] = 62; // '+' '-'
  t[47] = 63; t[95] = 63; // '/' '_'
  return t;
})();

function base64UrlToBytes(s: string): Uint8Array {
  const vals: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_LOOKUP[c] : -1;
    if (v >= 0) vals.push(v);
  }
  const out = new Uint8Array((vals.length * 6) >> 3);
  let bits = 0, acc = 0, o = 0;
  for (const v of vals) {
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

/** Decode a `tilemap_exportChunks` blob into its non-empty chunks (empty/invalid → []). */
export function decodeTilemapChunks(blob: string): DecodedChunk[] {
  if (!blob) return [];
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(blob);
  } catch {
    return [];
  }
  if (bytes.byteLength < 8) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  if (dv.getUint32(off, true) !== ESTM_MAGIC) return [];
  off += 4;
  const count = dv.getUint32(off, true);
  off += 4;
  const chunks: DecodedChunk[] = [];
  const perChunk = 8 + CHUNK_TILES * 2;
  for (let i = 0; i < count; i++) {
    if (off + perChunk > bytes.byteLength) break; // truncated → stop
    const x = dv.getInt32(off, true); off += 4;
    const y = dv.getInt32(off, true); off += 4;
    const tiles = new Uint16Array(CHUNK_TILES);
    for (let t = 0; t < CHUNK_TILES; t++) { tiles[t] = dv.getUint16(off, true); off += 2; }
    chunks.push({ x, y, tiles });
  }
  return chunks;
}
