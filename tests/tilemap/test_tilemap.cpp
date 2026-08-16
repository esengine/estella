#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/tilemap/TilemapSystem.hpp>
#include <esengine/tilemap/TileFlip.hpp>

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
