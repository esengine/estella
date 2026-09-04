#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/tilemap/TilemapSystem.hpp>
#include <esengine/tilemap/TileFlip.hpp>
#include <esengine/tilemap/ChunkBlob.hpp>

#include <tuple>
#include <vector>

using namespace esengine;
using namespace esengine::tilemap;

static Entity E(u32 idx) { return Entity::make(idx, 1); }

TEST_CASE("tilemap_init_layer") {
    TilemapSystem sys;

    SUBCASE("layer does not exist before init") {
        CHECK_FALSE(sys.hasLayer(E(0)));
    }

    SUBCASE("layer exists after init") {
        sys.initLayer(E(0), 10, 8, 32.0f, 32.0f);
        CHECK(sys.hasLayer(E(0)));
    }

    SUBCASE("layer destroyed after destroy") {
        sys.initLayer(E(0), 10, 8, 32.0f, 32.0f);
        sys.destroyLayer(E(0));
        CHECK_FALSE(sys.hasLayer(E(0)));
    }

    SUBCASE("multiple layers") {
        sys.initLayer(E(1), 10, 10, 32.0f, 32.0f);
        sys.initLayer(E(2), 20, 20, 16.0f, 16.0f);
        CHECK(sys.hasLayer(E(1)));
        CHECK(sys.hasLayer(E(2)));
        sys.destroyLayer(E(1));
        CHECK_FALSE(sys.hasLayer(E(1)));
        CHECK(sys.hasLayer(E(2)));
    }
}

TEST_CASE("tilemap_set_get_tile") {
    TilemapSystem sys;
    sys.initLayer(E(0), 10, 8, 32.0f, 32.0f);

    SUBCASE("all tiles start empty") {
        CHECK_EQ(sys.getTile(E(0), 0, 0), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 5, 3), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 9, 7), EMPTY_TILE);
    }

    SUBCASE("set and get single tile") {
        sys.setTile(E(0), 3, 4, 42);
        CHECK_EQ(sys.getTile(E(0), 3, 4), 42);
        CHECK_EQ(sys.getTile(E(0), 3, 3), EMPTY_TILE);
    }

    SUBCASE("overwrite tile") {
        sys.setTile(E(0), 0, 0, 10);
        sys.setTile(E(0), 0, 0, 20);
        CHECK_EQ(sys.getTile(E(0), 0, 0), 20);
    }

    SUBCASE("out of bounds returns EMPTY_TILE") {
        CHECK_EQ(sys.getTile(E(0), -1, 0), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 10, 0), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 0, 8), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 0, -1), EMPTY_TILE);
    }

    SUBCASE("set out of bounds is no-op") {
        sys.setTile(E(0), -1, 0, 99);
        sys.setTile(E(0), 10, 0, 99);
        CHECK_EQ(sys.getTile(E(0), 0, 0), EMPTY_TILE);
    }

    SUBCASE("non-existent layer returns EMPTY_TILE") {
        CHECK_EQ(sys.getTile(E(999), 0, 0), EMPTY_TILE);
    }
}

TEST_CASE("tilemap_fill_rect") {
    TilemapSystem sys;
    sys.initLayer(E(0), 10, 8, 32.0f, 32.0f);

    SUBCASE("fill 3x2 region") {
        sys.fillRect(E(0), 2, 1, 3, 2, 5);
        CHECK_EQ(sys.getTile(E(0), 2, 1), 5);
        CHECK_EQ(sys.getTile(E(0), 3, 1), 5);
        CHECK_EQ(sys.getTile(E(0), 4, 1), 5);
        CHECK_EQ(sys.getTile(E(0), 2, 2), 5);
        CHECK_EQ(sys.getTile(E(0), 3, 2), 5);
        CHECK_EQ(sys.getTile(E(0), 4, 2), 5);
        CHECK_EQ(sys.getTile(E(0), 1, 1), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 5, 1), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 2, 0), EMPTY_TILE);
        CHECK_EQ(sys.getTile(E(0), 2, 3), EMPTY_TILE);
    }

    SUBCASE("fill clamps to bounds") {
        sys.fillRect(E(0), 8, 6, 5, 5, 7);
        CHECK_EQ(sys.getTile(E(0), 8, 6), 7);
        CHECK_EQ(sys.getTile(E(0), 9, 7), 7);
        CHECK_EQ(sys.getTile(E(0), 9, 6), 7);
        CHECK_EQ(sys.getTile(E(0), 8, 7), 7);
    }
}

