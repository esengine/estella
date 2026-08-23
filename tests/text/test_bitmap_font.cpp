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
#include "esengine/text/BitmapFont.hpp"
#include "esengine/resource/ResourceManager.hpp"

#include <cstdio>

// loadFromFntText is the BitmapFont TU's only tie to the resource stack, and the
// atlas guard under test never calls it. These stubs close the link without
// dragging that stack in.
namespace esengine::resource {
TextureHandle ResourceManager::loadTexture(const std::string&) { return {}; }
Texture* ResourceManager::getTexture(TextureHandle) { return nullptr; }
}  // namespace esengine::resource

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
