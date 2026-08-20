// Native MSVC/CTest harness for the GfxDevice compressed-texture entry.
//
// No GL here — it drives MockGfxDevice to prove (1) the interface shape compiles
// and the mock satisfies the contract, and (2) the capability-gated upload
// decision: compressed when the device supports the format, RGBA8 fallback
// otherwise. This is the exact decision the texture loader makes at runtime.

#include "MockGfxDevice.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

// The choice the asset upload path makes: prefer the compressed upload, fall back
// to an uncompressed RGBA8 upload when the backend can't sample the format.
static TextureHandle uploadTexture(GfxDevice& d, u32 w, u32 h,
                                   GfxCompressedFormat fmt,
                                   const void* compressed, u32 compressedLen,
                                   const void* rgba) {
    TextureDesc desc;
    desc.width = w;
    desc.height = h;
    if (d.supportsCompressedFormat(fmt)) {
        return d.createCompressedTexture(desc, fmt, compressed, compressedLen, 1);
    }
    return d.createTexture(desc, rgba);
}

int main() {
    std::vector<u8> blocks(2048, 0xAB);
    std::vector<u8> rgba(64 * 64 * 4, 0xFF);

    // --- supported: compressed path ---
    {
        MockGfxDevice d;
        d.compressedSupported = true;
        TextureHandle tex = uploadTexture(d, 64, 64, GfxCompressedFormat::ASTC_4x4,
                                          blocks.data(), static_cast<u32>(blocks.size()), rgba.data());
        CHECK(tex != TextureHandle::Invalid, "supported -> creation succeeds");
        CHECK(d.createCompressedTextureCalls == 1, "supported -> routes through device.createCompressedTexture");
        CHECK(d.createTextureCalls == 0, "supported -> no RGBA8 upload");
        CHECK(d.lastCompressedFormat == GfxCompressedFormat::ASTC_4x4, "format forwarded to device");
        CHECK(d.lastCompressedByteLength == blocks.size(), "compressed byte length forwarded");
    }

    // --- unsupported: RGBA8 fallback (old assets keep working) ---
    {
        MockGfxDevice d;
        d.compressedSupported = false;
        TextureHandle tex = uploadTexture(d, 64, 64, GfxCompressedFormat::ASTC_4x4,
                                          blocks.data(), static_cast<u32>(blocks.size()), rgba.data());
        CHECK(tex != TextureHandle::Invalid, "unsupported -> fallback creation succeeds");
        CHECK(d.createCompressedTextureCalls == 0, "unsupported -> no compressed upload");
        CHECK(d.createTextureCalls == 1 && d.lastCreateTextureHadPixels,
              "unsupported -> RGBA8 fallback via device.createTexture");
    }

    // --- core ETC2/EAC baseline routes through the compressed entry ---
    {
        MockGfxDevice d;
        TextureDesc desc;
        desc.width = 32;
        desc.height = 32;
        d.createCompressedTexture(desc, GfxCompressedFormat::ETC2_RGBA8, blocks.data(), 512, 1);
        CHECK(d.createCompressedTextureCalls == 1, "ETC2_RGBA8 routes through device");
        CHECK(d.lastCompressedFormat == GfxCompressedFormat::ETC2_RGBA8, "ETC2 format forwarded");
        CHECK(d.lastCompressedByteLength == 512, "ETC2 byte length forwarded");
    }

    // --- how many mip levels of an image are whole blocks ---
    // The rule a compressed copy obeys at every level, not only the base: 72x72
    // passed a base-only check and its 18x18 third mip was uploaded anyway.
    {
        using esengine::gfxWholeBlockLevels;
        const auto etc2 = GfxCompressedFormat::ETC2_RGBA8;   // 4x4
        const auto astc8 = GfxCompressedFormat::ASTC_8x8;    // 8x8

        CHECK(gfxWholeBlockLevels(etc2, 70, 70, 1) == 0, "70x70 base is not whole blocks");
        CHECK(gfxWholeBlockLevels(etc2, 72, 72, 8) == 2, "72x72 gives 72 and 36, and stops at 18");
        CHECK(gfxWholeBlockLevels(etc2, 512, 512, 10) == 8, "512x512 runs down to 4, not to 1");
        CHECK(gfxWholeBlockLevels(etc2, 64, 64, 1) == 1, "a single level is counted");
        CHECK(gfxWholeBlockLevels(etc2, 64, 64, 0) == 1, "zero levels reads as the base");
        CHECK(gfxWholeBlockLevels(etc2, 4, 4, 4) == 1, "a 4x4 base has exactly one level");
        // The block belongs to the format, not to the number 4: 32x32 runs down to
        // 8 for an 8x8 format where a 4x4 one would keep going to 4.
        CHECK(gfxWholeBlockLevels(astc8, 32, 32, 6) == 3, "ASTC 8x8 stops at 8");
        CHECK(gfxWholeBlockLevels(etc2, 32, 32, 6) == 4, "the same image keeps one more level at 4x4");
        CHECK(gfxWholeBlockLevels(astc8, 68, 68, 4) == 0, "4-aligned is not 8-aligned");
    }

    if (g_failures == 0) {
        std::printf("\nALL COMPRESSED-FORMAT TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