TEST_CASE("tilemap_set_tiles_bulk") {
    TilemapSystem sys;
    sys.initLayer(E(0), 4, 3, 32.0f, 32.0f);

    std::vector<u16> tiles = {
        1, 2, 3, 4,
        5, 0, 0, 8,
        9, 10, 11, 12
    };

    sys.setTiles(E(0), tiles.data(), static_cast<u32>(tiles.size()));

    CHECK_EQ(sys.getTile(E(0), 0, 0), 1);
    CHECK_EQ(sys.getTile(E(0), 3, 0), 4);
    CHECK_EQ(sys.getTile(E(0), 1, 1), EMPTY_TILE);
    CHECK_EQ(sys.getTile(E(0), 3, 1), 8);
    CHECK_EQ(sys.getTile(E(0), 0, 2), 9);
    CHECK_EQ(sys.getTile(E(0), 3, 2), 12);
}

TEST_CASE("tilemap_set_tiles_partial") {
    TilemapSystem sys;
    sys.initLayer(E(0), 4, 3, 32.0f, 32.0f);

    std::vector<u16> partial = {1, 2, 3};
    sys.setTiles(E(0), partial.data(), static_cast<u32>(partial.size()));

    CHECK_EQ(sys.getTile(E(0), 0, 0), 1);
    CHECK_EQ(sys.getTile(E(0), 1, 0), 2);
    CHECK_EQ(sys.getTile(E(0), 2, 0), 3);
    CHECK_EQ(sys.getTile(E(0), 3, 0), EMPTY_TILE);
}

TEST_CASE("tilemap_compute_visible_range") {
    // Map: 20x15 tiles, 32x32 px each, origin at (0,0)
    // Map covers world (0,0) to (640,480)
    constexpr f32 TW = 32.0f;
    constexpr f32 TH = 32.0f;
    constexpr u32 MW = 20;
    constexpr u32 MH = 15;

    SUBCASE("camera covers full map") {
        auto r = computeVisibleRange(-100, -100, 800, 600,
                                     0, 0, TW, TH, MW, MH);
        CHECK_EQ(r.min_x, 0);
        CHECK_EQ(r.min_y, 0);
        CHECK_EQ(r.max_x, 20);
        CHECK_EQ(r.max_y, 15);
        CHECK_FALSE(r.empty());
    }

    SUBCASE("camera partially overlaps") {
        // Camera from (64,96) to (256,288) -> tiles (2,3) to (8,9)
        auto r = computeVisibleRange(64, 96, 256, 288,
                                     0, 0, TW, TH, MW, MH);
        CHECK_EQ(r.min_x, 2);
        CHECK_EQ(r.min_y, 3);
        CHECK_EQ(r.max_x, 8);
        CHECK_EQ(r.max_y, 9);
    }

    SUBCASE("camera fully outside map returns empty") {
        auto r = computeVisibleRange(700, 500, 900, 700,
                                     0, 0, TW, TH, MW, MH);
        CHECK(r.empty());
    }

    SUBCASE("camera with origin offset") {
        // Origin at (100, 200), camera at (100,200)-(228,328)
        // World (100,200) = tile (0,0), world (228,328) = tile (4,4)
        auto r = computeVisibleRange(100, 200, 228, 328,
                                     100, 200, TW, TH, MW, MH);
        CHECK_EQ(r.min_x, 0);
        CHECK_EQ(r.min_y, 0);
        CHECK_EQ(r.max_x, 4);
        CHECK_EQ(r.max_y, 4);
    }

    SUBCASE("fractional tile alignment") {
        // Camera from (16,16) to (80,80) -> covers tiles 0..2 in both axes
        auto r = computeVisibleRange(16, 16, 80, 80,
                                     0, 0, TW, TH, MW, MH);
        CHECK_EQ(r.min_x, 0);
        CHECK_EQ(r.min_y, 0);
        CHECK_EQ(r.max_x, 3);
        CHECK_EQ(r.max_y, 3);
    }
}

