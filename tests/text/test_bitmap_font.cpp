// Native harness for BitmapFont::createLabelAtlas degenerate dimensions (Audit A5).
//
// createLabelAtlas computed `cols = texWidth / charWidth` and `glyphIndex % cols`.
// With charWidth==0 (or texWidth<charWidth making cols==0) this is integer
// divide-by-zero. On the WASM target i32.div_u/rem_u by zero is a spec-mandated
// trap; on platforms where it's defined (arm64 returns 0) the OLD code instead
// populated the atlas with garbage glyphs. The fix is observable on BOTH targets:
// after a degenerate call the guard returns early and registers NO glyphs, while
// the old code either traps (WASM) or registers garbage (native). So asserting an
// empty atlas distinguishes fixed-from-unfixed WITHOUT depending on a trap — which
// the earlier "did not crash" version did not.
//
// Not wired into CMake/CTest: the BitmapFont TU references ResourceManager
// (loadFromFntText), which would drag in the whole resource stack. Run standalone:
//   clang++ -std=c++20 -I src -I third_party/glm -Wl,-undefined,dynamic_lookup \
//     tests/text/test_bitmap_font.cpp src/esengine/text/BitmapFont.cpp \
//     src/esengine/core/Log.cpp -o /tmp/test_bf && /tmp/test_bf

#include "esengine/text/BitmapFont.hpp"

#include <cstdio>

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    using esengine::text::BitmapFont;
    esengine::resource::TextureHandle tex{};  // invalid handle is fine; only stored

    // Degenerate dims must register NO glyphs (the guard returns early). Old code
    // would trap on WASM, or register garbage glyphs on arm64 -> getGlyph != null.
    {
        BitmapFont font;
        font.createLabelAtlas(tex, 0, 0, "ABC", 0, 0);   // charWidth == 0
        CHECK(font.getGlyph('A') == nullptr, "charWidth==0 registers no glyphs (guard fired)");
    }
    {
        BitmapFont font;
        font.createLabelAtlas(tex, 4, 4, "ABC", 8, 8);   // texWidth < charWidth -> cols==0
        CHECK(font.getGlyph('A') == nullptr, "texWidth<charWidth registers no glyphs (guard fired)");
    }
    // Valid dims still build glyphs.
    {
        BitmapFont font;
        font.createLabelAtlas(tex, 64, 16, "ABC", 16, 16);
        CHECK(font.getGlyph('A') != nullptr, "valid dims still register glyphs");
    }

    if (g_failures == 0) {
        std::printf("\nALL A5 TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
