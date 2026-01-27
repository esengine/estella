#pragma once

#include "../core/Types.hpp"
#include "../renderer/Texture.hpp"

#include <string>
#include <unordered_map>

namespace esengine::editor {

enum class AssetType : u8;

class ThumbnailGenerator {
public:
    static constexpr u32 THUMBNAIL_SIZE = 64;

    ThumbnailGenerator();
    ~ThumbnailGenerator();

    void generateThumbnail(const std::string& guid, const std::string& path, AssetType type);

    bool hasThumbnail(const std::string& guid) const;
    Texture* getThumbnail(const std::string& guid) const;

    void clear();
    void removeThumbnail(const std::string& guid);

private:
    void generateTextureThumbnail(const std::string& guid, const std::string& path);
    void generatePlaceholder(const std::string& guid, AssetType type);

    std::unordered_map<std::string, Unique<Texture>> thumbnails_;
};

}  // namespace esengine::editor