TEST_CASE("tilemap_tile_flip_uv") {
    // Screen corners as normalized (s,t): BL(0,0) BR(1,0) TR(1,1) TL(0,1).
    // applyTileFlip maps them to the texture coord to sample. Verify each of the
    // 8 Tiled orientations — diagonal (transpose) applied before H and V.
    auto uv = [](float s, float t, bool h, bool v, bool d) {
        applyTileFlip(s, t, h, v, d);
        return std::pair<float, float>{s, t};
    };
    using P = std::pair<float, float>;

    SUBCASE("identity") {
        CHECK(uv(0,0, false,false,false) == P{0,0});
        CHECK(uv(1,0, false,false,false) == P{1,0});
        CHECK(uv(1,1, false,false,false) == P{1,1});
        CHECK(uv(0,1, false,false,false) == P{0,1});
    }
    SUBCASE("flipH mirrors horizontally") {
        CHECK(uv(0,0, true,false,false) == P{1,0});
        CHECK(uv(1,0, true,false,false) == P{0,0});
        CHECK(uv(1,1, true,false,false) == P{0,1});
        CHECK(uv(0,1, true,false,false) == P{1,1});
    }
    SUBCASE("flipV mirrors vertically") {
        CHECK(uv(0,0, false,true,false) == P{0,1});
        CHECK(uv(1,1, false,true,false) == P{1,0});
    }
    SUBCASE("flipD transposes (BR<->TL texels)") {
        CHECK(uv(0,0, false,false,true) == P{0,0});
        CHECK(uv(1,0, false,false,true) == P{0,1});
        CHECK(uv(1,1, false,false,true) == P{1,1});
        CHECK(uv(0,1, false,false,true) == P{1,0});
    }
    SUBCASE("90 CW = flipH|flipD") {
        // top texture edge (texTL/texTR) must land on the screen's right edge.
        CHECK(uv(0,0, true,false,true) == P{1,0});  // BL -> texBR
        CHECK(uv(1,0, true,false,true) == P{1,1});  // BR -> texTR
        CHECK(uv(1,1, true,false,true) == P{0,1});  // TR -> texTL
        CHECK(uv(0,1, true,false,true) == P{0,0});  // TL -> texBL
    }
    SUBCASE("270 CW = flipV|flipD") {
        CHECK(uv(0,0, false,true,true) == P{0,1});  // BL -> texTL
        CHECK(uv(1,0, false,true,true) == P{0,0});  // BR -> texBL
        CHECK(uv(1,1, false,true,true) == P{1,0});  // TR -> texBR
        CHECK(uv(0,1, false,true,true) == P{1,1});  // TL -> texTR
    }
    SUBCASE("180 = flipH|flipV (point reflection)") {
        CHECK(uv(0,0, true,true,false) == P{1,1});
        CHECK(uv(1,1, true,true,false) == P{0,0});
    }
}

TEST_CASE("tilemap_resolve_tileset_slot") {
    // A tile id resolves to the slot with the largest first_id <= id. Slots are
    // sorted ascending; -1 means no owning tileset.
    SUBCASE("empty table") {
        std::vector<TilesetSlot> slots;
        CHECK_EQ(resolveTilesetSlot(slots, 1), -1);
    }
    SUBCASE("single tileset starting at 1") {
        std::vector<TilesetSlot> slots{ {1, 100, 4} };
        CHECK_EQ(resolveTilesetSlot(slots, 1), 0);
        CHECK_EQ(resolveTilesetSlot(slots, 4), 0);
        CHECK_EQ(resolveTilesetSlot(slots, 9999), 0);
    }
    SUBCASE("two tilesets — pick by first_id range") {
        std::vector<TilesetSlot> slots{ {1, 100, 4}, {5, 200, 8} };
        CHECK_EQ(resolveTilesetSlot(slots, 1), 0);
        CHECK_EQ(resolveTilesetSlot(slots, 4), 0);
        CHECK_EQ(resolveTilesetSlot(slots, 5), 1);   // firstgid boundary of tileset 2
        CHECK_EQ(resolveTilesetSlot(slots, 12), 1);
    }
    SUBCASE("three tilesets") {
        std::vector<TilesetSlot> slots{ {1, 1, 4}, {5, 2, 4}, {9, 3, 4} };
        CHECK_EQ(resolveTilesetSlot(slots, 7), 1);
        CHECK_EQ(resolveTilesetSlot(slots, 9), 2);
        CHECK_EQ(resolveTilesetSlot(slots, 20), 2);
    }
}

