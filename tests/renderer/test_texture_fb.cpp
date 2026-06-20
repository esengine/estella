// Native MSVC/CTest harness for Texture + Framebuffer (RC5-GfxDevice).
//
// Compiles the CONVERTED Texture.cpp and Framebuffer.cpp against MockGfxDevice.
// Linking proves they no longer touch GL; the asserts confirm create/upload/
// attach/delete all route through GfxDevice.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/Texture.hpp"
#include "esengine/renderer/Framebuffer.hpp"

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
            CHECK(d.texImage2DCalls == 1, "create allocates via device.texImage2D");
            CHECK(d.setTextureParamsCalls == 1, "create sets params via device.setTextureParams");
            CHECK(d.generateMipmapsCalls == 1, "generateMips routes through device.generateMipmaps");
            CHECK(tex->getId() == 100, "texture id is device-assigned");
            tex->bind(2);
            CHECK(d.bindTextureCalls == 1, "bind routes through device.bindTexture");
        }
        CHECK(d.deleteTextureCalls == 1 && d.lastDeletedTexture == 100,
              "destructor routes through device.deleteTexture");
    }

    // --- Texture: pixel upload ---
    {
        MockGfxDevice d;
        std::vector<u8> pixels(2 * 2 * 4, 0xFF);
        auto tex = Texture::create(d, 2, 2, pixels, TextureFormat::RGBA8, /*flipY*/ true);
        CHECK(tex != nullptr, "Texture::create(pixels) returns a texture");
        CHECK(d.texSubImage2DCalls == 1, "pixel upload routes through device.texSubImage2D");
    }

    // --- A2 regression: setDataRaw rejects undersized buffer (no OOB upload) ---
    // Audit A2: ES_ASSERT is stripped in release, so an undersized buffer used to
    // reach texSubImage2D and read past its end. Guard must hold without asserts.
    {
        MockGfxDevice d;
        TextureSpecification spec;
        spec.width = 4; spec.height = 4; spec.format = TextureFormat::RGBA8;  // needs 4*4*4 = 64 bytes
        auto tex = Texture::create(d, spec);
        const int before = d.texSubImage2DCalls;
        std::vector<u8> tooSmall(16, 0xAB);  // 16 < 64
        tex->setDataRaw(tooSmall.data(), static_cast<u32>(tooSmall.size()));
        CHECK(d.texSubImage2DCalls == before, "setDataRaw skips upload for undersized buffer (no OOB read)");
        std::vector<u8> exact(64, 0xAB);
        tex->setDataRaw(exact.data(), static_cast<u32>(exact.size()));
        CHECK(d.texSubImage2DCalls == before + 1, "setDataRaw uploads when size is sufficient");
    }

    // --- create() fails (returns null) when the device can't allocate a texture ---
    // createTexture returns 0 on OOM / lost context; initialize() must surface that
    // instead of returning a "valid" texture wrapping id 0 (which renders as black).
    {
        MockGfxDevice d;
        d.createTextureFails = true;
        TextureSpecification spec;
        spec.width = 8; spec.height = 8; spec.format = TextureFormat::RGBA8;
        auto tex = Texture::create(d, spec);
        CHECK(tex == nullptr, "create returns null when device.createTexture fails");
        CHECK(d.texImage2DCalls == 0, "no upload is attempted after a failed allocation");
    }

    // --- createFromExternalId must NOT delete the externally-owned GL texture ---
    // The external owner frees that id; deleting it here too is a double-free.
    {
        MockGfxDevice d;
        {
            auto tex = Texture::createFromExternalId(d, 42, 8, 8);
            CHECK(tex != nullptr && tex->getId() == 42, "wrapper holds the external id");
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
            CHECK(d.framebufferTexture2DCalls == 2, "both attachments via device.framebufferTexture2D");
            fbo->bind();
            CHECK(d.bindFramebufferCalls >= 1, "bind routes through device.bindFramebuffer");
        }
        CHECK(d.deleteFramebufferCalls == 1, "destructor deletes the framebuffer via device");
        CHECK(d.deleteTextureCalls == 2, "destructor deletes both attachments via device");
    }

    if (g_failures == 0) {
        std::printf("\nALL TEXTURE/FRAMEBUFFER TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
