/**
 * @file    Texture.cpp
 * @brief   Texture implementation (device-backed)
 * @details Thin RAII handle over a GPU texture. All GL is delegated to GfxDevice;
 *          this file contains no GL calls and no platform ifdefs — textures work
 *          on every platform the device backs (web and native alike).
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Texture.hpp"
#include "GfxDevice.hpp"
#include "../core/Log.hpp"

#include <span>

namespace esengine {

namespace {

GfxPixelFormat toGfxPixelFormat(TextureFormat format) {
    switch (format) {
    case TextureFormat::RGB8:    return GfxPixelFormat::RGB8;
    case TextureFormat::RGBA8:   return GfxPixelFormat::RGBA8;
    case TextureFormat::Depth24: return GfxPixelFormat::DepthComponent24;
    default:                     return GfxPixelFormat::RGBA8;
    }
}

u32 bytesPerPixel(TextureFormat format) {
    return format == TextureFormat::RGBA8 ? 4u : 3u;
}

}  // namespace

Texture::~Texture() {
    if (textureId_ != 0 && device_) {
        device_->deleteTexture(textureId_);
    }
}

Texture::Texture(Texture&& other) noexcept
    : device_(other.device_)
    , textureId_(other.textureId_)
    , width_(other.width_)
    , height_(other.height_)
    , format_(other.format_) {
    other.textureId_ = 0;
    other.width_ = 0;
    other.height_ = 0;
    other.format_ = TextureFormat::None;
}

Texture& Texture::operator=(Texture&& other) noexcept {
    if (this != &other) {
        if (textureId_ != 0 && device_) {
            device_->deleteTexture(textureId_);
        }
        device_ = other.device_;
        textureId_ = other.textureId_;
        width_ = other.width_;
        height_ = other.height_;
        format_ = other.format_;
        other.textureId_ = 0;
        other.width_ = 0;
        other.height_ = 0;
        other.format_ = TextureFormat::None;
    }
    return *this;
}

Unique<Texture> Texture::create(GfxDevice& device, const TextureSpecification& spec) {
    auto texture = makeUnique<Texture>();
    texture->device_ = &device;
    if (!texture->initialize(spec)) {
        return nullptr;
    }
    return texture;
}

Unique<Texture> Texture::create(GfxDevice& device, u32 width, u32 height, std::span<const u8> pixels,
                                 TextureFormat format, bool flipY) {
    [[maybe_unused]] u32 expectedSize = width * height * bytesPerPixel(format);
    ES_ASSERT(pixels.size() == expectedSize, "Pixel data size mismatch");
    return createRaw(device, width, height, pixels.data(), format, flipY);
}

Unique<Texture> Texture::create(GfxDevice& device, u32 width, u32 height, const std::vector<u8>& pixels,
                                 TextureFormat format, bool flipY) {
    return create(device, width, height, std::span<const u8>(pixels), format, flipY);
}

Unique<Texture> Texture::createRaw(GfxDevice& device, u32 width, u32 height, const void* data,
                                    TextureFormat format, bool flipY) {
    TextureSpecification spec;
    spec.width = width;
    spec.height = height;
    spec.format = format;
    spec.wrapS = TextureWrap::ClampToEdge;
    spec.wrapT = TextureWrap::ClampToEdge;
    spec.generateMips = false;

    auto texture = makeUnique<Texture>();
    texture->device_ = &device;
    if (!texture->initialize(spec)) {
        return nullptr;
    }

    if (data) {
        texture->setDataRaw(data, width * height * bytesPerPixel(format), flipY);
    }

    return texture;
}

Unique<Texture> Texture::createFromExternalId(GfxDevice& device, u32 glTextureId, u32 width, u32 height,
                                              TextureFormat format) {
    auto texture = makeUnique<Texture>();
    texture->device_ = &device;
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

    textureId_ = device_->createTexture();
    device_->texImage2D(textureId_, width_, height_, toGfxPixelFormat(spec.format), nullptr);
    device_->setTextureParams(textureId_, spec.minFilter, spec.magFilter, spec.wrapS, spec.wrapT);

    if (spec.generateMips) {
        device_->generateMipmaps(textureId_);
    }

    ES_LOG_DEBUG("Created texture {}x{} (ID: {})", width_, height_, textureId_);
    return true;
}

void Texture::bind(u32 slot) const {
    if (device_) device_->bindTexture(slot, textureId_);
}

void Texture::unbind() const {
    if (device_) device_->bindTexture(0, 0);
}

void Texture::setData(std::span<const u8> pixels) {
    [[maybe_unused]] u32 expectedSize = width_ * height_ * bytesPerPixel(format_);
    ES_ASSERT(pixels.size() == expectedSize, "Pixel data size mismatch");
    setDataRaw(pixels.data(), static_cast<u32>(pixels.size()));
}

void Texture::setData(const std::vector<u8>& pixels) {
    setData(std::span<const u8>(pixels));
}

void Texture::setDataRaw(const void* data, u32 sizeBytes, bool flipY) {
    [[maybe_unused]] u32 bpp = bytesPerPixel(format_);
    ES_ASSERT(sizeBytes == width_ * height_ * bpp, "Data size mismatch");
    (void)sizeBytes;

    if (flipY) device_->setUnpackFlipY(true);
    device_->texSubImage2D(textureId_, 0, 0, width_, height_, toGfxPixelFormat(format_), data);
    if (flipY) device_->setUnpackFlipY(false);
}

}  // namespace esengine