TEST_CASE("tilemap_hex_tile_to_world") {
    TilemapSystem sys;
    sys.initLayer(E(0), 4, 4, 16.0f, 16.0f);
    sys.setGridType(E(0), GridType::Hexagonal);
    sys.setHexParams(E(0), 8.0f, /*staggerAxisX=*/false, /*staggerIndexEven=*/false);

    f32 x = 0, y = 0;

    SUBCASE("stagger axis y, index odd: rows advance by (th+side)/2, odd rows shift half a tile") {
        sys.tileToWorld(E(0), 0, 0, 0, 0, x, y);
        CHECK_EQ(x, doctest::Approx(0.0f));
        CHECK_EQ(y, doctest::Approx(0.0f));
        sys.tileToWorld(E(0), 1, 0, 0, 0, x, y);
        CHECK_EQ(x, doctest::Approx(16.0f));
        sys.tileToWorld(E(0), 0, 1, 0, 0, x, y);        // odd row: staggered
        CHECK_EQ(x, doctest::Approx(8.0f));
        CHECK_EQ(y, doctest::Approx(-12.0f));           // rowHeight = (16+8)/2
        sys.tileToWorld(E(0), 0, 2, 0, 0, x, y);        // even row: no shift
        CHECK_EQ(x, doctest::Approx(0.0f));
        CHECK_EQ(y, doctest::Approx(-24.0f));
    }

    SUBCASE("stagger index even flips which rows shift") {
        sys.setHexParams(E(0), 8.0f, false, /*staggerIndexEven=*/true);
        sys.tileToWorld(E(0), 0, 0, 0, 0, x, y);        // even row: staggered now
        CHECK_EQ(x, doctest::Approx(8.0f));
        sys.tileToWorld(E(0), 0, 1, 0, 0, x, y);
        CHECK_EQ(x, doctest::Approx(0.0f));
    }

    SUBCASE("stagger axis x: columns advance by (tw+side)/2, odd columns shift down") {
        sys.setHexParams(E(0), 8.0f, /*staggerAxisX=*/true, false);
        sys.tileToWorld(E(0), 1, 0, 0, 0, x, y);        // odd column: staggered
        CHECK_EQ(x, doctest::Approx(12.0f));            // colWidth = (16+8)/2
        CHECK_EQ(y, doctest::Approx(-8.0f));
        sys.tileToWorld(E(0), 2, 0, 0, 0, x, y);
        CHECK_EQ(x, doctest::Approx(24.0f));
        CHECK_EQ(y, doctest::Approx(0.0f));
    }

    SUBCASE("zero side length falls back to a regular hex (side = th/2)") {
        sys.setHexParams(E(0), 0.0f, false, false);
        sys.tileToWorld(E(0), 0, 1, 0, 0, x, y);
        CHECK_EQ(y, doctest::Approx(-12.0f));           // (16+8)/2 with side=8 fallback
    }

    SUBCASE("worldToTile inverts the cell for on-grid points") {
        i32 tx = -1, ty = -1;
        sys.worldToTile(E(0), 8.0f + 4.0f, -12.0f - 4.0f, 0, 0, tx, ty);  // inside (0,1)
        CHECK_EQ(tx, 0);
        CHECK_EQ(ty, 1);
        sys.worldToTile(E(0), 4.0f, -4.0f, 0, 0, tx, ty);                 // inside (0,0)
        CHECK_EQ(tx, 0);
        CHECK_EQ(ty, 0);
    }
}

