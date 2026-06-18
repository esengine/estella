// Native MSVC/CTest harness for the GfxDevice compressed-texture entry (RC6-A).
//
// No GL here — it drives MockGfxDevice to prove (1) the interface shape compiles
// and the mock satisfies the contract, and (2) the capability-gated upload
// decision: compressed when the device supports the format, RGBA8 fallback
// otherwise. This is the exact decision TextureLoader will make in Batch C.

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
static void uploadTexture(GfxDevice& d, u32 tex, u32 w, u32 h,
                          GfxCompressedFormat fmt,
                          const void* compressed, u32 compressedLen,
                          const void* rgba) {
    if (d.supportsCompressedFormat(fmt)) {
        d.compressedTexImage2D(tex, w, h, fmt, compressed, compressedLen);
    } else {
        d.texImage2D(tex, w, h, GfxPixelFormat::RGBA8, rgba);
    }
}

int main() {
    std::vector<u8> blocks(2048, 0xAB);
    std::vector<u8> rgba(64 * 64 * 4, 0xFF);

    // --- supported: compressed path ---
    {
        MockGfxDevice d;
        d.compressedSupported = true;
        u32 tex = d.createTexture();
        uploadTexture(d, tex, 64, 64, GfxCompressedFormat::ASTC_4x4,
                      blocks.data(), static_cast<u32>(blocks.size()), rgba.data());
        CHECK(d.compressedTexImage2DCalls == 1, "supported -> routes through device.compressedTexImage2D");
        CHECK(d.texImage2DCalls == 0, "supported -> no RGBA8 upload");
        CHECK(d.lastCompressedFormat == GfxCompressedFormat::ASTC_4x4, "format forwarded to device");
        CHECK(d.lastCompressedByteLength == blocks.size(), "compressed byte length forwarded");
    }

    // --- unsupported: RGBA8 fallback (old assets keep working) ---
    {
        MockGfxDevice d;
        d.compressedSupported = false;
        u32 tex = d.createTexture();
        uploadTexture(d, tex, 64, 64, GfxCompressedFormat::ASTC_4x4,
                      blocks.data(), static_cast<u32>(blocks.size()), rgba.data());
        CHECK(d.compressedTexImage2DCalls == 0, "unsupported -> no compressed upload");
        CHECK(d.texImage2DCalls == 1, "unsupported -> RGBA8 fallback via device.texImage2D");
    }

    // --- core ETC2/EAC baseline routes through the compressed entry ---
    {
        MockGfxDevice d;
        u32 tex = d.createTexture();
        d.compressedTexImage2D(tex, 32, 32, GfxCompressedFormat::ETC2_RGBA8, blocks.data(), 512);
        CHECK(d.compressedTexImage2DCalls == 1, "ETC2_RGBA8 routes through device");
        CHECK(d.lastCompressedFormat == GfxCompressedFormat::ETC2_RGBA8, "ETC2 format forwarded");
        CHECK(d.lastCompressedByteLength == 512, "ETC2 byte length forwarded");
    }

    if (g_failures == 0) {
        std::printf("\nALL COMPRESSED-FORMAT TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
