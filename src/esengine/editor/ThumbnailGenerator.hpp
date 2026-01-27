/**
 * @file    ThumbnailGenerator.hpp
 * @brief   Asset thumbnail generation and caching
 * @details Generates and caches thumbnail images for various asset types
 *          for display in the asset browser.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"
#include "../renderer/Texture.hpp"

#include <string>
#include <unordered_map>

namespace esengine::editor {

// =============================================================================
// Forward Declarations
// =============================================================================

enum class AssetType : u8;

// =============================================================================
// ThumbnailGenerator Class
// =============================================================================

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
