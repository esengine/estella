// Who owns which square of the shadow texture. A frame sees some of this now —
// point-shadow resolves in two faces of a cube and goes red if every tile reports one
// rect — but only the tiles its own fragments land in. The arithmetic is pinned here.

#include "esengine/renderer/store/ShadowAtlas.hpp"

#include <cstdio>
#include <cmath>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static bool near(f32 a, f32 b) { return std::fabs(a - b) < 1e-6f; }

static bool isTile(const ShadowTile& t, u32 x, u32 y, u32 size) {
    return t.x == x && t.y == y && t.size == size;
}

static bool isRect(const glm::vec4& r, f32 x, f32 y, f32 size) {
    return near(r.x, x) && near(r.y, y) && near(r.z, size);
}

int main() {
    // The frame's own atlas: 2048 handed out in 512 cells, a cascade taking 2x2.
    ShadowAtlas atlas(2048, 512);

    const i32 first = atlas.allocate(4, 2);
    CHECK(first == 0, "the first claim starts at tile 0");
    CHECK(atlas.tileCount() == 4, "four cascades claim four tiles");

    // The order the expression this replaced produced: 0 lower-left, 1 lower-right,
    // 2 upper-left, 3 upper-right. A different order is a different picture, and
    // no pixel gate would say so.
    CHECK(isTile(atlas.tile(0), 0, 0, 1024), "tile 0 is the lower-left quadrant");
    CHECK(isTile(atlas.tile(1), 1024, 0, 1024), "tile 1 is the lower-right quadrant");
    CHECK(isTile(atlas.tile(2), 0, 1024, 1024), "tile 2 is the upper-left quadrant");
    CHECK(isTile(atlas.tile(3), 1024, 1024, 1024), "tile 3 is the upper-right quadrant");

    // What the shader indexes with — the same squares as a fraction of the atlas.
    CHECK(isRect(atlas.unitRect(0), 0.0f, 0.0f, 0.5f), "tile 0's rect is (0, 0, 1/2)");
    CHECK(isRect(atlas.unitRect(1), 0.5f, 0.0f, 0.5f), "tile 1's rect is (1/2, 0, 1/2)");
    CHECK(isRect(atlas.unitRect(2), 0.0f, 0.5f, 0.5f), "tile 2's rect is (0, 1/2, 1/2)");
    CHECK(isRect(atlas.unitRect(3), 0.5f, 0.5f, 0.5f), "tile 3's rect is (1/2, 1/2, 1/2)");

    // A full atlas has nothing left, and says so rather than handing out a square
    // somebody else is already drawing into.
    CHECK(atlas.allocate(1, 2) < 0, "a full atlas refuses the next claim");

    // All or nothing: a caller that gets half a cascade set would leave the rest
    // reading depths that belong to another light.
    ShadowAtlas partial(2048, 512);
    CHECK(partial.allocate(3, 2) == 0, "three of the four fit");
    CHECK(partial.allocate(2, 2) < 0, "two more do not, and the claim is refused");
    CHECK(partial.tileCount() == 3, "a refused claim leaves the atlas as it was");
    CHECK(partial.allocate(1, 2) == 3, "and the one that does fit still can");

    // Tiles need not all be one size — which is the whole reason the rect is data.
    // A spot light taking one cell sits beside a cascade taking four.
    ShadowAtlas mixed(2048, 512);
    CHECK(mixed.allocate(1, 2) == 0, "a 2x2 block lands first");
    const i32 small = mixed.allocate(2, 1);
    CHECK(small == 1, "single cells claim after it");
    CHECK(isTile(mixed.tile(1), 1024, 0, 512), "the first single cell clears the block");
    CHECK(isRect(mixed.unitRect(1), 0.5f, 0.0f, 0.25f), "and reports a quarter-side rect");

    // A point light's cube: six single cells claimed together, contiguous and in the
    // order the faces are rendered — which is what lets a light name a first tile and a
    // count rather than six indices.
    ShadowAtlas cube(2048, 512);
    CHECK(cube.allocate(SHADOW_CUBE_FACES, 1) == 0, "a cube claims its six faces at once");
    CHECK(cube.tileCount() == 6, "and gets all six");
    CHECK(isTile(cube.tile(0), 0, 0, 512), "face 0 takes the first cell");
    CHECK(isTile(cube.tile(5), 512, 512, 512), "face 5 the sixth, the row filled in order");
    // What a sun standing beside it can still have: the cube left a row half used, and a
    // 2x2 block only starts on a multiple of 2 — so the sun loses cascades, not its map.
    CHECK(cube.allocate(4, 2) < 0, "four cascades no longer fit beside a cube");
    CHECK(cube.allocate(2, 2) == 6, "two do, in the rows the cube did not reach");
    CHECK(isTile(cube.tile(6), 0, 1024, 1024), "the first of them clearing the cube's rows");

    // The budget is the shader's array bound, not the texture's room: a 4096 atlas
    // of 512 cells has 64 of them and the block still stops at MAX_SHADOW_TILES.
    ShadowAtlas wide(4096, 512);
    CHECK(wide.allocate(MAX_SHADOW_TILES + 1, 1) < 0, "the tile budget is a hard bound");
    CHECK(wide.allocate(MAX_SHADOW_TILES, 1) == 0, "and exactly the bound fits");

    // A frame gives it all back: a tile means nothing once the depths in it are
    // from a frame that is gone.
    ShadowAtlas reused(2048, 512);
    reused.allocate(4, 2);
    reused.reset();
    CHECK(reused.tileCount() == 0, "reset empties the atlas");
    CHECK(reused.allocate(4, 2) == 0, "and the next frame claims the same squares");
    CHECK(isTile(reused.tile(0), 0, 0, 1024), "starting again at the lower-left");

    // A block larger than the grid has nowhere to go, and a zero-sized claim is not
    // a claim — both answer rather than indexing something that is not there.
    ShadowAtlas small2(1024, 512);
    CHECK(small2.allocate(1, 4) < 0, "a block wider than the atlas is refused");
    CHECK(small2.allocate(0, 2) < 0, "so is a claim for no tiles");
    CHECK(small2.allocate(1, 0) < 0, "so is a claim for empty ones");

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
