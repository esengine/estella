// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include "ResourceManagerBindings.hpp"
#include "BoundarySpan.hpp"
#include "../resource/ShaderParser.hpp"
#include "../resource/TextureMetadata.hpp"
#include "../text/BitmapFont.hpp"
#include "../core/Types.hpp"
#include "../core/Log.hpp"

// Not under the emscripten guard below: this TU compiles for native too, and the
// device is what `rm_supportsCompressedFormat` asks — a forward declaration
// reaches its members on neither target.
#include "../renderer/rhi/GfxDevice.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/val.h>
#endif

namespace esengine {

namespace {

/**
 * Pixel uploads crossing the JS boundary are color images (decoded PNGs, spine
 * atlases, glyph atlases, tileset collages) — the same "all image textures are
 * color" contract the SDK's raw-GL upload path applies. Linear mode stores them
 * sRGB-encoded so the sampler linearizes in hardware, on both backends.
 */
TextureFormat boundaryTextureFormat(i32 format) {
    if (format == 0) return TextureFormat::RGB8;
    if (resource::ShaderParser::linearColorSpace()) return TextureFormat::SRGB8A8;
    return TextureFormat::RGBA8;
}

}  // namespace

u32 rm_createTexture(resource::ResourceManager& rm, u32 width, u32 height,
                      uintptr_t pixelsPtr, u32 pixelsLen, i32 format, bool flipY) {
    const u8* pixels = boundarySpan<u8>(pixelsPtr, pixelsLen, "rm_createTexture");
    if (!pixels) return 0;
    ConstSpan<u8> pixelSpan(pixels, pixelsLen);

    auto handle = rm.createTexture(width, height, pixelSpan, boundaryTextureFormat(format), flipY);
    return handle.id();
}

u32 rm_createTextureEx(resource::ResourceManager& rm, u32 width, u32 height,
                        uintptr_t pixelsPtr, u32 pixelsLen, i32 format, bool flipY,
                        i32 filterMode, i32 wrapMode) {
    const u8* pixels = pixelsPtr ? boundarySpan<u8>(pixelsPtr, pixelsLen, "rm_createTextureEx") : nullptr;
    if (pixelsPtr && !pixels) return 0;

    const TextureFormat texFormat = boundaryTextureFormat(format);

    TextureSpecification spec;
    spec.width = width;
    spec.height = height;
    spec.format = texFormat;
    spec.generateMips = false;

    spec.minFilter = (filterMode == 0) ? TextureFilter::Nearest : TextureFilter::Linear;
    spec.magFilter = spec.minFilter;

    switch (wrapMode) {
        case 0: spec.wrapS = TextureWrap::Repeat; spec.wrapT = TextureWrap::Repeat; break;
        case 1: spec.wrapS = TextureWrap::ClampToEdge; spec.wrapT = TextureWrap::ClampToEdge; break;
        case 2: spec.wrapS = TextureWrap::MirroredRepeat; spec.wrapT = TextureWrap::MirroredRepeat; break;
        default: spec.wrapS = TextureWrap::ClampToEdge; spec.wrapT = TextureWrap::ClampToEdge; break;
    }

    auto handle = rm.createTexture(spec);
    if (!handle.isValid()) {
        return 0;
    }

    auto* texture = rm.getTexture(handle);
    if (texture && pixels) {
        const u64 required = static_cast<u64>(width) * height * (texFormat == TextureFormat::RGB8 ? 3 : 4);
        if (pixelsLen < required) {
            ES_LOG_ERROR("rm_createTextureEx: pixel buffer {} < required {}; upload skipped",
                         pixelsLen, required);
        } else {
            texture->setDataRaw(pixels, static_cast<u32>(required), flipY);
        }
    }

    return handle.id();
}

/**
 * Whether the ACTIVE backend can sample this compressed format — the question
 * WebGL extensions answer for one backend only, and answer with "none" for the
 * other, which arrives as a texture that never loaded.
 */
bool rm_supportsCompressedFormat(resource::ResourceManager& rm, i32 format) {
    auto* device = rm.device();
    if (!device) return false;
    if (format < 0 || format > static_cast<i32>(GfxCompressedFormat::S3TC_DXT5_SRGB)) return false;
    return device->supportsCompressedFormat(static_cast<GfxCompressedFormat>(format));
}

/** Uploads pre-transcoded blocks (level 0 first) as one compressed texture. */
u32 rm_createCompressedTexture(resource::ResourceManager& rm, u32 width, u32 height,
                               i32 format, uintptr_t dataPtr, u32 dataLen, u32 mipLevels) {
    if (format < 0 || format > static_cast<i32>(GfxCompressedFormat::S3TC_DXT5_SRGB)) return 0;
    const u8* data = boundarySpan<u8>(dataPtr, dataLen, "rm_createCompressedTexture");
    if (!data) return 0;
    auto handle = rm.createCompressedTexture(width, height,
                                             static_cast<GfxCompressedFormat>(format),
                                             ConstSpan<u8>(data, dataLen),
                                             mipLevels ? mipLevels : 1);
    return handle.id();
}

u32 rm_createShader(resource::ResourceManager& rm,
                     const std::string& vertSrc, const std::string& fragSrc) {
    auto handle = rm.createShader(vertSrc, fragSrc);
    return handle.id();
}

u32 rm_registerExternalTexture(resource::ResourceManager& rm, u32 glTextureId,
                                u32 width, u32 height) {
    auto handle = rm.registerExternalTexture(glTextureId, width, height);
    return handle.id();
}

bool rm_retargetExternalTexture(resource::ResourceManager& rm, u32 handle,
                                u32 glTextureId, u32 width, u32 height) {
    return rm.retargetExternalTexture(resource::TextureHandle(handle), glTextureId, width, height);
}

u32 rm_registerExternalTextureSized(resource::ResourceManager& rm, u32 glTextureId,
                                     u32 width, u32 height, u32 bytes) {
    auto handle = rm.registerExternalTexture(glTextureId, width, height,
                                             static_cast<usize>(bytes));
    return handle.id();
}

void rm_releaseTexture(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseTexture(resource::TextureHandle(handleId));
}

u32 rm_getTextureRefCount(resource::ResourceManager& rm, u32 handleId) {
    return rm.getTextureRefCount(resource::TextureHandle(handleId));
}

void rm_registerTextureWithPath(resource::ResourceManager& rm, u32 handleId, const std::string& path) {
    rm.registerTextureWithPath(resource::TextureHandle(handleId), path);
}

void rm_setTextureBudget(resource::ResourceManager& rm, u32 bytes) {
    rm.setTextureBudget(static_cast<usize>(bytes));
}

u32 rm_acquireTextureByPath(resource::ResourceManager& rm, const std::string& path) {
    return rm.acquireTextureByPath(path).id();
}

bool rm_invalidateTexturePath(resource::ResourceManager& rm, const std::string& path) {
    return rm.invalidateTexturePath(path);
}

u32 rm_trimTextureCache(resource::ResourceManager& rm) {
    return static_cast<u32>(rm.trimTextureCache());
}

#ifdef __EMSCRIPTEN__
emscripten::val rm_getResourceStats(resource::ResourceManager& rm) {
    const auto st = rm.getStats();
    auto result = emscripten::val::object();
    result.set("shaderCount", static_cast<f64>(st.shaderCount));
    result.set("textureCount", static_cast<f64>(st.textureCount));
    result.set("vertexBufferCount", static_cast<f64>(st.vertexBufferCount));
    result.set("indexBufferCount", static_cast<f64>(st.indexBufferCount));
    result.set("cacheHits", static_cast<f64>(st.cacheHits));
    result.set("cacheMisses", static_cast<f64>(st.cacheMisses));
    result.set("textureBytes", static_cast<f64>(st.textureBytes));
    result.set("textureBudget", static_cast<f64>(st.textureBudget));
    result.set("textureEvictableCount", static_cast<f64>(st.textureEvictableCount));
    return result;
}
#endif  // __EMSCRIPTEN__

void rm_releaseShader(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseShader(resource::ShaderHandle(handleId));
}

u32 rm_getShaderRefCount(resource::ResourceManager& rm, u32 handleId) {
    return rm.getShaderRefCount(resource::ShaderHandle(handleId));
}

u32 rm_getTextureGLId(resource::ResourceManager& rm, u32 handleId) {
    auto* tex = rm.getTexture(resource::TextureHandle(handleId));
    return tex ? tex->getId() : 0;
}

#ifdef __EMSCRIPTEN__
emscripten::val rm_getTextureDimensions(resource::ResourceManager& rm, u32 handleId) {
    auto* tex = rm.getTexture(resource::TextureHandle(handleId));
    if (!tex) {
        return emscripten::val::null();
    }
    auto result = emscripten::val::object();
    result.set("width", tex->getWidth());
    result.set("height", tex->getHeight());
    return result;
}
#endif  // __EMSCRIPTEN__

#ifdef ES_ENABLE_BITMAP_TEXT
u32 rm_loadBitmapFont(resource::ResourceManager& rm, const std::string& fntContent,
                       u32 textureHandle, u32 texWidth, u32 texHeight) {
    auto handle = rm.createBitmapFont(fntContent,
        resource::TextureHandle(textureHandle), texWidth, texHeight);
    return handle.id();
}

u32 rm_createLabelAtlasFont(resource::ResourceManager& rm, u32 textureHandle,
                              u32 texWidth, u32 texHeight, const std::string& chars,
                              u32 charWidth, u32 charHeight) {
    auto handle = rm.createLabelAtlasFont(
        resource::TextureHandle(textureHandle), texWidth, texHeight,
        chars, charWidth, charHeight);
    return handle.id();
}

void rm_releaseBitmapFont(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseBitmapFont(resource::BitmapFontHandle(handleId));
}

u32 rm_getBitmapFontRefCount(resource::ResourceManager& rm, u32 handleId) {
    return rm.getBitmapFontRefCount(resource::BitmapFontHandle(handleId));
}

#ifdef __EMSCRIPTEN__
emscripten::val rm_measureBitmapText(resource::ResourceManager& rm, u32 fontHandle,
                                      const std::string& text, f32 fontSize, f32 spacing) {
    auto* font = rm.getBitmapFont(resource::BitmapFontHandle(fontHandle));
    if (!font) {
        auto result = emscripten::val::object();
        result.set("width", 0);
        result.set("height", 0);
        return result;
    }
    auto metrics = font->measureText(text, fontSize, spacing);
    auto result = emscripten::val::object();
    result.set("width", metrics.width);
    result.set("height", metrics.height);
    return result;
}
#endif  // __EMSCRIPTEN__
#endif  // ES_ENABLE_BITMAP_TEXT

void rm_updateTextureSubregion(resource::ResourceManager& rm, u32 handleId,
                                u32 x, u32 y, u32 width, u32 height,
                                uintptr_t pixelsPtr, u32 pixelsLen) {
    auto* tex = rm.getTexture(resource::TextureHandle(handleId));
    if (!tex) return;
    // Sub-region pixels must already match the texture's format (RGBA8 atlas);
    // updateSubRegion bounds-checks the rect + buffer size internally.
    const u8* pixels = boundarySpan<u8>(pixelsPtr, pixelsLen, "rm_updateTextureSubregion");
    if (!pixels) return;
    tex->updateSubRegion(x, y, width, height, pixels, pixelsLen, /*flipY=*/false);
}

void rm_setTextureMetadata(resource::ResourceManager& rm, u32 handleId,
                            f32 left, f32 right, f32 top, f32 bottom) {
    resource::TextureMetadata metadata;
    metadata.sliceBorder.left = left;
    metadata.sliceBorder.right = right;
    metadata.sliceBorder.top = top;
    metadata.sliceBorder.bottom = bottom;
    rm.setTextureMetadata(resource::TextureHandle(handleId), metadata);
}

}  // namespace esengine

