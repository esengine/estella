// Native harness for BitmapFont::createLabelAtlas degenerate dimensions (Audit A5).
//
// createLabelAtlas computed `cols = texWidth / charWidth` and later `% cols`.
// With charWidth==0 (or texWidth<charWidth making cols==0) this is an integer
// divide-by-zero -> WASM trap / SIGFPE. ES_ASSERT is stripped in release, so the
// guard must be a runtime check. This harness drives degenerate dims and proves
// they no longer crash.
//
// Note: native ARM returns 0 on integer divide-by-zero (no trap), so this only
// exercises the guard's logic; the real trap is on the WASM target, where
// i32.rem_u/div_u by zero is a spec-mandated trap. Not wired into CMake because
// the BitmapFont TU references ResourceManager; run it standalone:
//   clang++ -std=c++20 -I src -I third_party/glm -Wl,-undefined,dynamic_lookup \
//     tests/text/test_bitmap_font.cpp src/esengine/text/BitmapFont.cpp \
//     src/esengine/core/Log.cpp -o /tmp/test_bf && /tmp/test_bf

#include "esengine/text/BitmapFont.hpp"

#include <cstdio>

int main() {
    using esengine::text::BitmapFont;
    esengine::resource::TextureHandle tex{};  // invalid handle is fine; only stored

    BitmapFont font;
    // charWidth==0 / charHeight==0: would divide by zero on `texWidth / charWidth`.
    font.createLabelAtlas(tex, 0, 0, "ABC", 0, 0);
    // texWidth < charWidth: cols == 0, then `% cols` divides by zero.
    font.createLabelAtlas(tex, 4, 4, "ABC", 8, 8);
    // Valid dimensions still build glyphs.
    font.createLabelAtlas(tex, 64, 16, "ABC", 16, 16);

    std::printf("A5 OK: degenerate atlas dimensions did not divide by zero\n");
    return 0;
}
