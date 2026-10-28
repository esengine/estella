// The range of sprite layers a light reaches rides in GpuLight::shadowMap.y above the tile count, and the shader unpacks it.
// The contract: zero is every layer, the tile count survives the atlas writing it, a range comes back as its layers.
// reaches() below is the shader's decode, line for line.

#include "esengine/renderer/store/LightStore.hpp"

#include <cmath>
#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

/// What lightReachesLayer() in ShaderParser.cpp answers for a light whose shadowMap.y is `lane` and a sprite on `layer` (-1000 = no layer to test).
bool reaches(f32 lane, i32 layer) {
    const f32 surface = layer == -1000 ? 0.0f : static_cast<f32>(layer) + SPRITE_LAYER_BIAS;
    if (lane < LIGHT_TILE_BITS || surface < 0.5f) return true;
    const f32 range = std::floor(lane / LIGHT_TILE_BITS);
    const f32 lo = std::fmod(range, 256.0f) - 128.0f;
    const f32 hi = 127.0f - std::floor(range / 256.0f);
    const f32 l = surface - SPRITE_LAYER_BIAS;
    return l >= lo && l <= hi;
}

f32 laneOf(i32 layerMin, i32 layerMax, u32 tiles = 0) {
    return LIGHT_TILE_BITS * packLightLayerRange(layerMin, layerMax) + static_cast<f32>(tiles);
}

}  // namespace

int main() {
    // --- zero is every layer: a light nobody gave a range is as it always was
    CHECK(packLightLayerRange(-128, 127) == 0.0f, "the default range packs to zero");
    CHECK(reaches(0.0f, 0) && reaches(0.0f, 127) && reaches(0.0f, -128), "zero reaches every layer");
    CHECK(reaches(laneOf(-128, 127, 5), 7), "a light that owns shadow tiles but has no range still reaches every layer");

    // --- a range reaches the layers in it and no others
    {
        const f32 lane = laneOf(-128, 6);
        CHECK(reaches(lane, 6) && reaches(lane, 0) && reaches(lane, -128), "a lamp up to layer 6 reaches layers 6, 0 and -128");
        CHECK(!reaches(lane, 7) && !reaches(lane, 100), "and not the roof on layer 7, nor anything above it");
    }
    {
        const f32 lane = laneOf(3, 5);
        CHECK(!reaches(lane, 2) && reaches(lane, 3) && reaches(lane, 4) && reaches(lane, 5) && !reaches(lane, 6), "a band of layers 3 to 5 takes those and only those");
    }
    CHECK(reaches(laneOf(0, 0), 0) && !reaches(laneOf(0, 0), 1) && !reaches(laneOf(0, 0), -1), "a single layer is a single layer");

    // --- every layer a sprite can be on round-trips through the lane
    {
        bool ok = true;
        for (i32 l = -128; l <= 127; ++l) {
            if (!reaches(laneOf(l, l), l)) ok = false;
            if (l > -128 && reaches(laneOf(l, l), l - 1)) ok = false;
            if (l < 127 && reaches(laneOf(l, l), l + 1)) ok = false;
        }
        CHECK(ok, "a range of one layer reaches that layer and neither neighbour, for every layer there is");
    }

    // --- a surface with no layer to test is lit by every light
    CHECK(reaches(laneOf(0, 0), -1000), "a mesh, a tilemap or a skeleton carries no layer and is lit by a ranged light as it always was");

    // --- out-of-range authoring is clamped, not wrapped
    CHECK(packLightLayerRange(-9999, 9999) == 0.0f, "a range wider than a byte is every layer, not a wrapped one");
    CHECK(reaches(laneOf(500, 500), 127) && !reaches(laneOf(500, 500), 126), "a range above the top clamps to the top layer");

    // --- the lane stays exact in a float: the biggest packed value is below 2^24
    CHECK(laneOf(127, -128, 7) < 16777216.0f, "the largest lane fits a float exactly");

    // --- the atlas names its tiles without disturbing the range
    {
        LightStore store;
        GpuLight light;
        light.shadowMap.y = LIGHT_TILE_BITS * packLightLayerRange(-128, 6);
        store.addLight(light);
        store.setLightShadowTiles(0, 4, 6);
        const f32 lane = store.data().lights[0].shadowMap.y;
        CHECK(std::fmod(lane, LIGHT_TILE_BITS) == 6.0f, "the tile count is the low bits after the atlas writes it");
        CHECK(store.data().lights[0].shadowMap.x == 4.0f, "and the first tile is as named");
        CHECK(reaches(lane, 6) && !reaches(lane, 7), "and the range the light carried above it is still there");
        store.setLightShadowTiles(0, 0, 0);
        CHECK(std::fmod(store.data().lights[0].shadowMap.y, LIGHT_TILE_BITS) == 0.0f && !reaches(store.data().lights[0].shadowMap.y, 7),
              "a light whose map is taken away keeps its range");
    }

    std::printf("%s\n", g_failures == 0 ? "all passed" : "FAILED");
    return g_failures == 0 ? 0 : 1;
}
