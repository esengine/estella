// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once


#include "../core/Types.hpp"
#include "../resource/ResourceManager.hpp"
#include <string>

// The value type embind returns for array/object results. Web-only: a native
// build compiles this same TU (see cmake/ESEngineSources.cmake) and simply does
// not carry the entry points that return one.
#ifdef __EMSCRIPTEN__
namespace emscripten {
    class val;
}
#endif

namespace esengine {

u32 rm_createTexture(resource::ResourceManager& rm, u32 width, u32 height,
                      uintptr_t pixelsPtr, u32 pixelsLen, i32 format, bool flipY);
u32 rm_createTextureEx(resource::ResourceManager& rm, u32 width, u32 height,
                        uintptr_t pixelsPtr, u32 pixelsLen, i32 format, bool flipY,
                        i32 filterMode, i32 wrapMode);
u32 rm_createShader(resource::ResourceManager& rm,
                     const std::string& vertSrc, const std::string& fragSrc);
/** Whether the active backend samples this compressed format. */
bool rm_supportsCompressedFormat(resource::ResourceManager& rm, i32 format);

/** Uploads pre-transcoded blocks as one compressed texture. */
u32 rm_createCompressedTexture(resource::ResourceManager& rm, u32 width, u32 height,
                               i32 format, uintptr_t dataPtr, u32 dataLen, u32 mipLevels);

u32 rm_registerExternalTexture(resource::ResourceManager& rm, u32 glTextureId,
                                u32 width, u32 height);
/** @brief Points an EXISTING texture handle at a freshly uploaded GPU object. */
bool rm_retargetExternalTexture(resource::ResourceManager& rm, u32 handle,
                                u32 glTextureId, u32 width, u32 height);

/** @brief The textures still parked on the placeholder, as `handle|path` lines. */
std::string rm_texturesAwaitingReupload(resource::ResourceManager& rm);

u32 rm_registerExternalTextureSized(resource::ResourceManager& rm, u32 glTextureId,
                                     u32 width, u32 height, u32 bytes);
void rm_releaseTexture(resource::ResourceManager& rm, u32 handleId);
u32 rm_getTextureRefCount(resource::ResourceManager& rm, u32 handleId);
void rm_registerTextureWithPath(resource::ResourceManager& rm, u32 handleId, const std::string& path);
void rm_setTextureBudget(resource::ResourceManager& rm, u32 bytes);
u32 rm_acquireTextureByPath(resource::ResourceManager& rm, const std::string& path);
bool rm_invalidateTexturePath(resource::ResourceManager& rm, const std::string& path);
u32 rm_trimTextureCache(resource::ResourceManager& rm);
#ifdef __EMSCRIPTEN__
emscripten::val rm_getResourceStats(resource::ResourceManager& rm);
#endif
void rm_releaseShader(resource::ResourceManager& rm, u32 handleId);
u32 rm_getShaderRefCount(resource::ResourceManager& rm, u32 handleId);
u32 rm_getTextureGLId(resource::ResourceManager& rm, u32 handleId);
#ifdef __EMSCRIPTEN__
emscripten::val rm_getTextureDimensions(resource::ResourceManager& rm, u32 handleId);
#endif
#ifdef ES_ENABLE_BITMAP_TEXT
u32 rm_loadBitmapFont(resource::ResourceManager& rm, const std::string& fntContent,
                       u32 textureHandle, u32 texWidth, u32 texHeight);
u32 rm_createLabelAtlasFont(resource::ResourceManager& rm, u32 textureHandle,
                              u32 texWidth, u32 texHeight, const std::string& chars,
                              u32 charWidth, u32 charHeight);
void rm_releaseBitmapFont(resource::ResourceManager& rm, u32 handleId);
u32 rm_getBitmapFontRefCount(resource::ResourceManager& rm, u32 handleId);
#ifdef __EMSCRIPTEN__
emscripten::val rm_measureBitmapText(resource::ResourceManager& rm, u32 fontHandle,
                                      const std::string& text, f32 fontSize, f32 spacing);
#endif
#endif
void rm_updateTextureSubregion(resource::ResourceManager& rm, u32 handleId,
                                u32 x, u32 y, u32 width, u32 height,
                                uintptr_t pixelsPtr, u32 pixelsLen);

void rm_setTextureMetadata(resource::ResourceManager& rm, u32 handleId,
                            f32 left, f32 right, f32 top, f32 bottom);

}  // namespace esengine

