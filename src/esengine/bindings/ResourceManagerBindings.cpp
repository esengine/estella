#ifdef ES_PLATFORM_WEB

#include "ResourceManagerBindings.hpp"
#include "../resource/TextureMetadata.hpp"
#include "../text/BitmapFont.hpp"
#include "../core/Types.hpp"

#include <emscripten/val.h>

namespace esengine {

u32 rm_createTexture(resource::ResourceManager& rm, u32 width, u32 height,
                      uintptr_t pixelsPtr, u32 pixelsLen, i32 format, bool flipY) {
    const u8* pixels = reinterpret_cast<const u8*>(pixelsPtr);
    ConstSpan<u8> pixelSpan(pixels, pixelsLen);

    TextureFormat texFormat = TextureFormat::RGBA8;
    if (format == 0) texFormat = TextureFormat::RGB8;
    else if (format == 1) texFormat = TextureFormat::RGBA8;

    auto handle = rm.createTexture(width, height, pixelSpan, texFormat, flipY);
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

void rm_releaseTexture(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseTexture(resource::TextureHandle(handleId));
}

u32 rm_getTextureRefCount(resource::ResourceManager& rm, u32 handleId) {
    return rm.getTextureRefCount(resource::TextureHandle(handleId));
}

void rm_registerTextureWithPath(resource::ResourceManager& rm, u32 handleId, const std::string& path) {
    rm.registerTextureWithPath(resource::TextureHandle(handleId), path);
}

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

#endif  // ES_PLATFORM_WEB
