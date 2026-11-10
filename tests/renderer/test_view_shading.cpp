// What a view's shading mode is: a value the view holds, Shaded for a view that never
// asked, and nothing at all once it goes back. Header-only, so no device is needed — the
// pixel side (clay is neutral, albedo ignores light) is the editor's to look at.

#include "esengine/renderer/frame/ViewShading.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    ViewShading shading;
    CHECK(shading.get(7) == ShadingMode::Shaded, "a view that never asked is drawn as authored");
    CHECK(shading.count() == 0, "an untouched store holds nothing");

    shading.set(7, ShadingMode::Clay);
    shading.set(9, ShadingMode::Wireframe);
    CHECK(shading.get(7) == ShadingMode::Clay, "a view keeps the mode it asked for");
    CHECK(shading.get(9) == ShadingMode::Wireframe, "and another view keeps its own");
    CHECK(shading.get(8) == ShadingMode::Shaded, "a third is unaffected by either");
    CHECK(shading.count() == 2, "two views hold a mode");

    shading.set(7, ShadingMode::Shaded);
    CHECK(shading.get(7) == ShadingMode::Shaded, "asking for the authored look goes back to it");
    CHECK(shading.count() == 1, "and leaves no entry behind, so nothing leaks over a session");

    CHECK(static_cast<u8>(ShadingMode::IndirectLighting) + 1 == kShadingModeCount, "the modes the bindings accept are the ones the enum declares");

    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all view shading checks passed\n");
    return 0;
}
