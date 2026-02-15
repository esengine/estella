#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"
#include "../resource/ResourceManager.hpp"
#include <string>

namespace emscripten {
    class val;
}

namespace esengine {

u32 rm_createTexture(resource::ResourceManager& rm, u32 width, u32 height,
                      uintptr_t pixelsPtr, u32 pixelsLen, i32 format, bool flipY);
u32 rm_createShader(resource::ResourceManager& rm,
                     const std::string& vertSrc, const std::string& fragSrc);
u32 rm_registerExternalTexture(resource::ResourceManager& rm, u32 glTextureId,
                                u32 width, u32 height);
void rm_releaseTexture(resource::ResourceManager& rm, u32 handleId);
u32 rm_getTextureRefCount(resource::ResourceManager& rm, u32 handleId);
void rm_registerTextureWithPath(resource::ResourceManager& rm, u32 handleId, const std::string& path);
void rm_releaseShader(resource::ResourceManager& rm, u32 handleId);
u32 rm_getShaderRefCount(resource::ResourceManager& rm, u32 handleId);
u32 rm_getTextureGLId(resource::ResourceManager& rm, u32 handleId);
u32 rm_loadBitmapFont(resource::ResourceManager& rm, const std::string& fntContent,
                       u32 textureHandle, u32 texWidth, u32 texHeight);
u32 rm_createLabelAtlasFont(resource::ResourceManager& rm, u32 textureHandle,
                              u32 texWidth, u32 texHeight, const std::string& chars,
                              u32 charWidth, u32 charHeight);
void rm_releaseBitmapFont(resource::ResourceManager& rm, u32 handleId);
u32 rm_getBitmapFontRefCount(resource::ResourceManager& rm, u32 handleId);
emscripten::val rm_measureBitmapText(resource::ResourceManager& rm, u32 fontHandle,
                                      const std::string& text, f32 fontSize, f32 spacing);
void rm_setTextureMetadata(resource::ResourceManager& rm, u32 handleId,
                            f32 left, f32 right, f32 top, f32 bottom);

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
