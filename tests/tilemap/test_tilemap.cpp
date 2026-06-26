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
