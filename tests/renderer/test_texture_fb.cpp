// Native MSVC/CTest harness for Texture + Framebuffer (GfxDevice).
//
// Compiles the CONVERTED Texture.cpp and Framebuffer.cpp against MockGfxDevice.
// Linking proves they no longer touch GL; the asserts confirm create/upload/
// attach/delete all route through GfxDevice.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/rhi/Texture.hpp"
#include "esengine/renderer/rhi/Framebuffer.hpp"
#include "esengine/renderer/rhi/PixelUpload.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // --- Texture: empty spec with mips ---
    {
        MockGfxDevice d;
        TextureSpecification spec;
        spec.width = 8; spec.height = 8; spec.format = TextureFormat::RGBA8; spec.generateMips = true;
        {
            auto tex = Texture::create(d, spec);
            CHECK(tex != nullptr, "Texture::create returns a texture");
            CHECK(d.createTextureCalls == 1, "create routes through device.createTexture");
            CHECK(d.lastTextureDesc.width == 8 && d.lastTextureDesc.height == 8,
                  "creation descriptor carries the dimensions");
            CHECK(d.lastTextureDesc.format == GfxPixelFormat::RGBA8,
                  "creation descriptor carries the pixel format");
            CHECK(d.lastTextureDesc.mipmaps, "generateMips is declared in the descriptor");
            CHECK(!d.lastCreateTextureHadPixels, "empty spec allocates without pixel data");
            CHECK(tex->handle() == TextureHandle{100}, "texture handle is device-assigned");
            tex->bind(2);
            CHECK(d.bindTextureCalls == 1, "bind routes through device.bindTexture");
        }
        CHECK(d.deleteTextureCalls == 1 && d.lastDeletedTexture == TextureHandle{100},
              "destructor routes through device.deleteTexture");
    }

    // --- Texture: pixel upload at creation ---
    {
        MockGfxDevice d;
        std::vector<u8> pixels(2 * 2 * 4, 0xFF);
        auto tex = Texture::create(d, 2, 2, pixels, TextureFormat::RGBA8, /*flipY*/ true);
        CHECK(tex != nullptr, "Texture::create(pixels) returns a texture");
        CHECK(d.createTextureCalls == 1 && d.lastCreateTextureHadPixels,
              "pixels are uploaded with the creation call");
        CHECK(d.lastTextureDesc.flipY, "flipY is declared in the creation descriptor");
    }

    // --- A2 regression: setDataRaw rejects undersized buffer (no OOB upload) ---
    // Audit A2: ES_ASSERT is stripped in release, so an undersized buffer used to
    // reach the GPU upload and read past its end. Guard must hold without asserts.
    {
        MockGfxDevice d;
        TextureSpecification spec;
        spec.width = 4; spec.height = 4; spec.format = TextureFormat::RGBA8;  // needs 4*4*4 = 64 bytes
        auto tex = Texture::create(d, spec);
        const int before = d.updateTextureCalls;
        std::vector<u8> tooSmall(16, 0xAB);  // 16 < 64
        tex->setDataRaw(tooSmall.data(), static_cast<u32>(tooSmall.size()));
        CHECK(d.updateTextureCalls == before, "setDataRaw skips upload for undersized buffer (no OOB read)");
        std::vector<u8> exact(64, 0xAB);
        tex->setDataRaw(exact.data(), static_cast<u32>(exact.size()));
        CHECK(d.updateTextureCalls == before + 1, "setDataRaw uploads when size is sufficient");
    }

    // --- create() fails (returns null) when the device can't allocate a texture ---
    // createTexture returns Invalid on OOM / lost context; initialize() must surface
    // that instead of returning a "valid" texture wrapping the null handle.
    {
        MockGfxDevice d;
        d.createTextureFails = true;
        TextureSpecification spec;
        spec.width = 8; spec.height = 8; spec.format = TextureFormat::RGBA8;
        auto tex = Texture::create(d, spec);
        CHECK(tex == nullptr, "create returns null when device.createTexture fails");
    }

    // --- createFromExternalId must NOT delete the externally-owned texture ---
    // The external owner frees that id; deleting it here too is a double-free.
    {
        MockGfxDevice d;
        {
            auto tex = Texture::createFromExternalId(d, 42, 8, 8);
            CHECK(tex != nullptr && tex->handle() == TextureHandle{42}, "wrapper holds the external id");
            CHECK(d.importExternalTextureCalls == 1, "external id is registered with the device");
        }
        CHECK(d.deleteTextureCalls == 0, "destructor does NOT delete an externally-owned texture");
    }

    // --- an engine-owned texture IS still deleted on destruction ---
    {
        MockGfxDevice d;
        TextureSpecification spec;
        spec.width = 4; spec.height = 4; spec.format = TextureFormat::RGBA8;
        { auto tex = Texture::create(d, spec); }
        CHECK(d.deleteTextureCalls == 1, "destructor deletes an engine-owned texture");
    }

    // --- Framebuffer: color + depth-stencil ---
    {
        MockGfxDevice d;
        FramebufferSpec spec;
        spec.width = 64; spec.height = 64; spec.depthStencil = true;
        {
            auto fbo = Framebuffer::create(d, spec);
            CHECK(fbo != nullptr, "Framebuffer::create returns a framebuffer");
            CHECK(d.createFramebufferCalls == 1, "create routes through device.createFramebuffer");
            CHECK(d.createTextureCalls == 2, "color + depth attachments via device.createTexture");
            CHECK(d.lastFramebufferDesc.color0 != TextureHandle::Invalid &&
                  d.lastFramebufferDesc.depthStencil != TextureHandle::Invalid,
                  "both attachments are declared in the framebuffer descriptor");
            fbo->bind();
            CHECK(d.beginRenderPassCalls == 1 && d.lastPassDesc.target == fbo->handle(),
                  "bind begins a render pass targeting the framebuffer");
            fbo->unbind();
            CHECK(d.endRenderPassCalls == 1, "unbind ends the render pass");
        }
        CHECK(d.deleteFramebufferCalls == 1, "destructor deletes the framebuffer via device");
        CHECK(d.deleteTextureCalls == 2, "destructor deletes both attachments via device");
    }

    // --- Upload row arithmetic: reads are sized by the SOURCE format ---
    {
        CHECK(gfxBytesPerPixel(GfxPixelFormat::RGB8) == 3, "RGB8 pixels are 3 source bytes");
        CHECK(gfxBytesPerPixel(GfxPixelFormat::RGBA8) == 4, "RGBA8 pixels are 4 source bytes");
        CHECK(gfxBytesPerPixel(GfxPixelFormat::SRGB8_ALPHA8) == 4, "sRGB8A8 pixels are 4 source bytes");
        CHECK(gfxBytesPerPixel(GfxPixelFormat::RGBA16F) == 8, "RGBA16F pixels are 8 source bytes");

        // Sized to the source EXACTLY: staging that reads a destination-sized row
        // runs off the end here, which is what the sanitizer build is here to catch.
        const u32 w = 3, h = 2;
        std::vector<u8> rgb(static_cast<usize>(w) * h * 3);
        for (usize i = 0; i < rgb.size(); ++i) rgb[i] = static_cast<u8>(i + 1);
        std::vector<u8> out(static_cast<usize>(w) * h * 4, 0);

        stageTextureRows(out.data(), rgb.data(), w, h, 3, 4, /*reverseRows=*/false);
        CHECK(out[0] == 1 && out[1] == 2 && out[2] == 3 && out[3] == 0xFF,
              "RGB8 widens to RGBA8 with opaque alpha");
        CHECK(out[12] == 10 && out[15] == 0xFF, "row 1 starts at the destination stride");

        stageTextureRows(out.data(), rgb.data(), w, h, 3, 4, /*reverseRows=*/true);
        CHECK(out[0] == 10 && out[12] == 1, "reverseRows emits the last source row first");

        std::vector<u8> rgba(static_cast<usize>(w) * h * 4);
        for (usize i = 0; i < rgba.size(); ++i) rgba[i] = static_cast<u8>(i + 1);
        std::vector<u8> same(rgba.size(), 0);
        stageTextureRows(same.data(), rgba.data(), w, h, 4, 4, /*reverseRows=*/true);
        CHECK(same[0] == 13 && same[12] == 1, "equal pixel sizes copy rows verbatim");
    }

    if (g_failures == 0) {
        std::printf("\nALL TEXTURE/FRAMEBUFFER TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
