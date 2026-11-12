// Native CTest harness for the CPU half of tiled forward lighting: which screen tiles a light's sphere can reach.
//
// What a wrong answer costs is invisible in a passing frame and plain in a failing one — a light that misses a tile it reaches is a
// hard-edged hole in the lighting, and one that marks every tile is a frame that pays for lights nobody sees. So the numbers
// here are pinned: the tile a light sits in, how many a big one covers, that one behind the eye marks them all, that one off the
// screen marks none, and that the bit lands in the word it should.

#include "esengine/renderer/store/LightStore.hpp"
#include "esengine/renderer/store/TiledLights.hpp"

#include <glm/gtc/matrix_transform.hpp>

#include <cstdio>
#include <cstring>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

constexpr u32 kTiles = TILE_COLUMNS * TILE_ROWS;

u32 tilesWithBit(u32 (*masks)[4], u32 index) {
    u32 n = 0;
    for (u32 t = 0; t < kTiles; ++t) {
        if (masks[t][index >> 5] & (1u << (index & 31u))) ++n;
    }
    return n;
}

bool hasBit(u32 (*masks)[4], u32 tile, u32 index) { return (masks[tile][index >> 5] & (1u << (index & 31u))) != 0; }

/// A camera at the origin looking down -Z, 60 degrees, square picture.
glm::mat4 camera() {
    return glm::perspective(glm::radians(60.0f), 1.0f, 0.1f, 1000.0f);
}

}  // namespace

