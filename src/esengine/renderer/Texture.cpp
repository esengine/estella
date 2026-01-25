#include "Texture.hpp"
#include "../core/Log.hpp"
#include <stb_image.h>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>
    #ifndef GL_TEXTURE_2D
        #define GL_TEXTURE_2D 0x0DE1
        #define GL_TEXTURE_MIN_FILTER 0x2801
        #define GL_TEXTURE_MAG_FILTER 0x2800
        #define GL_TEXTURE_WRAP_S 0x2802
        #define GL_TEXTURE_WRAP_T 0x2803
        #define GL_LINEAR 0x2601
        #define GL_NEAREST 0x2600
        #define GL_REPEAT 0x2901
        #define GL_CLAMP_TO_EDGE 0x812F
        #define GL_MIRRORED_REPEAT 0x8370
        #define GL_RGB 0x1907
        #define GL_RGBA 0x1908
        #define GL_UNSIGNED_BYTE 0x1401
    #endif
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

Unique<Texture> Texture::create(u32 width, u32 height, const std::vector<u8>& pixels, TextureFormat format) {
    [[maybe_unused]] u32 expectedSize = width * height * (format == TextureFormat::RGBA8 ? 4 : 3);
    ES_ASSERT(pixels.size() == expectedSize, "Pixel data size mismatch");
    return createRaw(width, height, pixels.data(), format);
}

Unique<Texture> Texture::createRaw(u32 width, u32 height, const void* data, TextureFormat format) {
    TextureSpecification spec;
    spec.width = width;
    spec.height = height;
    spec.format = format;

    auto texture = makeUnique<Texture>();
    if (!texture->initialize(spec)) {
        return nullptr;
    }

    if (data) {
        texture->setDataRaw(data, width * height * (format == TextureFormat::RGBA8 ? 4 : 3));
    }

    return texture;
}

Unique<Texture> Texture::createFromFile(const std::string& path) {
    // Load image using stb_image
    stbi_set_flip_vertically_on_load(true);  // OpenGL expects bottom-to-top

    int width, height, channels;
    unsigned char* data = stbi_load(path.c_str(), &width, &height, &channels, 0);

    if (!data) {
        ES_LOG_ERROR("Failed to load texture: {} ({})", path, stbi_failure_reason());
        return nullptr;
    }

    // Determine format based on channels
    TextureFormat format = TextureFormat::RGBA8;
    if (channels == 3) {
        format = TextureFormat::RGB8;
    } else if (channels == 4) {
        format = TextureFormat::RGBA8;
    } else {
        ES_LOG_WARN("Unsupported texture format ({} channels), converting to RGBA", channels);
        stbi_image_free(data);

        // Reload with forced RGBA
        data = stbi_load(path.c_str(), &width, &height, &channels, 4);
        if (!data) {
            ES_LOG_ERROR("Failed to convert texture to RGBA: {}", path);
            return nullptr;
        }
        format = TextureFormat::RGBA8;
    }

    // Create texture from loaded data
    auto texture = createRaw(static_cast<u32>(width), static_cast<u32>(height), data, format);

    // Free image data
    stbi_image_free(data);

    if (texture) {
        ES_LOG_DEBUG("Loaded texture: {} ({}x{}, {} channels)", path, width, height, channels);
    }

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

void Texture::setData(const std::vector<u8>& pixels) {
    [[maybe_unused]] u32 expectedSize = width_ * height_ * (format_ == TextureFormat::RGBA8 ? 4 : 3);
    ES_ASSERT(pixels.size() == expectedSize, "Pixel data size mismatch");
    setDataRaw(pixels.data(), static_cast<u32>(pixels.size()));
}

void Texture::setDataRaw(const void* data, u32 sizeBytes) {
#ifdef ES_PLATFORM_WEB
    [[maybe_unused]] u32 bpp = (format_ == TextureFormat::RGBA8) ? 4 : 3;
    ES_ASSERT(sizeBytes == width_ * height_ * bpp, "Data size mismatch");
    (void)sizeBytes;  // Used only for assertion

    glBindTexture(GL_TEXTURE_2D, textureId_);
    glTexSubImage2D(
        GL_TEXTURE_2D,
        0,
        0, 0,
        width_, height_,
        toGLFormat(format_),
        GL_UNSIGNED_BYTE,
        data
    );
#else
    (void)data;
    (void)sizeBytes;
#endif
}

}  // namespace esengine
