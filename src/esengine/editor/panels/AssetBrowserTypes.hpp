/**
 * @file    AssetBrowserTypes.hpp
 * @brief   Type definitions for the asset browser
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

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

#include <string>

namespace esengine::editor {

// =============================================================================
// Enumerations
// =============================================================================

enum class AssetType : u8 {
    Unknown,
    Folder,
    Texture,
    Audio,
    Script,
    Shader,
    Scene,
    Prefab,
    Font
};

enum class AssetViewMode : u8 {
    Grid,
    List
};

// =============================================================================
// Data Structures
// =============================================================================

struct AssetEntry {
    std::string name;
    std::string path;
    std::string extension;
    AssetType type = AssetType::Unknown;
    usize fileSize = 0;
    u64 modificationTime = 0;
    bool isDirectory = false;
};

// =============================================================================
// Utility Functions
// =============================================================================

inline AssetType getAssetTypeFromExtension(const std::string& ext) {
    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp" || ext == ".tga") {
        return AssetType::Texture;
    }
    if (ext == ".wav" || ext == ".mp3" || ext == ".ogg") {
        return AssetType::Audio;
    }
    if (ext == ".js" || ext == ".ts") {
        return AssetType::Script;
    }
    if (ext == ".glsl" || ext == ".vert" || ext == ".frag") {
        return AssetType::Shader;
    }
    if (ext == ".scene" || ext == ".scene.json") {
        return AssetType::Scene;
    }
    if (ext == ".prefab" || ext == ".prefab.json") {
        return AssetType::Prefab;
    }
    if (ext == ".ttf" || ext == ".otf") {
        return AssetType::Font;
    }
    return AssetType::Unknown;
}

inline glm::vec4 getAssetTypeColor(AssetType type) {
    switch (type) {
        case AssetType::Folder:  return {0.863f, 0.714f, 0.478f, 1.0f};  // #dcb67a
        case AssetType::Texture: return {0.925f, 0.251f, 0.478f, 1.0f};  // #ec407a
        case AssetType::Audio:   return {1.0f, 0.655f, 0.149f, 1.0f};    // #ffa726
        case AssetType::Script:  return {0.259f, 0.647f, 0.961f, 1.0f};  // #42a5f5
        case AssetType::Shader:  return {0.545f, 0.361f, 0.965f, 1.0f};  // #8b5cf6
        case AssetType::Scene:   return {0.4f, 0.733f, 0.416f, 1.0f};    // #66bb6a
        case AssetType::Prefab:  return {0.149f, 0.651f, 0.604f, 1.0f};  // #26a69a
        case AssetType::Font:    return {0.565f, 0.792f, 0.976f, 1.0f};  // #90caf9
        default:                 return {0.565f, 0.792f, 0.976f, 1.0f};  // #90caf9
    }
}

}  // namespace esengine::editor
