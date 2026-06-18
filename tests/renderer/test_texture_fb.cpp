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

// Texture::createFromFile (native-only) references stb's file loader, which the
// engine's stb impl compiles out (STBI_NO_STDIO). We never call createFromFile in
// this harness, so stub the symbols to satisfy the linker without the decoder.
extern "C" {
    unsigned char* stbi_load(char const*, int*, int*, int*, int) { return nullptr; }
    void stbi_image_free(void*) {}
    char const* stbi_failure_reason() { return "stub"; }
}

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
