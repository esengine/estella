// Native MSVC/CTest harness for the texture path cache (ResourceManager).
//
// ResourceManager.cpp against MockGfxDevice — no GL, no engine link. It asserts
// which texture requests avoided an upload, and which are about to cause one.

#include "../renderer/MockGfxDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // --- a revived texture is a hit, an unknown path is a miss ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto handle = rm.registerExternalTexture(7, 4, 4);
        CHECK(handle.isValid(), "an external texture registers");
        rm.registerTextureWithPath(handle, "a.png");

        const auto missing = rm.acquireTextureByPath("nobody.png");
        CHECK(!missing.isValid(), "a path the pool never saw hands back nothing");
        CHECK(rm.getStats().cacheMisses == 1, "and books a miss, because an upload follows it");
        CHECK(rm.getStats().cacheHits == 0, "with no hit to go with it");

        const auto again = rm.acquireTextureByPath("a.png");
        CHECK(again == handle, "a resident path hands back the very same texture");
        CHECK(rm.getStats().cacheHits == 1, "and books the hit — an upload that did not happen");
        CHECK(rm.getStats().cacheMisses == 1, "leaving the miss count where it was");

        rm.shutdown();
    }

    // --- the count is of REQUESTS, so asking twice books twice ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto handle = rm.registerExternalTexture(9, 2, 2);
        rm.registerTextureWithPath(handle, "b.png");
        rm.acquireTextureByPath("b.png");
        rm.acquireTextureByPath("b.png");

        CHECK(rm.getStats().cacheHits == 2, "two requests, two uploads avoided");
        rm.shutdown();
    }

    std::printf(g_failures == 0 ? "\nALL PASS\n" : "\n%d FAILURE(S)\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
