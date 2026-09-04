// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ChunkBlob.hpp — the saved form of a painted tilemap, and what it says
 *        about the encoding it was written under.
 *
 * The ABI layout hash pairs a BINARY with a BUNDLE. A saved map is neither: it
 * outlives both, and the cell encoding is not written anywhere in it. Widening
 * the id mask by one bit therefore reads every `.esscene` ever painted into
 * different tiles — every check passes, the byte layout is unchanged, and only
 * the picture is wrong.
 *
 * So the blob carries its own encoding, and a reader whose encoding differs
 * REFUSES rather than decoding. The legacy magic has no such header; it means
 * exactly the frozen values below, which is why those are literals and never a
 * reference to the live constants.
 */
#pragma once

#include "../core/Types.hpp"
#include "../core/Reflection.hpp"
#include "TilemapSystem.hpp"

#include <cstring>
#include <vector>

namespace esengine {
namespace tilemap {

/** 'ESTM' — chunks only, and the encoding of the day it was written. */
ES_CONST(hex, ts=TILEMAP_BLOB_MAGIC_V1)
static constexpr u32 BLOB_MAGIC_V1 = 0x4D545345;

/** 'TMAP' — the same chunks behind a header that says how to read them. */
ES_CONST(hex, ts=TILEMAP_BLOB_MAGIC_V2)
static constexpr u32 BLOB_MAGIC_V2 = 0x50414D54;

// What 'ESTM' meant. History, not configuration: pointing these at the live
// constants would make every old map read as whatever the engine is now, which
// is the failure this file exists to refuse.
ES_CONST(ts=TILEMAP_V1_CHUNK_SIZE)
static constexpr u32 V1_CHUNK_SIZE = 16;
ES_CONST(hex, ts=TILEMAP_V1_ID_MASK)
static constexpr u16 V1_TILE_ID_MASK = 0x1FFF;
ES_CONST(hex, ts=TILEMAP_V1_FLIP_H)
static constexpr u16 V1_TILE_FLIP_H = 0x2000;
ES_CONST(hex, ts=TILEMAP_V1_FLIP_V)
static constexpr u16 V1_TILE_FLIP_V = 0x4000;
ES_CONST(hex, ts=TILEMAP_V1_FLIP_D)
static constexpr u16 V1_TILE_FLIP_D = 0x8000;

/** How a saved map has to be read: the chunk stride and the split of a cell. */
struct CellEncoding {
    u16 chunkSize;
    u16 idMask;
    u16 flipH;
    u16 flipV;
    u16 flipD;

