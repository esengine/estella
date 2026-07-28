// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the Apache License, Version 2.0.
 */

#include "./Texture.hpp"
#include "./GfxDevice.hpp"
#include "../../core/Log.hpp"

#include <span>

namespace esengine {

namespace {

GfxPixelFormat toGfxPixelFormat(TextureFormat format) {
    switch (format) {
    case TextureFormat::RGB8:    return GfxPixelFormat::RGB8;
    case TextureFormat::RGBA8:   return GfxPixelFormat::RGBA8;
    case TextureFormat::SRGB8A8: return GfxPixelFormat::SRGB8_ALPHA8;
    case TextureFormat::RGBA16F: return GfxPixelFormat::RGBA16F;
    case TextureFormat::Depth24: return GfxPixelFormat::DepthComponent24;
    default:                     return GfxPixelFormat::RGBA8;
    }
}

u32 bytesPerPixel(TextureFormat format) {
    switch (format) {
    case TextureFormat::RGBA16F: return 8u;
    case TextureFormat::RGBA8:
    case TextureFormat::SRGB8A8: return 4u;
    default:                     return 3u;
    }
}

}  // namespace

Texture::~Texture() {
    if (handle_ != TextureHandle::Invalid && device_ && owns_) {
        device_->deleteTexture(handle_);
    }
}

Texture::Texture(Texture&& other) noexcept
    : device_(other.device_)
    , handle_(other.handle_)
    , width_(other.width_)
    , height_(other.height_)
    , format_(other.format_)
    , owns_(other.owns_) {
    other.handle_ = TextureHandle::Invalid;
    other.width_ = 0;
    other.height_ = 0;
    other.format_ = TextureFormat::None;
}

Texture& Texture::operator=(Texture&& other) noexcept {
    if (this != &other) {
        if (handle_ != TextureHandle::Invalid && device_ && owns_) {
            device_->deleteTexture(handle_);
        }
        device_ = other.device_;
        handle_ = other.handle_;
        width_ = other.width_;
        height_ = other.height_;
        format_ = other.format_;
        owns_ = other.owns_;
        other.handle_ = TextureHandle::Invalid;
        other.width_ = 0;
        other.height_ = 0;
        other.format_ = TextureFormat::None;
    }
    return *this;
}

Unique<Texture> Texture::create(GfxDevice& device, const TextureSpecification& spec) {
    auto texture = makeUnique<Texture>();
    texture->device_ = &device;
    if (!texture->initialize(spec, nullptr, false)) {
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
    if (!texture->initialize(spec, data, flipY)) {
        return nullptr;
    }
    return texture;
}

Unique<Texture> Texture::createCompressed(GfxDevice& device, u32 width, u32 height,
                                          GfxCompressedFormat format, std::span<const u8> data,
                                          u32 mipLevels) {
    auto texture = makeUnique<Texture>();
    texture->device_ = &device;
    texture->width_ = width;
    texture->height_ = height;
    texture->format_ = TextureFormat::RGBA8;   // sampled as colour; the GPU format is the compressed one

    TextureDesc desc;
    desc.width = width;
    desc.height = height;
    desc.minFilter = TextureFilter::Linear;
    desc.magFilter = TextureFilter::Linear;
    desc.wrapS = TextureWrap::ClampToEdge;
    desc.wrapT = TextureWrap::ClampToEdge;
    desc.mipmaps = mipLevels > 1;

    texture->handle_ = device.createCompressedTexture(desc, format, data.data(),
                                                      static_cast<u32>(data.size()), mipLevels);
    if (texture->handle_ == TextureHandle::Invalid) {
        ES_LOG_ERROR("Texture::createCompressed: failed for {}x{}", width, height);
        return nullptr;
    }
    return texture;
}

Unique<Texture> Texture::createFromExternalId(GfxDevice& device, u32 glTextureId, u32 width, u32 height,
                                              TextureFormat format) {
    TextureDesc desc;
    desc.width = width;
    desc.height = height;
    desc.format = toGfxPixelFormat(format);

    auto texture = makeUnique<Texture>();
    texture->device_ = &device;
    texture->handle_ = device.importExternalTexture(glTextureId, desc);
    texture->width_ = width;
    texture->height_ = height;
    texture->format_ = format;
    texture->owns_ = false;  // external owner frees the GL id; don't double-free it
    return texture;
}

bool Texture::initialize(const TextureSpecification& spec, const void* pixels, bool flipY) {
    width_ = spec.width;
    height_ = spec.height;
    format_ = spec.format;

    TextureDesc desc;
    desc.width = spec.width;
    desc.height = spec.height;
    desc.format = toGfxPixelFormat(spec.format);
    desc.minFilter = spec.minFilter;
    desc.magFilter = spec.magFilter;
    desc.wrapS = spec.wrapS;
    desc.wrapT = spec.wrapT;
    desc.mipmaps = spec.generateMips;
    desc.flipY = flipY;

    handle_ = device_->createTexture(desc, pixels);
    if (handle_ == TextureHandle::Invalid) {
        // Out of memory or a lost context: surface the failure instead of
        // returning a "valid" texture wrapping the null handle (renders as black).
        ES_LOG_ERROR("Texture::initialize: createTexture failed for {}x{}", width_, height_);
        return false;
    }

    ES_LOG_DEBUG("Created texture {}x{} (handle: {})", width_, height_, static_cast<u32>(handle_));
    return true;
}

void Texture::bind(u32 slot) const {
    if (device_) device_->bindTexture(slot, handle_);
}

void Texture::unbind() const {
    if (device_) device_->bindTexture(0, TextureHandle::Invalid);
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
    // Always-on size guard (independent of ES_ASSERT, which is stripped in release).
    // updateTexture below reads width_*height_*bpp bytes from `data`; a smaller
    // buffer would cause an out-of-bounds read of WASM linear memory.
    u32 expectedSize = width_ * height_ * bytesPerPixel(format_);
    if (sizeBytes < expectedSize) {
        ES_LOG_ERROR("Texture::setDataRaw: data size {} < required {} for {}x{}; skipping upload to avoid OOB read",
                     sizeBytes, expectedSize, width_, height_);
        return;
    }

    device_->updateTexture(handle_, 0, 0, width_, height_, data, flipY);
}

void Texture::updateSubRegion(u32 xoffset, u32 yoffset, u32 width, u32 height,
                              const void* data, u32 sizeBytes, bool flipY) {
    // The sub-rect must lie fully inside the texture; otherwise the upload
    // writes outside the allocated texture storage (GL error / undefined).
    if (xoffset + width > width_ || yoffset + height > height_) {
        ES_LOG_ERROR("Texture::updateSubRegion: rect {}x{} at ({},{}) exceeds texture {}x{}; skipping",
                     width, height, xoffset, yoffset, width_, height_);
        return;
    }
    // Always-on size guard (ES_ASSERT is stripped in release): updateTexture
    // reads width*height*bpp bytes from `data`; a smaller buffer would OOB-read
    // WASM linear memory.
    u32 expectedSize = width * height * bytesPerPixel(format_);
    if (sizeBytes < expectedSize) {
        ES_LOG_ERROR("Texture::updateSubRegion: data size {} < required {} for {}x{}; skipping to avoid OOB read",
                     sizeBytes, expectedSize, width, height);
        return;
    }

    device_->updateTexture(handle_, static_cast<i32>(xoffset), static_cast<i32>(yoffset),
                           width, height, data, flipY);
}

}  // namespace esengine