TEST_CASE("tilemap_iso_world_to_tile") {
    // Isometric tiles are center-anchored, so recovering the containing tile is
    // round-to-nearest. floor split each diamond at its center and mis-attributed
    // the upper half to the (tx-1, ty-1) neighbor. tw = th = 16, so tile (2,3)'s
    // center is ((2-3)*8, -(2+3)*8) = (-8, -40).
    TilemapSystem sys;
    sys.initLayer(E(0), 8, 8, 16.0f, 16.0f);
    sys.setGridType(E(0), GridType::Isometric);

    i32 tx = -1, ty = -1;

    SUBCASE("exact tile center round-trips") {
        f32 cx = 0, cy = 0;
        sys.tileToWorld(E(0), 2, 3, 0, 0, cx, cy);
        CHECK_EQ(cx, doctest::Approx(-8.0f));
        CHECK_EQ(cy, doctest::Approx(-40.0f));
        sys.worldToTile(E(0), cx, cy, 0, 0, tx, ty);
        CHECK_EQ(tx, 2);
        CHECK_EQ(ty, 3);
    }

    SUBCASE("upper half of a diamond stays in its own tile (floor regressed here)") {
        // 4px above the center is still inside (2,3)'s diamond; floor returned (1,2).
        sys.worldToTile(E(0), -8.0f, -36.0f, 0, 0, tx, ty);
        CHECK_EQ(tx, 2);
        CHECK_EQ(ty, 3);
    }

    SUBCASE("lower half of a diamond stays in its own tile") {
        sys.worldToTile(E(0), -8.0f, -44.0f, 0, 0, tx, ty);
        CHECK_EQ(tx, 2);
        CHECK_EQ(ty, 3);
    }
}

TEST_CASE("tilemap_animation_revision_separation") {
    // The render cache must distinguish a TABLE change (a tile GAINS an animation
    // → every chunk re-evaluates once, so an all-static chunk can become animated)
    // from a per-frame FLIP (only already-animated chunks rebuild). A single
    // conflated revision let a static chunk miss a tile that just became animated.
    TilemapSystem sys;
    sys.initLayer(E(0), 8, 8, 32.0f, 32.0f);

    REQUIRE(sys.getLayerData(E(0)) != nullptr);
    CHECK(sys.getLayerData(E(0))->anim_table_revision == 0);
    CHECK(sys.getLayerData(E(0))->anim_revision == 0);

    // Adding an animation is a TABLE change: anim_table_revision bumps, anim_revision does not.
    AnimFrame frames[2] = {{10, 100}, {11, 100}};  // two 100ms frames
    sys.setTileAnimation(E(0), 10, frames, 2);
    CHECK(sys.getLayerData(E(0))->anim_table_revision == 1);
    CHECK(sys.getLayerData(E(0))->anim_revision == 0);

    // Advancing past a frame boundary is a FLIP: anim_revision bumps, the table revision holds.
    sys.advanceAnimations(E(0), 150.0f);  // crosses the 100ms boundary → frame 0→1
    CHECK(sys.getLayerData(E(0))->anim_revision == 1);
    CHECK(sys.getLayerData(E(0))->anim_table_revision == 1);

    // A tileset swap clears the whole table (setTileAnimation only inserts): the
    // animations go away and it's a TABLE change so chunks re-evaluate to static.
    sys.clearTileAnimations(E(0));
    CHECK(sys.getLayerData(E(0))->tile_animations.empty());
    CHECK(sys.getLayerData(E(0))->anim_table_revision == 2);
    CHECK(sys.resolveAnimatedTile(E(0), 10) == 10); // no longer remapped to a frame
    // Clearing an already-empty table is a no-op (no spurious revision bump).
    sys.clearTileAnimations(E(0));
    CHECK(sys.getLayerData(E(0))->anim_table_revision == 2);
}

