#include "ThumbnailGenerator.hpp"
#include "panels/AssetBrowserTypes.hpp"
#include "../core/Log.hpp"

#include <stb_image.h>

#include <algorithm>
#include <cstring>

namespace esengine::editor {

namespace {

std::vector<u8> resizeImage(const u8* src, u32 srcWidth, u32 srcHeight, u32 dstWidth, u32 dstHeight, u32 channels) {
    std::vector<u8> dst(dstWidth * dstHeight * channels);

    for (u32 y = 0; y < dstHeight; ++y) {
        for (u32 x = 0; x < dstWidth; ++x) {
            u32 srcX = x * srcWidth / dstWidth;
            u32 srcY = y * srcHeight / dstHeight;

            srcX = std::min(srcX, srcWidth - 1);
            srcY = std::min(srcY, srcHeight - 1);

            for (u32 c = 0; c < channels; ++c) {
                dst[(y * dstWidth + x) * channels + c] =
                    src[(srcY * srcWidth + srcX) * channels + c];
            }
        }
    }

    return dst;
}

glm::vec4 getColorForType(AssetType type) {
    switch (type) {
        case AssetType::Folder:  return {0.9f, 0.8f, 0.3f, 1.0f};
        case AssetType::Texture: return {0.3f, 0.7f, 0.9f, 1.0f};
        case AssetType::Audio:   return {0.9f, 0.5f, 0.3f, 1.0f};
        case AssetType::Script:  return {0.5f, 0.9f, 0.5f, 1.0f};
        case AssetType::Shader:  return {0.8f, 0.5f, 0.9f, 1.0f};
        case AssetType::Scene:   return {0.3f, 0.9f, 0.9f, 1.0f};
        case AssetType::Prefab:  return {0.9f, 0.3f, 0.6f, 1.0f};
        case AssetType::Font:    return {0.7f, 0.7f, 0.7f, 1.0f};
        default:                 return {0.5f, 0.5f, 0.5f, 1.0f};
    }
}

}  // namespace

ThumbnailGenerator::ThumbnailGenerator() = default;

ThumbnailGenerator::~ThumbnailGenerator() = default;

void ThumbnailGenerator::generateThumbnail(const std::string& guid, const std::string& path, AssetType type) {
    if (hasThumbnail(guid)) {
        return;
    }

    if (type == AssetType::Texture) {
        generateTextureThumbnail(guid, path);
    } else {
        generatePlaceholder(guid, type);
    }
}

bool ThumbnailGenerator::hasThumbnail(const std::string& guid) const {
    return thumbnails_.find(guid) != thumbnails_.end();
}

Texture* ThumbnailGenerator::getThumbnail(const std::string& guid) const {
    auto it = thumbnails_.find(guid);
    if (it != thumbnails_.end()) {
        return it->second.get();
    }
    return nullptr;
}

void ThumbnailGenerator::clear() {
    thumbnails_.clear();
}

void ThumbnailGenerator::removeThumbnail(const std::string& guid) {
    thumbnails_.erase(guid);
}

void ThumbnailGenerator::generateTextureThumbnail(const std::string& guid, const std::string& path) {
    int width, height, channels;
    stbi_set_flip_vertically_on_load(false);
    u8* data = stbi_load(path.c_str(), &width, &height, &channels, 4);

    if (!data) {
        ES_LOG_WARN("Failed to load image for thumbnail: {}", path);
        generatePlaceholder(guid, AssetType::Texture);
        return;
    }

    std::vector<u8> resized = resizeImage(data, static_cast<u32>(width), static_cast<u32>(height),
                                          THUMBNAIL_SIZE, THUMBNAIL_SIZE, 4);
    stbi_image_free(data);

    auto texture = Texture::create(THUMBNAIL_SIZE, THUMBNAIL_SIZE, resized, TextureFormat::RGBA8);
    if (texture) {
        thumbnails_[guid] = std::move(texture);
    }
}

void ThumbnailGenerator::generatePlaceholder(const std::string& guid, AssetType type) {
    glm::vec4 color = getColorForType(type);

    std::vector<u8> pixels(THUMBNAIL_SIZE * THUMBNAIL_SIZE * 4);
    u8 r = static_cast<u8>(color.r * 255.0f);
    u8 g = static_cast<u8>(color.g * 255.0f);
    u8 b = static_cast<u8>(color.b * 255.0f);
    u8 a = static_cast<u8>(color.a * 255.0f);

    for (u32 y = 0; y < THUMBNAIL_SIZE; ++y) {
        for (u32 x = 0; x < THUMBNAIL_SIZE; ++x) {
            usize idx = (y * THUMBNAIL_SIZE + x) * 4;
            pixels[idx + 0] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        }
    }

    auto texture = Texture::create(THUMBNAIL_SIZE, THUMBNAIL_SIZE, pixels, TextureFormat::RGBA8);
    if (texture) {
        thumbnails_[guid] = std::move(texture);
    }
}

}  // namespace esengine::editor
