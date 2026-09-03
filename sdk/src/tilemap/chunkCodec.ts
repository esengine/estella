// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    chunkCodec.ts
 * @brief   Decode the `tilemap_exportChunks` blob so the SDK can
 *          read painted tiles back — used to derive runtime collision from a tilemap's
 *          collidable tiles. Format (little-endian, base64url):
 *            u32 magic 'TMAP' · u16 chunkSize, idMask, flipH, flipV, flipD, reserved
 *            · u32 chunkCount · per chunk: i32 x, i32 y, u16 tiles[chunkSize²]
 *          Empty chunks are omitted by the exporter.
 *
 *          A saved map outlives the binary that wrote it, and the ABI hash only
 *          pairs a binary with a bundle. So the blob says which encoding it was
 *          written under and a reader whose own differs REFUSES: the same bytes
 *          would parse and mean other tiles. 'ESTM' is the older magic, which
 *          carries no header and means exactly the frozen `TILEMAP_V1_*` values.
 */

import {
  CHUNK_SIZE, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D,
  TILEMAP_BLOB_MAGIC_V1, TILEMAP_BLOB_MAGIC_V2,
  TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
  TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D,
} from '../wasm/constants.generated';

/**
 * Tiles per chunk side, from the C++ `CHUNK_SIZE` that owns it. Generated, so
 * this is not a second answer: a chunk decoded at the wrong side length reads a
 * saved map into the wrong cells rather than failing to load.
 */
export { CHUNK_SIZE };
const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;

/** The chunk stride and cell split a blob has to have been written under. */
const RUNNING = [CHUNK_SIZE, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D];
const V1 = [TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
  TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D];
const V2_HEADER_BYTES = 4 + 2 * 6 + 4;
const V1_HEADER_BYTES = 8;

const sameEncoding = (a: number[]): boolean => a.every((v, i) => v === RUNNING[i]);

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
  if (bytes.byteLength < V1_HEADER_BYTES) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0, true);
  let wrote: number[];
  let off: number;
  if (magic === TILEMAP_BLOB_MAGIC_V2) {
    if (bytes.byteLength < V2_HEADER_BYTES) return [];
    wrote = [0, 1, 2, 3, 4].map((i) => dv.getUint16(4 + i * 2, true));
    off = V2_HEADER_BYTES;
  } else if (magic === TILEMAP_BLOB_MAGIC_V1) {
    wrote = V1;
    off = V1_HEADER_BYTES;
  } else {
    return [];
  }
  // Refused, not decoded: these bytes would parse into different tiles.
  if (!sameEncoding(wrote)) return [];
  const count = dv.getUint32(off - 4, true);
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