TEST_CASE("tileset_atlas_cells") {
    using esengine::tilemap::atlasCells;

    // A gapless atlas: exactly the cells that fit, and a partial one does not count.
    CHECK(atlasCells(64.0f, 0.0f, 32.0f, 0.0f) == 2);
    CHECK(atlasCells(80.0f, 0.0f, 32.0f, 0.0f) == 2);

    // A Tiled margin borders BOTH sides: three 32px tiles with 2px gaps inside a
    // 4px border need 4+96+4+4 = 108. At 104 only two fit — counting the margin
    // once says three and hands that third cell the border pixels.
    CHECK(atlasCells(108.0f, 4.0f, 32.0f, 2.0f) == 3);
    CHECK(atlasCells(104.0f, 4.0f, 32.0f, 2.0f) == 2);

    // The tileset shipped with the spacing gate, whose own JSON says 2 columns:
    // 4 + 16 + 8 + 16 + 4 is exactly its 48px atlas.
    CHECK(atlasCells(48.0f, 4.0f, 16.0f, 8.0f) == 2);

    // Degenerate inputs answer "no cells" rather than converting an out-of-range
    // float: a margin wider than the image, and a tile with no size.
    CHECK(atlasCells(16.0f, 4096.0f, 32.0f, 0.0f) == 0);
    CHECK(atlasCells(64.0f, 0.0f, 0.0f, 0.0f) == 0);
}


// A saved map outlives the binary that wrote it, and the ABI layout hash pairs a
// binary with a bundle only. The header is where that gap is closed.
TEST_CASE("tilemap_blob_header") {
    SUBCASE("what it writes, it reads back") {
        std::vector<u8> raw;
        appendBlobHeader(raw, 7);
        CHECK(raw.size() == BLOB_HEADER_V2_BYTES);

        BlobHeader header{};
        REQUIRE(parseBlobHeader(raw.data(), raw.size(), header));
        CHECK(header.chunkCount == 7);
        CHECK(header.payloadAt == BLOB_HEADER_V2_BYTES);
        CHECK(header.wrote == runningEncoding());
    }

    SUBCASE("the older magic means the encoding it was written under") {
        std::vector<u8> raw(BLOB_HEADER_V1_BYTES);
        const u32 count = 3;
        std::memcpy(raw.data(), &BLOB_MAGIC_V1, sizeof(u32));
        std::memcpy(raw.data() + sizeof(u32), &count, sizeof(count));

        BlobHeader header{};
        REQUIRE(parseBlobHeader(raw.data(), raw.size(), header));
        CHECK(header.chunkCount == 3);
        CHECK(header.payloadAt == BLOB_HEADER_V1_BYTES);
        CHECK(header.wrote == v1Encoding());
    }

    SUBCASE("a blob that is not one of ours, and one that stops mid-header") {
        std::vector<u8> raw;
        appendBlobHeader(raw, 1);
        const u32 alien = 0x12345678;
        std::memcpy(raw.data(), &alien, sizeof(alien));
        BlobHeader header{};
        CHECK_FALSE(parseBlobHeader(raw.data(), raw.size(), header));

        std::vector<u8> cut;
        appendBlobHeader(cut, 1);
        cut.resize(BLOB_HEADER_V2_BYTES - 2);
        CHECK_FALSE(parseBlobHeader(cut.data(), cut.size(), header));
    }
}

