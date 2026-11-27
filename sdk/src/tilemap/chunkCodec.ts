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
 *          pairs a binary with a bundle. The blob records its encoding so the
 *          reader can remap coordinates and flags and reject unrepresentable
 *          IDs. 'ESTM' is the older magic, which carries no header and means
 *          exactly the frozen `TILEMAP_V1_*` values.
 */

import {
  CHUNK_SIZE, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D,
  TILEMAP_BLOB_MAGIC_V1, TILEMAP_BLOB_MAGIC_V2,
  TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
  TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D,
} from '../wasm/constants.generated';
import { isTileCoordinate } from './tileGeometry';
import { decodeBase64Bytes } from '../util/base64';

/**
 * Tiles per chunk side, from the C++ `CHUNK_SIZE` that owns it. Generated, so
 * this is not a second answer: a chunk decoded at the wrong side length reads a
 * saved map into the wrong cells rather than failing to load.
 */
export { CHUNK_SIZE };
const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;

const V1 = [TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
  TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D];
const V2_HEADER_BYTES = 4 + 2 * 6 + 4;
const V1_HEADER_BYTES = 8;

/**
 * One cell from one encoding into another: the id it holds and the three flags
 * it carries, at the positions this reader uses. -1 where the id does not FIT a
 * narrowed mask — the only honest answers there are the tile or a refusal.
 * `from` is `[chunkSize, idMask, flipH, flipV, flipD]`.
 */
export function recodeCell(word: number, from: readonly number[]): number {
    const id = word & from[1]!;
    if (id > TILE_ID_MASK) return -1;
    let next = id;
    if (word & from[2]!) next |= TILE_FLIP_H;
    if (word & from[3]!) next |= TILE_FLIP_V;
    if (word & from[4]!) next |= TILE_FLIP_D;
    return next;
}

/** Floor division and its remainder, so a chunk left of the origin lands where
 *  it belongs rather than rounding toward zero. */
const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const floorMod = (a: number, b: number): number => ((a % b) + b) % b;

/** One decoded chunk: its chunk-grid coords + the 16×16 row-major tile ids. */
export interface DecodedChunk {
  x: number;
  y: number;
  tiles: Uint16Array;
}

/** Decode a `tilemap_exportChunks` blob into its non-empty chunks (empty/invalid → []). */
export function decodeTilemapChunks(blob: string): DecodedChunk[] {
  if (!blob) return [];
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Bytes(blob);
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
  const side = wrote[0]!;
  if (side <= 0) return [];
  const count = dv.getUint32(off - 4, true);

  const aligned = side === CHUNK_SIZE;
  const sameEncoding = wrote[1] === TILE_ID_MASK && wrote[2] === TILE_FLIP_H && wrote[3] === TILE_FLIP_V && wrote[4] === TILE_FLIP_D;
  const knownBits = TILE_ID_MASK | TILE_FLIP_H | TILE_FLIP_V | TILE_FLIP_D;
  const chunks = new Map<string, DecodedChunk>();
  const chunkAt = (x: number, y: number): DecodedChunk => {
    const key = `${x},${y}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { x, y, tiles: new Uint16Array(CHUNK_TILES) };
      chunks.set(key, chunk);
    }
    return chunk;
  };
  const perChunk = 8 + side * side * 2;
  for (let c = 0; c < count; c++) {
    if (off + perChunk > bytes.byteLength) break;   // truncated → stop
    const cx = dv.getInt32(off, true);
    const cy = dv.getInt32(off + 4, true);
    const left = cx * side, top = cy * side;
    const chunkFits = isTileCoordinate(left) && isTileCoordinate(top)
      && isTileCoordinate(left + side - 1) && isTileCoordinate(top + side - 1);
    let alignedChunk: DecodedChunk | undefined;
    let at = off + 8;
    for (let i = 0; i < side * side; i++, at += 2) {
      const word = dv.getUint16(at, true);
      if (word === 0) continue;
      const cell = sameEncoding ? word & knownBits : recodeCell(word, wrote);
      if (cell < 0) return [];   // a narrowed mask cannot carry this tile
      if (aligned && chunkFits) {
        (alignedChunk ??= chunkAt(cx, cy)).tiles[i] = cell;
        continue;
      }
      const x = left + (i % side);
      const y = top + Math.floor(i / side);
      if (!chunkFits && (!isTileCoordinate(x) || !isTileCoordinate(y))) return [];
      const chunk = chunkAt(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE));
      chunk.tiles[floorMod(y, CHUNK_SIZE) * CHUNK_SIZE + floorMod(x, CHUNK_SIZE)] = cell;
    }
    off += perChunk;
  }
  return [...chunks.values()];
}
