/**
 * @file    Texture.cpp
 * @brief   Texture implementation for OpenGL/WebGL
 * @details Implements texture creation, loading (via stb_image), and management.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Texture.hpp"
#include "../core/Log.hpp"
#include "OpenGLHeaders.hpp"

#include <span>

#ifndef ES_PLATFORM_WEB
#include <stb_image.h>
#endif

namespace esengine {

namespace {

#ifdef ES_PLATFORM_WEB
GLenum toGLFormat(TextureFormat format) {
    switch (format) {
    case TextureFormat::RGB8:  return GL_RGB;
    case TextureFormat::RGBA8: return GL_RGBA;
    default: return GL_RGBA;
    }
}

GLenum toGLInternalFormat(TextureFormat format) {
    switch (format) {
    case TextureFormat::RGB8:  return GL_RGB8;
    case TextureFormat::RGBA8: return GL_RGBA8;
    default: return GL_RGBA8;
    }
}

GLenum toGLFilter(TextureFilter filter) {
    switch (filter) {
    case TextureFilter::Nearest: return GL_NEAREST;
    case TextureFilter::Linear:  return GL_LINEAR;
    default: return GL_LINEAR;
    }
}

GLenum toGLWrap(TextureWrap wrap) {
    switch (wrap) {
    case TextureWrap::Repeat:         return GL_REPEAT;
    case TextureWrap::ClampToEdge:    return GL_CLAMP_TO_EDGE;
    case TextureWrap::MirroredRepeat: return GL_MIRRORED_REPEAT;
    default: return GL_REPEAT;
    }
}
#endif

}  // namespace

Texture::~Texture() {
#ifdef ES_PLATFORM_WEB
    if (textureId_ != 0) {
        glDeleteTextures(1, &textureId_);
    }
#endif
}

Texture::Texture(Texture&& other) noexcept
    : textureId_(other.textureId_)
    , width_(other.width_)
    , height_(other.height_)
    , format_(other.format_) {
    other.textureId_ = 0;
    other.width_ = 0;
    other.height_ = 0;
}

Texture& Texture::operator=(Texture&& other) noexcept {
    if (this != &other) {
#ifdef ES_PLATFORM_WEB
        if (textureId_ != 0) {
            glDeleteTextures(1, &textureId_);
        }
#endif
        textureId_ = other.textureId_;
        width_ = other.width_;
        height_ = other.height_;
        format_ = other.format_;
        other.textureId_ = 0;
        other.width_ = 0;
        other.height_ = 0;
    }
    return *this;
}

Unique<Texture> Texture::create(const TextureSpecification& spec) {
    auto texture = makeUnique<Texture>();
    if (!texture->initialize(spec)) {
        return nullptr;
    }
    return texture;
}

Unique<Texture> Texture::create(u32 width, u32 height, std::span<const u8> pixels,
                                 TextureFormat format, bool flipY) {
    [[maybe_unused]] u32 expectedSize = width * height * (format == TextureFormat::RGBA8 ? 4 : 3);
    ES_ASSERT(pixels.size() == expectedSize, "Pixel data size mismatch");
    return createRaw(width, height, pixels.data(), format, flipY);
}

Unique<Texture> Texture::create(u32 width, u32 height, const std::vector<u8>& pixels,
                                 TextureFormat format, bool flipY) {
    return create(width, height, std::span<const u8>(pixels), format, flipY);
}

Unique<Texture> Texture::createRaw(u32 width, u32 height, const void* data,
                                    TextureFormat format, bool flipY) {
    TextureSpecification spec;
    spec.width = width;
    spec.height = height;
    spec.format = format;
    spec.wrapS = TextureWrap::ClampToEdge;
    spec.wrapT = TextureWrap::ClampToEdge;
    spec.generateMips = false;

    auto texture = makeUnique<Texture>();
    if (!texture->initialize(spec)) {
        return nullptr;
    }

    if (data) {
        texture->setDataRaw(data, width * height * (format == TextureFormat::RGBA8 ? 4 : 3), flipY);
    }

    return texture;
}

#ifndef ES_PLATFORM_WEB
Unique<Texture> Texture::createFromFile(const std::string& path) {
    int width, height, channels;
    unsigned char* data = stbi_load(path.c_str(), &width, &height, &channels, 0);

    if (!data) {
        ES_LOG_ERROR("Failed to load texture: {} ({})", path, stbi_failure_reason());
        return nullptr;
    }

    TextureFormat format = TextureFormat::RGBA8;
    if (channels == 3) {
        format = TextureFormat::RGB8;
    } else if (channels == 4) {
        format = TextureFormat::RGBA8;
    } else {
        ES_LOG_WARN("Unsupported texture format ({} channels), converting to RGBA", channels);
        stbi_image_free(data);

        data = stbi_load(path.c_str(), &width, &height, &channels, 4);
        if (!data) {
            ES_LOG_ERROR("Failed to convert texture to RGBA: {}", path);
            return nullptr;
        }
        format = TextureFormat::RGBA8;
    }

    auto texture = createRaw(static_cast<u32>(width), static_cast<u32>(height), data, format);
    stbi_image_free(data);

    if (texture) {
        ES_LOG_DEBUG("Loaded texture: {} ({}x{}, {} channels)", path, width, height, channels);
    }

    return texture;
}
#endif

Unique<Texture> Texture::createFromExternalId(u32 glTextureId, u32 width, u32 height, TextureFormat format) {
    auto texture = makeUnique<Texture>();
    texture->textureId_ = glTextureId;
    texture->width_ = width;
    texture->height_ = height;
    texture->format_ = format;
    return texture;
}

bool Texture::initialize(const TextureSpecification& spec) {
    width_ = spec.width;
    height_ = spec.height;
    format_ = spec.format;

#ifdef ES_PLATFORM_WEB
    glGenTextures(1, &textureId_);
    glBindTexture(GL_TEXTURE_2D, textureId_);

    // Set texture parameters
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, toGLFilter(spec.minFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(spec.magFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(spec.wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(spec.wrapT));

    // Allocate texture storage
    glTexImage2D(
        GL_TEXTURE_2D,
        0,
        toGLInternalFormat(spec.format),
        width_,
        height_,
        0,
        toGLFormat(spec.format),
        GL_UNSIGNED_BYTE,
        nullptr
    );

    if (spec.generateMips) {
        glGenerateMipmap(GL_TEXTURE_2D);
    }

    ES_LOG_DEBUG("Created texture {}x{} (ID: {})", width_, height_, textureId_);
    return true;
#else
    (void)spec;
    return false;
#endif
}

void Texture::bind(u32 slot) const {
#ifdef ES_PLATFORM_WEB
    glActiveTexture(GL_TEXTURE0 + slot);
    glBindTexture(GL_TEXTURE_2D, textureId_);
#else
    (void)slot;
#endif
}

void Texture::unbind() const {
#ifdef ES_PLATFORM_WEB
    glBindTexture(GL_TEXTURE_2D, 0);
#endif
}

void Texture::setData(std::span<const u8> pixels) {
    [[maybe_unused]] u32 expectedSize = width_ * height_ * (format_ == TextureFormat::RGBA8 ? 4 : 3);
    ES_ASSERT(pixels.size() == expectedSize, "Pixel data size mismatch");
    setDataRaw(pixels.data(), static_cast<u32>(pixels.size()));
}

void Texture::setData(const std::vector<u8>& pixels) {
    setData(std::span<const u8>(pixels));
}

void Texture::setDataRaw(const void* data, u32 sizeBytes, bool flipY) {
#ifdef ES_PLATFORM_WEB
    [[maybe_unused]] u32 bpp = (format_ == TextureFormat::RGBA8) ? 4 : 3;
    ES_ASSERT(sizeBytes == width_ * height_ * bpp, "Data size mismatch");
    (void)sizeBytes;

    glBindTexture(GL_TEXTURE_2D, textureId_);
    if (flipY) {
        glPixelStorei(0x9240 /* GL_UNPACK_FLIP_Y_WEBGL */, GL_TRUE);
    }
    glTexSubImage2D(
        GL_TEXTURE_2D,
        0,
        0, 0,
        width_, height_,
        toGLFormat(format_),
        GL_UNSIGNED_BYTE,
        data
    );
    if (flipY) {
        glPixelStorei(0x9240, GL_FALSE);
    }
#else
    (void)data;
    (void)sizeBytes;
    (void)flipY;
#endif
}

}  // namespace esengine
