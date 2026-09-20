// Which geometry a Sprite emits, and who decided: the texture's metadata or the
// entity using it. Header-only, so no engine link.

#include "esengine/renderer/draw/SpriteDrawResolve.hpp"

#include <cstdio>

using namespace esengine;
using ecs::SpriteDrawMode;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static bool quad(SpriteDrawChoice c) { return !c.tiled && !c.nineSlice; }

int main() {
    // ---- Auto: the inference the component always made -----------------------------
    {
        CHECK(quad(resolveSpriteDraw(SpriteDrawMode::Auto, false, false)),
              "auto with neither draws the plain quad");
        CHECK(resolveSpriteDraw(SpriteDrawMode::Auto, false, true).nineSlice,
              "auto with a slice border 9-slices, as it always did");
        CHECK(resolveSpriteDraw(SpriteDrawMode::Auto, true, false).tiled,
              "auto with a tile size tiles, as it always did");
        // A tileSize is only ever set deliberately, so it outranks metadata the
        // author may not even know the texture carries.
        const SpriteDrawChoice both = resolveSpriteDraw(SpriteDrawMode::Auto, true, true);
        CHECK(both.tiled && !both.nineSlice, "auto prefers the tile size over the border");
    }

    // ---- The author overriding the inference ---------------------------------------
    {
        // The case this exists for: a 9-slice texture drawn whole.
        CHECK(quad(resolveSpriteDraw(SpriteDrawMode::Simple, false, true)),
              "Simple draws a 9-slice texture whole");
        CHECK(quad(resolveSpriteDraw(SpriteDrawMode::Simple, true, true)),
              "Simple overrides a tile size too");
        CHECK(resolveSpriteDraw(SpriteDrawMode::NineSlice, true, true).nineSlice,
              "NineSlice wins over a tile size");
        CHECK(!resolveSpriteDraw(SpriteDrawMode::NineSlice, true, true).tiled,
              "...and does not tile as well");
        CHECK(resolveSpriteDraw(SpriteDrawMode::Tiled, true, true).tiled,
              "Tiled wins over a slice border");
    }

    // ---- An override cannot invent the data it needs --------------------------------
    {
        CHECK(quad(resolveSpriteDraw(SpriteDrawMode::NineSlice, false, false)),
              "NineSlice with no border falls back to the quad");
        CHECK(quad(resolveSpriteDraw(SpriteDrawMode::Tiled, false, false)),
              "Tiled with no tile size falls back to the quad");
    }

    std::printf(g_failures == 0 ? "\nall sprite draw-mode cases hold\n"
                                : "\n%d case(s) failed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