// A map outlives the binary that wrote it, and a MINOR has to open what an
// older one saved. The header says what the cells mean, so they are TRANSLATED
// rather than refused — the bits move, the tile and its flags do not.
TEST_CASE("tilemap_cell_migration") {
    const CellEncoding here = runningEncoding();

    SUBCASE("flags written in other bits come back in these") {
        const CellEncoding permuted{ 16, 0x1FFF, 0x8000, 0x2000, 0x4000 };
        u16 out = 0;
        REQUIRE(recodeCell(static_cast<u16>(9 | 0x8000), permuted, here, out));
        CHECK(out == static_cast<u16>(9 | TILE_FLIP_H));
        REQUIRE(recodeCell(static_cast<u16>(9 | 0x2000), permuted, here, out));
        CHECK(out == static_cast<u16>(9 | TILE_FLIP_V));
        REQUIRE(recodeCell(static_cast<u16>(9 | 0x8000 | 0x2000 | 0x4000), permuted, here, out));
        CHECK(out == static_cast<u16>(9 | TILE_FLIP_H | TILE_FLIP_V | TILE_FLIP_D));
    }

    SUBCASE("an identity migration leaves every cell alone") {
        u16 out = 0;
        const u16 cell = static_cast<u16>(TILE_ID_MASK | TILE_FLIP_V);
        REQUIRE(recodeCell(cell, here, here, out));
        CHECK(out == cell);
    }

    // The one thing a migration cannot do: putting SOME other tile there is the
    // failure the header exists to stop.
    SUBCASE("a tile with no room in this mask is refused, not truncated") {
        const CellEncoding wider{ 16, 0x3FFF, 0x4000, 0x8000, 0x0000 };
        u16 out = 0;
        CHECK_FALSE(recodeCell(0x2001, wider, here, out));
        CHECK(recodeCell(0x0FFF, wider, here, out));
    }
}

// A stride is not a contract about the world: cells are walked by the position
// they occupy, so a map saved at one chunk size reads back at another.
TEST_CASE("tilemap_blob_walk") {
    const u32 side = 32;
    const usize per = sizeof(i32) * 2 + static_cast<usize>(side) * side * sizeof(u16);
    std::vector<u8> raw(BLOB_HEADER_V2_BYTES + per, 0);
    const u32 magic = BLOB_MAGIC_V2;
    const u16 fields[6] = { static_cast<u16>(side), TILE_ID_MASK,
                            TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D, 0 };
    const u32 count = 1;
    std::memcpy(raw.data(), &magic, sizeof(magic));
    std::memcpy(raw.data() + sizeof(u32), fields, sizeof(fields));
    std::memcpy(raw.data() + BLOB_HEADER_V2_BYTES - sizeof(u32), &count, sizeof(count));

    const i32 cx = -1, cy = 2;
    u8* chunk = raw.data() + BLOB_HEADER_V2_BYTES;
    std::memcpy(chunk, &cx, sizeof(cx));
    std::memcpy(chunk + sizeof(i32), &cy, sizeof(cy));
    const u16 corner = 3;
    const u16 far = static_cast<u16>(4 | TILE_FLIP_D);
    std::memcpy(chunk + sizeof(i32) * 2, &corner, sizeof(corner));                       // local (0,0)
    std::memcpy(chunk + sizeof(i32) * 2 + (31 * side + 31) * sizeof(u16), &far, sizeof(far));

    BlobHeader header{};
    REQUIRE(parseBlobHeader(raw.data(), raw.size(), header));
    CHECK(header.wrote.chunkSize == side);

    std::vector<std::tuple<i32, i32, u16>> seen;
    REQUIRE(walkBlobCells(raw.data(), raw.size(), header,
        [&](i32 x, i32 y, u16 w) { seen.emplace_back(x, y, w); }));
    REQUIRE(seen.size() == 2);
    // World, not local: the chunk left of the origin starts at -32.
    CHECK(std::get<0>(seen[0]) == -32);
    CHECK(std::get<1>(seen[0]) == 64);
    CHECK(std::get<2>(seen[0]) == corner);
    CHECK(std::get<0>(seen[1]) == -1);
    CHECK(std::get<1>(seen[1]) == 95);
    CHECK(std::get<2>(seen[1]) == far);

    SUBCASE("and a payload that stops short is refused rather than read past") {
        std::vector<u8> cut(raw.begin(), raw.end() - 4);
        CHECK_FALSE(walkBlobCells(cut.data(), cut.size(), header, [](i32, i32, u16) {}));
    }
}

TEST_CASE("tilemap_chunk_floor") {
    // A chunk left of the origin belongs to -1, not to 0: rounding toward zero
    // puts two different columns in one chunk and loses one of them.
    CHECK(floorDiv(-1, 16) == -1);
    CHECK(floorDiv(-16, 16) == -1);
    CHECK(floorDiv(-17, 16) == -2);
    CHECK(floorMod(-1, 16) == 15);
    CHECK(floorMod(-16, 16) == 0);
}
