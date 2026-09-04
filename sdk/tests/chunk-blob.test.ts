// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The saved form of a painted map, and reading one written under another
 *        encoding.
 *
 * A `.esscene` outlives the binary that wrote it, and the ABI layout hash pairs
 * a binary with a bundle only. Widening the id mask leaves every byte where it
 * was, so a map painted before it reads as different tiles with nothing failing
 * — and refusing it would break the promise that a MINOR opens what an older
 * one saved. So the blob says what it was written as and the reader migrates.
 *
 * The engine's own reader is C++ and takes the same walk; `test_tilemap.cpp`
 * holds that half, since the bindings abort headless.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeTilemapChunks, CHUNK_SIZE } from '../src/tilemap/chunkCodec';
import {
    TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D,
    TILEMAP_BLOB_MAGIC_V1, TILEMAP_BLOB_MAGIC_V2,
    TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
    TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D,
} from '../src/wasm/constants.generated';

const HERE = __dirname;

function toBase64Url(buf: ArrayBuffer): string {
    let bin = '';
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

/** A blob under any encoding: `[side, idMask, flipH, flipV, flipD]`, and cells
 *  by chunk coordinate and local index. */
function blob(enc: number[], chunks: { x: number; y: number; cells: [number, number, number][] }[],
    magic = TILEMAP_BLOB_MAGIC_V2): string {
    const side = enc[0]!;
    const head = magic === TILEMAP_BLOB_MAGIC_V2 ? 20 : 8;
    const per = 8 + side * side * 2;
    const dv = new DataView(new ArrayBuffer(head + chunks.length * per));
    dv.setUint32(0, magic, true);
    if (magic === TILEMAP_BLOB_MAGIC_V2) {
        for (let i = 0; i < 5; i++) dv.setUint16(4 + i * 2, enc[i]!, true);
        dv.setUint16(14, 0, true);
    }
    dv.setUint32(head - 4, chunks.length, true);
    let off = head;
    for (const c of chunks) {
        dv.setInt32(off, c.x, true);
        dv.setInt32(off + 4, c.y, true);
        for (const [lx, ly, w] of c.cells) dv.setUint16(off + 8 + (ly * side + lx) * 2, w, true);
        off += per;
    }
    return toBase64Url(dv.buffer);
}

/** Every non-empty cell by WORLD coordinate, which is what survives a re-chunk. */
function world(decoded: ReturnType<typeof decodeTilemapChunks>): Map<string, number> {
    const out = new Map<string, number>();
    for (const c of decoded) {
        for (let i = 0; i < c.tiles.length; i++) {
            const w = c.tiles[i]!;
            if (w === 0) continue;
            out.set(`${c.x * CHUNK_SIZE + (i % CHUNK_SIZE)},${c.y * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE)}`, w);
        }
    }
    return out;
}

const RUNNING = [CHUNK_SIZE, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D];

describe('a map saved before this engine', () => {
    /**
     * A real blob under the older magic, checked in: the maximum id, each flip
     * alone, all three together, an empty cell, and a chunk wholly in negative
     * space. This is the file the compatibility promise is about.
     */
    it('reads a checked-in v1 blob, cell for cell', () => {
        const golden = readFileSync(resolve(HERE, 'fixtures/tilemap-esscene-v1.blob.txt'), 'utf8').trim();
        expect(world(decodeTilemapChunks(golden))).toEqual(new Map([
            ['0,0', 1],
            ['1,0', TILE_ID_MASK],
            ['2,0', 5 | TILE_FLIP_H],
            ['3,0', 5 | TILE_FLIP_V],
            ['4,0', 5 | TILE_FLIP_D],
            ['5,0', 5 | TILE_FLIP_H | TILE_FLIP_V | TILE_FLIP_D],
            ['-1,-1', 7 | TILE_FLIP_H],
        ]));
    });

    it('reads the versioned magic to the same cells', () => {
        const cells: [number, number, number][] = [[0, 0, 1], [2, 0, 5 | TILE_FLIP_H]];
        expect(world(decodeTilemapChunks(blob(RUNNING, [{ x: 0, y: 0, cells }]))))
            .toEqual(new Map([['0,0', 1], ['2,0', 5 | TILE_FLIP_H]]));
    });

    /**
     * The change that would otherwise be silent, and the one the promise is
     * about: the flags sat in other bits, so every byte parses and every cell
     * means something else. Migrated, the tile and its flags come back.
     */
    it('migrates a map whose flags sat in other bits', () => {
        const permuted = [CHUNK_SIZE, 0x1fff, 0x8000, 0x2000, 0x4000];
        const cells: [number, number, number][] = [
            [0, 0, 9 | 0x8000],                   // its H
            [1, 0, 9 | 0x2000],                   // its V
            [2, 0, 9 | 0x4000],                   // its D
            [3, 0, 9 | 0x8000 | 0x2000 | 0x4000],
        ];
        expect(world(decodeTilemapChunks(blob(permuted, [{ x: 0, y: 0, cells }])))).toEqual(new Map([
            ['0,0', 9 | TILE_FLIP_H],
            ['1,0', 9 | TILE_FLIP_V],
            ['2,0', 9 | TILE_FLIP_D],
            ['3,0', 9 | TILE_FLIP_H | TILE_FLIP_V | TILE_FLIP_D],
        ]));
    });

    /** A stride is not a contract about the world: the same tiles land at the
     *  same places, in this engine's chunks. */
    it('re-chunks a map saved at another stride', () => {
        const wide = [32, TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D];
        const cells: [number, number, number][] = [[0, 0, 3], [31, 31, 4], [17, 2, 5]];
        expect(world(decodeTilemapChunks(blob(wide, [{ x: 0, y: 0, cells }]))))
            .toEqual(new Map([['0,0', 3], ['31,31', 4], ['17,2', 5]]));
    });

    /** The one thing a migration cannot do: a narrower mask has nowhere to put
     *  the tile, and putting SOME other tile there is the whole failure. */
    it('refuses a tile this encoding has no room for', () => {
        const wider = [CHUNK_SIZE, 0x3fff, 0x4000, 0x8000, 0x0000];
        expect(decodeTilemapChunks(blob(wider, [{ x: 0, y: 0, cells: [[0, 0, 0x2001]] }]))).toEqual([]);
    });

    it('refuses a blob that is not one of ours', () => {
        const dv = new DataView(new ArrayBuffer(64));
        dv.setUint32(0, 0x12345678, true);
        expect(decodeTilemapChunks(toBase64Url(dv.buffer))).toEqual([]);
    });

    /**
     * What the older magic MEANT, as literals. Re-pointing these at the live
     * constants would read every map painted so far as whatever the engine is
     * now — the one thing this format cannot detect for itself.
     */
    it('remembers the older magic as history, not as configuration', () => {
        expect([TILEMAP_V1_CHUNK_SIZE, TILEMAP_V1_ID_MASK,
            TILEMAP_V1_FLIP_H, TILEMAP_V1_FLIP_V, TILEMAP_V1_FLIP_D])
            .toEqual([16, 0x1fff, 0x2000, 0x4000, 0x8000]);
    });
});