int main() {
    static u32 masks[kTiles][4];
    const glm::mat4 vp = camera();

    // --- a small light straight ahead lights the tile at the centre, and only the tiles around it
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -50.0f), 1.0f, 0, masks);
        const u32 centreX = TILE_COLUMNS / 2, centreY = TILE_ROWS / 2;
        CHECK(hasBit(masks, centreY * TILE_COLUMNS + centreX, 0) || hasBit(masks, (centreY - 1) * TILE_COLUMNS + centreX - 1, 0),
              "a light straight ahead marks a tile at the middle of the picture");
        CHECK(tilesWithBit(masks, 0) <= 4, "and, being small and far, no more than four tiles");
        CHECK(!hasBit(masks, 0, 0) && !hasBit(masks, kTiles - 1, 0), "none of the corners");
    }

    // --- a light's bit lands in its own word
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -50.0f), 1.0f, 70, masks);
        bool wordOk = true;
        for (u32 t = 0; t < kTiles; ++t) {
            if (masks[t][0] != 0 || masks[t][1] != 0 || masks[t][3] != 0) wordOk = false;
        }
        CHECK(wordOk && tilesWithBit(masks, 70) > 0, "light 70 sets bit 6 of word 2 and nothing in the other words");
    }

    // --- a big light covers a lot of the picture, and a bigger one all of it
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -30.0f), 9.0f, 0, masks);
        const u32 wide = tilesWithBit(masks, 0);
        CHECK(wide > kTiles / 4 && wide < kTiles, "a light that spans much of the picture marks much of it, not all");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, -20.0f), 200.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == kTiles, "a light that covers the whole picture marks every tile");
    }

    // --- off the screen: none; behind or around the eye: all
    {
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(500.0f, 0.0f, -50.0f), 1.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == 0, "a light far to the side of the view marks no tile");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, 20.0f), 1.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == kTiles, "a light behind the camera marks every tile, since where it lands is not known");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(vp, glm::vec3(0.0f, 0.0f, 0.0f), 5.0f, 0, masks);
        CHECK(tilesWithBit(masks, 0) == kTiles, "and so does one that straddles the camera plane");
    }

    // --- the grid is in normalized device coordinates: the bottom-left of the picture is tile 0, y up
    {
        std::memset(masks, 0, sizeof(masks));
        // Down and to the left of the centre.
        markLightTiles(vp, glm::vec3(-20.0f, -20.0f, -50.0f), 1.0f, 0, masks);
        bool lowLeft = false;
        for (u32 y = 0; y < TILE_ROWS / 2; ++y) {
            for (u32 x = 0; x < TILE_COLUMNS / 2; ++x) lowLeft |= hasBit(masks, y * TILE_COLUMNS + x, 0);
        }
        CHECK(lowLeft && tilesWithBit(masks, 0) > 0, "a light below and left of the centre marks a tile in the first rows and columns");
        bool upper = false;
        for (u32 y = TILE_ROWS / 2; y < TILE_ROWS; ++y) {
            for (u32 x = 0; x < TILE_COLUMNS; ++x) upper |= hasBit(masks, y * TILE_COLUMNS + x, 0);
        }
        CHECK(!upper, "and none in the upper half: rows count up from the bottom");
    }

    // --- an orthographic camera (every 2D game) maps the same way
    {
        std::memset(masks, 0, sizeof(masks));
        const glm::mat4 ortho = glm::ortho(-100.0f, 100.0f, -100.0f, 100.0f, -10.0f, 10.0f);
        markLightTiles(ortho, glm::vec3(0.0f, 0.0f, 0.0f), 5.0f, 3, masks);
        const u32 n = tilesWithBit(masks, 3);
        CHECK(n >= 1 && n <= 4, "an orthographic light at the centre marks the tiles at the centre");
        std::memset(masks, 0, sizeof(masks));
        markLightTiles(ortho, glm::vec3(0.0f, 0.0f, 0.0f), 500.0f, 3, masks);
        CHECK(tilesWithBit(masks, 3) == kTiles, "and one bigger than the view marks them all");
    }

    // --- the store carries what the tiles name, up to its cap, across view changes
    {
        LightStore store;
        store.clear();
        GpuLight light;
        light.posDir = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
        light.shadow.z = -50.0f;
        light.color = glm::vec4(1.0f, 0.0f, 0.0f, 2.0f);
        for (u32 i = 0; i < MAX_TILED_LIGHTS; ++i) {
            if (!store.addTiledLight(light, vp)) { CHECK(false, "a tiled light was refused under the cap"); break; }
        }
        CHECK(store.tiledCount() == MAX_TILED_LIGHTS && store.data().tileInfo.x == static_cast<f32>(MAX_TILED_LIGHTS),
              "the store holds a full set of tiled lights and says how many");
        CHECK(!store.addTiledLight(light, vp), "and refuses the next");
        CHECK(store.data().tileInfo.y == static_cast<f32>(TILE_COLUMNS) && store.data().tileInfo.z == static_cast<f32>(TILE_ROWS),
              "it says the tile grid's size");
        store.setTiledView(vp);
        const auto& centre = store.data().tileMask[(TILE_ROWS / 2) * TILE_COLUMNS + TILE_COLUMNS / 2];
        CHECK(centre.x == 0xffffffffu && centre.y == 0xffffffffu && centre.z == 0xffffffffu && centre.w == 0,
              "reprojection retains all ninety-six light indices across the three mask words");
        CHECK(store.data().tileInfo.x == static_cast<f32>(MAX_TILED_LIGHTS), "another view keeps the full light count");
        store.clear();
        store.setTiledView(vp);
        CHECK(store.tiledCount() == 0 && store.data().tileInfo.x == 0.0f, "a new frame starts with none");
        bool empty = true;
        for (const auto& mask : store.data().tileMask) empty &= mask == glm::uvec4(0u);
        CHECK(empty, "an empty view cannot retain the previous frame's light masks");
    }

    // --- reflected coordinates replace the source grid, which can be restored for the source camera and its post-processing
    {
        LightStore store;
        const glm::mat4 source = glm::ortho(-10.0f, 10.0f, -10.0f, 10.0f, 0.1f, 100.0f);
        const glm::mat4 reflected = source * glm::scale(glm::mat4(1.0f), glm::vec3(-1.0f, 1.0f, 1.0f));
        GpuLight point;
        point.posDir = {-5.0f, -5.0f, 0.0f, 0.25f};
        point.shadow.z = -50.0f;
        point.color = {1.0f, 0.0f, 0.0f, 2.0f};
        GpuLight spot = point;
        spot.posDir = {5.0f, 5.0f, 2.0f, 0.25f};
        spot.spot = {0.0f, 0.0f, 0.9f, 0.5f};
        CHECK(store.addTiledLight(point, source) && store.addTiledLight(spot, source), "point and spot share the view grid");
        const LightConstants original = store.data();
        CHECK((original.tileMask[2 * TILE_COLUMNS + 3].x & 1u) != 0, "the point starts in the lower-left source tiles");
        CHECK((original.tileMask[8 * TILE_COLUMNS + 11].x & 2u) != 0, "the spot starts in the upper-right source tiles");
        store.setTiledView(reflected);
        CHECK((store.data().tileMask[2 * TILE_COLUMNS + 12].x & 1u) != 0, "the point reaches the lower-right reflected tiles");
        CHECK((store.data().tileMask[9 * TILE_COLUMNS + 4].x & 2u) != 0, "the spot reaches the upper-left reflected tiles");
        CHECK((store.data().tileMask[2 * TILE_COLUMNS + 3].x & 1u) == 0, "source tiles are cleared rather than accumulated");
        CHECK(std::memcmp(original.tiledLights, store.data().tiledLights, sizeof(original.tiledLights)) == 0,
              "view changes preserve positions, radii, colours and spot parameters");
        store.setTiledView(source);
        CHECK(std::memcmp(original.tileMask, store.data().tileMask, sizeof(original.tileMask)) == 0,
              "restoring the source view recovers its exact tile masks");
    }

    // --- the loop's own sixteen are marked per tile too, in the fourth word, for the flat lit surfaces
    {
        LightStore store;
        store.clear();
        const glm::mat4 source = glm::ortho(-10.0f, 10.0f, -10.0f, 10.0f, 0.1f, 100.0f);
        const glm::mat4 reflected = source * glm::scale(glm::mat4(1.0f), glm::vec3(-1.0f, 1.0f, 1.0f));
        GpuLight lamp;
        lamp.posDir = {-5.0f, -5.0f, 0.0f, 0.25f};
        lamp.color = {1.0f, 0.0f, 0.0f, 2.0f};
        GpuLight sun;
        sun.posDir = {0.0f, -1.0f, 1.0f, 0.0f};
        sun.color = {1.0f, 1.0f, 1.0f, 1.0f};
        store.addLight(lamp);
        store.addLight(sun);
        CHECK(store.data().tileInfo.w == 0.0f, "until the loop's lights are marked the block says the word is not there");
        store.markLoopLights(source);
        const LightConstants marked = store.data();
        CHECK(marked.tileInfo.w == 1.0f && marked.tileInfo.y == static_cast<f32>(TILE_COLUMNS) && marked.tileInfo.z == static_cast<f32>(TILE_ROWS),
              "marking says the word is there and how big the grid is, with no tiled light in the frame");
        CHECK((marked.tileMask[2 * TILE_COLUMNS + 3].w & 1u) != 0, "the lamp is marked in the lower-left tiles it stands in");
        CHECK((marked.tileMask[8 * TILE_COLUMNS + 11].w & 1u) == 0, "and not across the picture");
        u32 lampTiles = 0;
        bool sunEverywhere = true, othersUntouched = true;
        for (const auto& mask : marked.tileMask) {
            lampTiles += mask.w & 1u;
            sunEverywhere &= (mask.w & 2u) != 0;
            othersUntouched &= mask.x == 0u && mask.y == 0u && mask.z == 0u && (mask.w >> 2) == 0u;
        }
        CHECK(lampTiles > 0 && lampTiles <= 4, "a lamp a quarter of a unit wide is in the few tiles round it");
        CHECK(sunEverywhere, "a directional light is marked in every tile");
        CHECK(othersUntouched, "the tiled lights' three words and the unused bits stay clear");
        CHECK(store.loopTileBits() == lampTiles + kTiles, "and the count of pairs left set is what a gate reads");

        store.setTiledView(reflected);
        CHECK((store.data().tileMask[2 * TILE_COLUMNS + 12].w & 1u) != 0 && (store.data().tileMask[2 * TILE_COLUMNS + 3].w & 1u) == 0,
              "another view moves the lamp's tiles with it");
        store.setTiledView(source);
        CHECK(std::memcmp(marked.tileMask, store.data().tileMask, sizeof(marked.tileMask)) == 0, "and the source view brings them back");

        // A view that lets depth into the picture's x and y cannot say which tile a flat surface's pixel is lit in.
        store.markLoopLights(glm::perspective(glm::radians(60.0f), 1.0f, 0.1f, 100.0f)
                             * glm::lookAt(glm::vec3(0.0f, 0.0f, 20.0f), glm::vec3(0.0f), glm::vec3(0.0f, 1.0f, 0.0f)));
        bool all = true;
        for (const auto& mask : store.data().tileMask) all &= (mask.w & 3u) == 3u;
        CHECK(all && store.loopTileBits() == 2 * kTiles, "through a perspective camera every light is marked everywhere: nothing is skipped");

        store.clear();
        CHECK(store.data().tileInfo.w == 0.0f && store.loopTileBits() == 0, "a new frame starts unmarked");
    }

    CHECK(sizeof(LightConstants) <= 16384, "the whole block fits the 16 KB a uniform block is guaranteed");

    std::printf(g_failures == 0 ? "\nALL PASS\n" : "\n%d FAILURE(S)\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
