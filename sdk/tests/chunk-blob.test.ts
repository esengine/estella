// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The saved form of a painted map, and what it says about its own
 *        encoding.
 *
 * A `.esscene` outlives the binary that wrote it, and the ABI layout hash only
 * pairs a binary with a bundle. Widening the id mask by one bit leaves every
 * byte where it was, so a map painted before it reads as different tiles with
 * nothing failing anywhere — which is what these refuse.
 *
 * This is the reading half. The engine writes the blob and reads it back
 * through the same header, which `tests/tilemap/test_tilemap.cpp` holds: the
 * bindings abort headless, so there is no round trip to be had from here.
 */
import { describe, it, expect } from 'vitest';
import { decodeTilemapChunks, CHUNK_SIZE } from '../src/tilemap/chunkCodec';
import {
    TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D,
    TILEMAP_BLOB_MAGIC_V1, TILEMAP_BLOB_MAGIC_V2,
    TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
    TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D,
} from '../src/wasm/constants.generated';

const TILES = CHUNK_SIZE * CHUNK_SIZE;

function toBase64Url(buf: ArrayBuffer): string {
    let bin = '';
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

/** The older magic: chunks, and no word about how to read them. */
function v1Blob(tiles: Uint16Array, chunkSize = CHUNK_SIZE): string {
    const per = 8 + chunkSize * chunkSize * 2;
    const dv = new DataView(new ArrayBuffer(8 + per));
    dv.setUint32(0, TILEMAP_BLOB_MAGIC_V1, true);
    dv.setUint32(4, 1, true);
    dv.setInt32(8, 3, true);
    dv.setInt32(12, -2, true);
    for (let i = 0; i < chunkSize * chunkSize; i++) dv.setUint16(16 + i * 2, tiles[i] ?? 0, true);
    return toBase64Url(dv.buffer);
}

/** The versioned magic, written under whatever encoding is passed. */
function v2Blob(tiles: Uint16Array, enc: number[] = [CHUNK_SIZE, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D]): string {
    const side = enc[0]!;
    const per = 8 + side * side * 2;
    const dv = new DataView(new ArrayBuffer(20 + per));
    dv.setUint32(0, TILEMAP_BLOB_MAGIC_V2, true);
    for (let i = 0; i < 5; i++) dv.setUint16(4 + i * 2, enc[i]!, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, 1, true);
    dv.setInt32(20, 3, true);
    dv.setInt32(24, -2, true);
    for (let i = 0; i < side * side; i++) dv.setUint16(28 + i * 2, tiles[i] ?? 0, true);
    return toBase64Url(dv.buffer);
}

function painted(): Uint16Array {
    const tiles = new Uint16Array(TILES);
    tiles[0] = 5;
    tiles[CHUNK_SIZE + 1] = 7 | TILE_FLIP_H;
    return tiles;
}

describe('a saved map says which encoding it was painted under', () => {
    it('reads the older magic, which is every scene painted so far', () => {
        const chunks = decodeTilemapChunks(v1Blob(painted()));
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toMatchObject({ x: 3, y: -2 });
        expect([chunks[0]!.tiles[0], chunks[0]!.tiles[CHUNK_SIZE + 1]]).toEqual([5, 7 | TILE_FLIP_H]);
    });

    it('reads the versioned magic to the same chunks', () => {
        expect(decodeTilemapChunks(v2Blob(painted()))).toEqual(decodeTilemapChunks(v1Blob(painted())));
    });

    /**
     * The bit that would be silent. A 14-bit id mask leaves every byte where it
     * is: the same blob parses, and each cell that carried a flip flag becomes a
     * different tile.
     */
    it('refuses a map painted under a wider id mask', () => {
        const wider = [CHUNK_SIZE, 0x3fff, 0x4000, 0x8000, 0x0000];
        expect(decodeTilemapChunks(v2Blob(painted(), wider))).toEqual([]);
    });

    /**
     * A LARGER side on purpose: a smaller one runs the reader off the end and
     * the truncation guard answers, so that version of this passes with the
     * encoding check taken out. At 32 the reader has bytes enough to hand back
     * 256 of them as a chunk.
     */
    it('refuses a map painted at another chunk size', () => {
        const wide = [32, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D];
        const tiles = new Uint16Array(32 * 32);
        tiles[0] = 5;
        expect(decodeTilemapChunks(v2Blob(tiles, wide))).toEqual([]);
    });

    it('refuses a blob that is not one of ours', () => {
        const dv = new DataView(new ArrayBuffer(64));
        dv.setUint32(0, 0x12345678, true);
        expect(decodeTilemapChunks(toBase64Url(dv.buffer))).toEqual([]);
    });

    /**
     * What the older magic MEANT, as literals. Re-pointing these at the live
     * constants would make every map painted so far read as whatever the engine
     * is now — the one failure this format cannot detect for itself.
     */
    it('remembers the older magic as history, not as configuration', () => {
        expect([TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
            TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D])
            .toEqual([16, 0x1fff, 0x2000, 0x4000, 0x8000]);
    });
});

