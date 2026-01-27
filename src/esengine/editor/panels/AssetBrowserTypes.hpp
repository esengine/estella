#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

#include <string>

namespace esengine::editor {

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

struct AssetEntry {
    std::string name;
    std::string path;
    std::string extension;
    AssetType type = AssetType::Unknown;
    usize fileSize = 0;
    u64 modificationTime = 0;
    bool isDirectory = false;
};

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

}  // namespace esengine::editor