    bool operator==(const CellEncoding& o) const {
        return chunkSize == o.chunkSize && idMask == o.idMask
            && flipH == o.flipH && flipV == o.flipV && flipD == o.flipD;
    }
};

inline CellEncoding runningEncoding() {
    return { static_cast<u16>(CHUNK_SIZE), TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D };
}

/** What the legacy magic means, which is a fact about the past. */
inline CellEncoding v1Encoding() {
    return { static_cast<u16>(V1_CHUNK_SIZE), V1_TILE_ID_MASK,
             V1_TILE_FLIP_H, V1_TILE_FLIP_V, V1_TILE_FLIP_D };
}

inline constexpr usize BLOB_HEADER_V1_BYTES = sizeof(u32) * 2;
inline constexpr usize BLOB_HEADER_V2_BYTES = sizeof(u32) + sizeof(u16) * 6 + sizeof(u32);

/** Where the chunks begin, how many there are, and what they were written as. */
struct BlobHeader {
    usize payloadAt;
    u32 chunkCount;
    CellEncoding wrote;
};

inline void appendBlobHeader(std::vector<u8>& out, u32 chunkCount) {
    const CellEncoding enc = runningEncoding();
    const u16 fields[6] = { enc.chunkSize, enc.idMask, enc.flipH, enc.flipV, enc.flipD, 0 };
    auto put = [&out](const void* p, usize n) {
        const u8* b = static_cast<const u8*>(p);
        out.insert(out.end(), b, b + n);
    };
    put(&BLOB_MAGIC_V2, sizeof(BLOB_MAGIC_V2));
    put(fields, sizeof(fields));
    put(&chunkCount, sizeof(chunkCount));
}

/**
 * The header and the encoding it was written under, or false where these bytes
 * are not one of ours. The legacy magic carries no header, which is why it
 * means the frozen v1 values and not "whatever this engine is now".
 */
inline bool parseBlobHeader(const u8* raw, usize size, BlobHeader& out) {
    if (size < BLOB_HEADER_V1_BYTES) return false;
    u32 magic = 0;
    std::memcpy(&magic, raw, sizeof(magic));

    if (magic == BLOB_MAGIC_V2) {
        if (size < BLOB_HEADER_V2_BYTES) return false;
        u16 fields[5] = {};
        std::memcpy(fields, raw + sizeof(u32), sizeof(fields));
        out.wrote = { fields[0], fields[1], fields[2], fields[3], fields[4] };
        out.payloadAt = BLOB_HEADER_V2_BYTES;
    } else if (magic == BLOB_MAGIC_V1) {
        out.wrote = v1Encoding();
        out.payloadAt = BLOB_HEADER_V1_BYTES;
    } else {
        return false;
    }
    if (out.wrote.chunkSize == 0) return false;
    std::memcpy(&out.chunkCount, raw + out.payloadAt - sizeof(u32), sizeof(out.chunkCount));
    return true;
}

/**
 * One cell from one encoding into another: the id it holds and the three flags
 * it carries, at the positions the reader uses. False where the id does not
 * FIT — a narrowed mask cannot carry it, and the only honest answers there are
 * the tile or a refusal. Everything else is a rename of bit positions.
 */
inline bool recodeCell(u16 word, const CellEncoding& from, const CellEncoding& to, u16& out) {
    const u16 id = static_cast<u16>(word & from.idMask);
    if (id > to.idMask) return false;
    u16 next = id;
    if (word & from.flipH) next = static_cast<u16>(next | to.flipH);
    if (word & from.flipV) next = static_cast<u16>(next | to.flipV);
    if (word & from.flipD) next = static_cast<u16>(next | to.flipD);
    out = next;
    return true;
}

/**
 * Every non-empty cell the payload holds, by WORLD coordinate — the one thing
 * that means the same under any chunk size, so a map saved at one stride reads
 * back at another. `emit(x, y, word)` sees the word as it was written.
 */
template <class Fn>
inline bool walkBlobCells(const u8* raw, usize size, const BlobHeader& header, Fn&& emit) {
    const u32 side = header.wrote.chunkSize;
    const usize perChunk = sizeof(i32) * 2 + static_cast<usize>(side) * side * sizeof(u16);
    if (size < header.payloadAt + static_cast<usize>(header.chunkCount) * perChunk) return false;

    usize at = header.payloadAt;
    for (u32 c = 0; c < header.chunkCount; ++c) {
        i32 cx = 0, cy = 0;
        std::memcpy(&cx, raw + at, sizeof(cx));
        std::memcpy(&cy, raw + at + sizeof(i32), sizeof(cy));
        const u8* cells = raw + at + sizeof(i32) * 2;
        for (u32 i = 0; i < side * side; ++i) {
            u16 word = 0;
            std::memcpy(&word, cells + static_cast<usize>(i) * sizeof(u16), sizeof(word));
            if (word == EMPTY_TILE) continue;
            emit(static_cast<i32>(cx * static_cast<i32>(side) + static_cast<i32>(i % side)),
                 static_cast<i32>(cy * static_cast<i32>(side) + static_cast<i32>(i / side)), word);
        }
        at += perChunk;
    }
    return true;
}

/** Floor division and its remainder, so a chunk left of the origin lands where
 *  it belongs rather than rounding toward zero. */
inline i32 floorDiv(i32 a, i32 b) { return (a >= 0 ? a : a - (b - 1)) / b; }
inline i32 floorMod(i32 a, i32 b) { const i32 m = a % b; return m < 0 ? m + b : m; }

}  // namespace tilemap
}  // namespace esengine
