/**
 * @file    SceneSerializer.cpp
 * @brief   Scene serialization implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "SceneSerializer.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/Component.hpp"
#include "../../ecs/components/Canvas.hpp"

#include <filesystem>
#include <fstream>
#include <random>
#include <sstream>
#include <unordered_map>

namespace fs = std::filesystem;

namespace esengine::editor {

// =============================================================================
// Helper Functions
// =============================================================================

namespace {

std::string escapeJsonString(const std::string& str) {
    std::string result;
    result.reserve(str.size() + 16);
    for (char c : str) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}

std::string unescapeJsonString(const std::string& str) {
    std::string result;
    result.reserve(str.size());
    for (usize i = 0; i < str.size(); ++i) {
        if (str[i] == '\\' && i + 1 < str.size()) {
            switch (str[i + 1]) {
                case '"': result += '"'; ++i; break;
                case '\\': result += '\\'; ++i; break;
                case 'n': result += '\n'; ++i; break;
                case 'r': result += '\r'; ++i; break;
                case 't': result += '\t'; ++i; break;
                default: result += str[i]; break;
            }
        } else {
            result += str[i];
        }
    }
    return result;
}

u64 generateUUID() {
    static std::random_device rd;
    static std::mt19937_64 gen(rd());
    static std::uniform_int_distribution<u64> dis;
    return dis(gen);
}

std::string extractString(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return "";

    usize valueStart = json.find("\"", keyPos + searchKey.size());
    if (valueStart == std::string::npos) return "";

    usize valueEnd = valueStart + 1;
    while (valueEnd < json.size()) {
        if (json[valueEnd] == '"' && json[valueEnd - 1] != '\\') break;
        ++valueEnd;
    }
    if (valueEnd >= json.size()) return "";

    return unescapeJsonString(json.substr(valueStart + 1, valueEnd - valueStart - 1));
}

u64 extractUInt(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return 0;

    usize valueStart = keyPos + searchKey.size();
    while (valueStart < json.size() && !std::isdigit(json[valueStart]) && json[valueStart] != '-') {
        ++valueStart;
    }
    if (valueStart >= json.size()) return 0;

    try {
        return std::stoull(json.substr(valueStart));
    } catch (...) {
        return 0;
    }
}

i32 extractInt(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return 0;

    usize valueStart = keyPos + searchKey.size();
    while (valueStart < json.size() && !std::isdigit(json[valueStart]) && json[valueStart] != '-') {
        ++valueStart;
    }
    if (valueStart >= json.size()) return 0;

    try {
        return std::stoi(json.substr(valueStart));
    } catch (...) {
        return 0;
    }
}

f32 extractFloat(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return 0.0f;

    usize valueStart = keyPos + searchKey.size();
    while (valueStart < json.size() && !std::isdigit(json[valueStart]) &&
           json[valueStart] != '-' && json[valueStart] != '.') {
        ++valueStart;
    }
    if (valueStart >= json.size()) return 0.0f;

    try {
        return std::stof(json.substr(valueStart));
    } catch (...) {
        return 0.0f;
    }
}

bool extractBool(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return false;

    usize truePos = json.find("true", keyPos);
    usize falsePos = json.find("false", keyPos);
    usize nextKey = json.find("\"", keyPos + searchKey.size() + 1);

    if (truePos != std::string::npos && (truePos < falsePos || falsePos == std::string::npos)) {
        if (nextKey == std::string::npos || truePos < nextKey) {
            return true;
        }
    }
    return false;
}

glm::vec2 extractVec2(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return glm::vec2(0.0f);

    usize arrayStart = json.find("[", keyPos);
    usize arrayEnd = json.find("]", arrayStart);
    if (arrayStart == std::string::npos || arrayEnd == std::string::npos) return glm::vec2(0.0f);

    std::string content = json.substr(arrayStart + 1, arrayEnd - arrayStart - 1);
    glm::vec2 result(0.0f);

    try {
        usize pos = 0;
        result.x = std::stof(content.substr(pos));
        pos = content.find(",", pos);
        if (pos != std::string::npos) {
            result.y = std::stof(content.substr(pos + 1));
        }
    } catch (...) {}

    return result;
}

glm::vec3 extractVec3(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return glm::vec3(0.0f);

    usize arrayStart = json.find("[", keyPos);
    usize arrayEnd = json.find("]", arrayStart);
    if (arrayStart == std::string::npos || arrayEnd == std::string::npos) return glm::vec3(0.0f);

    std::string content = json.substr(arrayStart + 1, arrayEnd - arrayStart - 1);
    glm::vec3 result(0.0f);

    try {
        usize pos = 0;
        result.x = std::stof(content.substr(pos));
        pos = content.find(",", pos);
        if (pos != std::string::npos) {
            result.y = std::stof(content.substr(pos + 1));
            pos = content.find(",", pos + 1);
            if (pos != std::string::npos) {
                result.z = std::stof(content.substr(pos + 1));
            }
        }
    } catch (...) {}

    return result;
}

glm::vec4 extractVec4(const std::string& json, usize startPos, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return glm::vec4(0.0f);

    usize arrayStart = json.find("[", keyPos);
    usize arrayEnd = json.find("]", arrayStart);
    if (arrayStart == std::string::npos || arrayEnd == std::string::npos) return glm::vec4(0.0f);

    std::string content = json.substr(arrayStart + 1, arrayEnd - arrayStart - 1);
    glm::vec4 result(0.0f);

    try {
        usize pos = 0;
        result.x = std::stof(content.substr(pos));
        pos = content.find(",", pos);
        if (pos != std::string::npos) {
            result.y = std::stof(content.substr(pos + 1));
            pos = content.find(",", pos + 1);
            if (pos != std::string::npos) {
                result.z = std::stof(content.substr(pos + 1));
                pos = content.find(",", pos + 1);
                if (pos != std::string::npos) {
                    result.w = std::stof(content.substr(pos + 1));
                }
            }
        }
    } catch (...) {}

    return result;
}

glm::quat extractQuat(const std::string& json, usize startPos, const std::string& key) {
    glm::vec4 v = extractVec4(json, startPos, key);
    return glm::quat(v.x, v.y, v.z, v.w);  // w, x, y, z order
}

std::string serializeVec2(const glm::vec2& v) {
    std::ostringstream ss;
    ss << "[" << v.x << ", " << v.y << "]";
    return ss.str();
}

std::string serializeVec3(const glm::vec3& v) {
    std::ostringstream ss;
    ss << "[" << v.x << ", " << v.y << ", " << v.z << "]";
    return ss.str();
}

std::string serializeVec4(const glm::vec4& v) {
    std::ostringstream ss;
    ss << "[" << v.x << ", " << v.y << ", " << v.z << ", " << v.w << "]";
    return ss.str();
}

std::string serializeQuat(const glm::quat& q) {
    std::ostringstream ss;
    ss << "[" << q.w << ", " << q.x << ", " << q.y << ", " << q.z << "]";
    return ss.str();
}

}  // namespace

// =============================================================================
// Scene Serialization
// =============================================================================

bool SceneSerializer::saveScene(
    const ecs::Registry& registry,
    const std::string& filePath,
    const std::string& sceneName,
    const resource::ResourceManager* resourceManager,
    const std::string& projectPath
) {
    ES_LOG_INFO("Saving scene to: {}", filePath);

    std::ostringstream ss;
    ss << "{\n";
    ss << "  \"version\": " << SCENE_FORMAT_VERSION << ",\n";
    ss << "  \"name\": \"" << escapeJsonString(sceneName) << "\",\n";
    ss << "  \"entities\": [\n";

    bool firstEntity = true;
    std::unordered_map<Entity, u64> entityToUUID;

    // First pass: assign UUIDs to all entities
    registry.forEachEntity([&](Entity entity) {
        if (registry.has<ecs::UUID>(entity)) {
            entityToUUID[entity] = registry.get<ecs::UUID>(entity).value;
        } else {
            entityToUUID[entity] = generateUUID();
        }
    });

    // Second pass: serialize entities
    registry.forEachEntity([&](Entity entity) {
        if (!firstEntity) {
            ss << ",\n";
        }
        firstEntity = false;

        u64 uuid = entityToUUID[entity];

        ss << "    {\n";
        ss << "      \"uuid\": " << uuid << ",\n";

        // Name
        if (registry.has<ecs::Name>(entity)) {
            const auto& name = registry.get<ecs::Name>(entity);
            ss << "      \"name\": \"" << escapeJsonString(name.value) << "\",\n";
        } else {
            ss << "      \"name\": \"Entity\",\n";
        }

        ss << "      \"components\": {\n";
        bool firstComponent = true;

        // LocalTransform
        if (registry.has<ecs::LocalTransform>(entity)) {
            if (!firstComponent) ss << ",\n";
            firstComponent = false;
            const auto& t = registry.get<ecs::LocalTransform>(entity);
            ss << "        \"LocalTransform\": {\n";
            ss << "          \"position\": " << serializeVec3(t.position) << ",\n";
            ss << "          \"rotation\": " << serializeQuat(t.rotation) << ",\n";
            ss << "          \"scale\": " << serializeVec3(t.scale) << "\n";
            ss << "        }";
        }

        // Parent
        if (registry.has<ecs::Parent>(entity)) {
            if (!firstComponent) ss << ",\n";
            firstComponent = false;
            const auto& p = registry.get<ecs::Parent>(entity);
            u64 parentUUID = 0;
            if (p.entity != INVALID_ENTITY && entityToUUID.count(p.entity)) {
                parentUUID = entityToUUID[p.entity];
            }
            ss << "        \"Parent\": {\n";
            ss << "          \"uuid\": " << parentUUID << "\n";
            ss << "        }";
        }

        // Sprite
        if (registry.has<ecs::Sprite>(entity)) {
            if (!firstComponent) ss << ",\n";
            firstComponent = false;
            const auto& s = registry.get<ecs::Sprite>(entity);
            ss << "        \"Sprite\": {\n";
            ss << "          \"texture\": " << s.texture.id() << ",\n";

            // Store texture path if available (for web preview)
            if (resourceManager && s.texture.isValid()) {
                std::string texPath = resourceManager->getTexturePath(s.texture);
                // Make path relative to project's assets folder
                if (!texPath.empty() && !projectPath.empty()) {
                    fs::path texturePath(texPath);
                    fs::path assetsPath = fs::path(projectPath) / "assets";
                    if (texturePath.string().find(assetsPath.string()) == 0) {
                        texPath = "assets" + texturePath.string().substr(assetsPath.string().size());
                        // Normalize path separators
                        std::replace(texPath.begin(), texPath.end(), '\\', '/');
                    }
                }
                ss << "          \"texturePath\": \"" << escapeJsonString(texPath) << "\",\n";
            }

            ss << "          \"color\": " << serializeVec4(s.color) << ",\n";
            ss << "          \"size\": " << serializeVec2(s.size) << ",\n";
            ss << "          \"uvOffset\": " << serializeVec2(s.uvOffset) << ",\n";
            ss << "          \"uvScale\": " << serializeVec2(s.uvScale) << ",\n";
            ss << "          \"layer\": " << s.layer << ",\n";
            ss << "          \"flipX\": " << (s.flipX ? "true" : "false") << ",\n";
            ss << "          \"flipY\": " << (s.flipY ? "true" : "false") << "\n";
            ss << "        }";
        }

        // Camera
        if (registry.has<ecs::Camera>(entity)) {
            if (!firstComponent) ss << ",\n";
            firstComponent = false;
            const auto& c = registry.get<ecs::Camera>(entity);
            ss << "        \"Camera\": {\n";
            ss << "          \"projectionType\": " << static_cast<int>(c.projectionType) << ",\n";
            ss << "          \"fov\": " << c.fov << ",\n";
            ss << "          \"orthoSize\": " << c.orthoSize << ",\n";
            ss << "          \"nearPlane\": " << c.nearPlane << ",\n";
            ss << "          \"farPlane\": " << c.farPlane << ",\n";
            ss << "          \"aspectRatio\": " << c.aspectRatio << ",\n";
            ss << "          \"isActive\": " << (c.isActive ? "true" : "false") << ",\n";
            ss << "          \"priority\": " << c.priority << "\n";
            ss << "        }";
        }

        // Canvas
        if (registry.has<ecs::Canvas>(entity)) {
            if (!firstComponent) ss << ",\n";
            firstComponent = false;
            const auto& c = registry.get<ecs::Canvas>(entity);
            ss << "        \"Canvas\": {\n";
            ss << "          \"designResolution\": [" << c.designResolution.x << ", " << c.designResolution.y << "],\n";
            ss << "          \"pixelsPerUnit\": " << c.pixelsPerUnit << ",\n";
            ss << "          \"scaleMode\": " << static_cast<int>(c.scaleMode) << ",\n";
            ss << "          \"matchWidthOrHeight\": " << c.matchWidthOrHeight << ",\n";
            ss << "          \"backgroundColor\": " << serializeVec4(c.backgroundColor) << "\n";
            ss << "        }";
        }

        // Tags
        std::vector<std::string> tags;
        if (registry.has<ecs::Active>(entity)) tags.push_back("Active");
        if (registry.has<ecs::Visible>(entity)) tags.push_back("Visible");
        if (registry.has<ecs::Static>(entity)) tags.push_back("Static");
        if (registry.has<ecs::Folder>(entity)) tags.push_back("Folder");
        if (registry.has<ecs::MainEntity>(entity)) tags.push_back("MainEntity");

        if (!tags.empty()) {
            if (!firstComponent) ss << ",\n";
            firstComponent = false;
            ss << "        \"tags\": [";
            for (usize i = 0; i < tags.size(); ++i) {
                if (i > 0) ss << ", ";
                ss << "\"" << tags[i] << "\"";
            }
            ss << "]";
        }

        // Scripts
        if (registry.has<ecs::Scripts>(entity)) {
            const auto& scripts = registry.get<ecs::Scripts>(entity);
            if (!scripts.instances.empty()) {
                if (!firstComponent) ss << ",\n";
                firstComponent = false;
                ss << "        \"scripts\": [\n";
                bool firstScript = true;
                for (const auto& inst : scripts.instances) {
                    if (!firstScript) ss << ",\n";
                    firstScript = false;
                    ss << "          {\n";
                    ss << "            \"name\": \"" << escapeJsonString(inst.componentName) << "\",\n";
                    ss << "            \"fields\": {\n";
                    bool firstField = true;
                    for (const auto& [fieldName, fieldValue] : inst.values) {
                        if (!firstField) ss << ",\n";
                        firstField = false;
                        ss << "              \"" << escapeJsonString(fieldName) << "\": ";
                        std::visit([&ss](auto&& arg) {
                            using T = std::decay_t<decltype(arg)>;
                            if constexpr (std::is_same_v<T, f32>) {
                                ss << arg;
                            } else if constexpr (std::is_same_v<T, i32>) {
                                ss << arg;
                            } else if constexpr (std::is_same_v<T, bool>) {
                                ss << (arg ? "true" : "false");
                            } else if constexpr (std::is_same_v<T, std::string>) {
                                ss << "\"" << escapeJsonString(arg) << "\"";
                            } else if constexpr (std::is_same_v<T, glm::vec2>) {
                                ss << "[" << arg.x << ", " << arg.y << "]";
                            } else if constexpr (std::is_same_v<T, glm::vec3>) {
                                ss << "[" << arg.x << ", " << arg.y << ", " << arg.z << "]";
                            } else if constexpr (std::is_same_v<T, glm::vec4>) {
                                ss << "[" << arg.x << ", " << arg.y << ", " << arg.z << ", " << arg.w << "]";
                            } else if constexpr (std::is_same_v<T, u32>) {
                                ss << arg;
                            }
                        }, fieldValue);
                    }
                    ss << "\n            }\n";
                    ss << "          }";
                }
                ss << "\n        ]";
            }
        }

        ss << "\n      }\n";
        ss << "    }";
    });

    ss << "\n  ]\n";
    ss << "}\n";

    // Write to file
    try {
        fs::path path(filePath);
        fs::create_directories(path.parent_path());

        std::ofstream file(filePath);
        if (!file) {
            ES_LOG_ERROR("Failed to open file for writing: {}", filePath);
            return false;
        }
        file << ss.str();
        file.close();

        ES_LOG_INFO("Scene saved successfully");
        return true;
    } catch (const std::exception& e) {
        ES_LOG_ERROR("Failed to save scene: {}", e.what());
        return false;
    }
}

bool SceneSerializer::loadScene(
    ecs::Registry& registry,
    const std::string& filePath
) {
    ES_LOG_INFO("Loading scene from: {}", filePath);

    // Read file
    std::ifstream file(filePath);
    if (!file) {
        ES_LOG_ERROR("Failed to open scene file: {}", filePath);
        return false;
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string json = buffer.str();
    file.close();

    if (json.empty()) {
        ES_LOG_ERROR("Scene file is empty");
        return false;
    }

    // Check version
    u32 version = static_cast<u32>(extractUInt(json, 0, "version"));
    if (version == 0 || version > SCENE_FORMAT_VERSION) {
        ES_LOG_ERROR("Unsupported scene format version: {}", version);
        return false;
    }

    // Clear existing entities
    clearScene(registry);

    // Parse entities
    std::unordered_map<u64, Entity> uuidToEntity;
    std::vector<std::pair<Entity, u64>> parentRelations;

    usize entityStart = 0;
    while ((entityStart = json.find("{", entityStart)) != std::string::npos) {
        // Skip the root object and "entities" array opening
        if (entityStart < json.find("\"entities\"")) {
            entityStart++;
            continue;
        }

        // Find entity block
        usize uuidPos = json.find("\"uuid\":", entityStart);
        if (uuidPos == std::string::npos) break;
        if (uuidPos > entityStart + 100) {  // Not this entity block
            entityStart++;
            continue;
        }

        // Find end of entity block
        usize depth = 1;
        usize blockEnd = entityStart + 1;
        while (depth > 0 && blockEnd < json.size()) {
            if (json[blockEnd] == '{') depth++;
            else if (json[blockEnd] == '}') depth--;
            blockEnd++;
        }

        std::string entityJson = json.substr(entityStart, blockEnd - entityStart);

        // Extract UUID
        u64 uuid = extractUInt(entityJson, 0, "uuid");
        if (uuid == 0) {
            entityStart = blockEnd;
            continue;
        }

        // Create entity
        Entity entity = registry.create();
        uuidToEntity[uuid] = entity;

        // Add UUID component
        registry.emplace<ecs::UUID>(entity, uuid);

        // Name
        std::string name = extractString(entityJson, 0, "name");
        if (!name.empty()) {
            registry.emplace<ecs::Name>(entity, name);
        }

        // Find components block
        usize componentsPos = entityJson.find("\"components\":");
        if (componentsPos != std::string::npos) {
            // LocalTransform
            usize transformPos = entityJson.find("\"LocalTransform\":", componentsPos);
            if (transformPos != std::string::npos) {
                ecs::LocalTransform t;
                t.position = extractVec3(entityJson, transformPos, "position");
                t.rotation = extractQuat(entityJson, transformPos, "rotation");
                t.scale = extractVec3(entityJson, transformPos, "scale");
                if (t.scale.x == 0.0f) t.scale.x = 1.0f;
                if (t.scale.y == 0.0f) t.scale.y = 1.0f;
                if (t.scale.z == 0.0f) t.scale.z = 1.0f;
                registry.emplace<ecs::LocalTransform>(entity, t);
            }

            // Parent (defer resolution)
            usize parentPos = entityJson.find("\"Parent\":", componentsPos);
            if (parentPos != std::string::npos) {
                u64 parentUUID = extractUInt(entityJson, parentPos, "uuid");
                if (parentUUID != 0) {
                    parentRelations.push_back({entity, parentUUID});
                }
            }

            // Sprite
            usize spritePos = entityJson.find("\"Sprite\":", componentsPos);
            if (spritePos != std::string::npos) {
                ecs::Sprite s;
                s.texture = resource::TextureHandle(static_cast<u32>(extractUInt(entityJson, spritePos, "texture")));
                s.color = extractVec4(entityJson, spritePos, "color");
                if (s.color.w == 0.0f) s.color = glm::vec4(1.0f);
                s.size = extractVec2(entityJson, spritePos, "size");
                if (s.size.x == 0.0f) s.size.x = 1.0f;
                if (s.size.y == 0.0f) s.size.y = 1.0f;
                s.uvOffset = extractVec2(entityJson, spritePos, "uvOffset");
                s.uvScale = extractVec2(entityJson, spritePos, "uvScale");
                if (s.uvScale.x == 0.0f) s.uvScale.x = 1.0f;
                if (s.uvScale.y == 0.0f) s.uvScale.y = 1.0f;
                s.layer = extractInt(entityJson, spritePos, "layer");
                s.flipX = extractBool(entityJson, spritePos, "flipX");
                s.flipY = extractBool(entityJson, spritePos, "flipY");
                registry.emplace<ecs::Sprite>(entity, s);
            }

            // Camera
            usize cameraPos = entityJson.find("\"Camera\":", componentsPos);
            if (cameraPos != std::string::npos) {
                ecs::Camera c;
                c.projectionType = static_cast<ecs::ProjectionType>(extractInt(entityJson, cameraPos, "projectionType"));
                c.fov = extractFloat(entityJson, cameraPos, "fov");
                if (c.fov == 0.0f) c.fov = 60.0f;
                c.orthoSize = extractFloat(entityJson, cameraPos, "orthoSize");
                if (c.orthoSize == 0.0f) c.orthoSize = 5.0f;
                c.nearPlane = extractFloat(entityJson, cameraPos, "nearPlane");
                if (c.nearPlane == 0.0f) c.nearPlane = 0.1f;
                c.farPlane = extractFloat(entityJson, cameraPos, "farPlane");
                if (c.farPlane == 0.0f) c.farPlane = 1000.0f;
                c.aspectRatio = extractFloat(entityJson, cameraPos, "aspectRatio");
                c.isActive = extractBool(entityJson, cameraPos, "isActive");
                c.priority = extractInt(entityJson, cameraPos, "priority");
                registry.emplace<ecs::Camera>(entity, c);
            }

            // Canvas
            usize canvasPos = entityJson.find("\"Canvas\":", componentsPos);
            if (canvasPos != std::string::npos) {
                ecs::Canvas c;
                glm::vec2 res = extractVec2(entityJson, canvasPos, "designResolution");
                c.designResolution = glm::uvec2(static_cast<u32>(res.x), static_cast<u32>(res.y));
                if (c.designResolution.x == 0) c.designResolution.x = 1920;
                if (c.designResolution.y == 0) c.designResolution.y = 1080;
                c.pixelsPerUnit = static_cast<u32>(extractUInt(entityJson, canvasPos, "pixelsPerUnit"));
                if (c.pixelsPerUnit == 0) c.pixelsPerUnit = 100;
                c.scaleMode = static_cast<ecs::CanvasScaleMode>(extractInt(entityJson, canvasPos, "scaleMode"));
                c.matchWidthOrHeight = extractFloat(entityJson, canvasPos, "matchWidthOrHeight");
                c.backgroundColor = extractVec4(entityJson, canvasPos, "backgroundColor");
                registry.emplace<ecs::Canvas>(entity, c);
            }

            // Tags
            usize tagsPos = entityJson.find("\"tags\":", componentsPos);
            if (tagsPos != std::string::npos) {
                if (entityJson.find("\"Active\"", tagsPos) != std::string::npos) {
                    registry.emplace<ecs::Active>(entity);
                }
                if (entityJson.find("\"Visible\"", tagsPos) != std::string::npos) {
                    registry.emplace<ecs::Visible>(entity);
                }
                if (entityJson.find("\"Static\"", tagsPos) != std::string::npos) {
                    registry.emplace<ecs::Static>(entity);
                }
                if (entityJson.find("\"Folder\"", tagsPos) != std::string::npos) {
                    registry.emplace<ecs::Folder>(entity);
                }
                if (entityJson.find("\"MainEntity\"", tagsPos) != std::string::npos) {
                    registry.emplace<ecs::MainEntity>(entity);
                }
            }

            // Scripts
            usize scriptsPos = entityJson.find("\"scripts\":", componentsPos);
            if (scriptsPos != std::string::npos) {
                usize scriptsArrayStart = entityJson.find("[", scriptsPos);
                usize scriptsArrayEnd = scriptsArrayStart;
                if (scriptsArrayStart != std::string::npos) {
                    int depth = 1;
                    scriptsArrayEnd = scriptsArrayStart + 1;
                    while (scriptsArrayEnd < entityJson.size() && depth > 0) {
                        if (entityJson[scriptsArrayEnd] == '[') depth++;
                        else if (entityJson[scriptsArrayEnd] == ']') depth--;
                        scriptsArrayEnd++;
                    }
                }

                ecs::Scripts scriptsComp;
                usize scriptObjStart = scriptsArrayStart;
                while ((scriptObjStart = entityJson.find("{", scriptObjStart + 1)) != std::string::npos &&
                       scriptObjStart < scriptsArrayEnd) {
                    usize scriptObjEnd = scriptObjStart + 1;
                    int objDepth = 1;
                    while (scriptObjEnd < entityJson.size() && objDepth > 0) {
                        if (entityJson[scriptObjEnd] == '{') objDepth++;
                        else if (entityJson[scriptObjEnd] == '}') objDepth--;
                        scriptObjEnd++;
                    }

                    std::string scriptObjJson = entityJson.substr(scriptObjStart, scriptObjEnd - scriptObjStart);
                    std::string scriptName = extractString(scriptObjJson, 0, "name");

                    if (!scriptName.empty()) {
                        ecs::ScriptInstance inst;
                        inst.componentName = scriptName;

                        usize fieldsPos = scriptObjJson.find("\"fields\":");
                        if (fieldsPos != std::string::npos) {
                            usize fieldsObjStart = scriptObjJson.find("{", fieldsPos);
                            if (fieldsObjStart != std::string::npos) {
                                usize fieldsObjEnd = fieldsObjStart + 1;
                                int fieldsDepth = 1;
                                while (fieldsObjEnd < scriptObjJson.size() && fieldsDepth > 0) {
                                    if (scriptObjJson[fieldsObjEnd] == '{') fieldsDepth++;
                                    else if (scriptObjJson[fieldsObjEnd] == '}') fieldsDepth--;
                                    fieldsObjEnd++;
                                }

                                std::string fieldsJson = scriptObjJson.substr(fieldsObjStart, fieldsObjEnd - fieldsObjStart);

                                // Parse fields - simplified parsing
                                usize fieldKeyPos = 0;
                                while ((fieldKeyPos = fieldsJson.find("\"", fieldKeyPos + 1)) != std::string::npos) {
                                    usize fieldKeyEnd = fieldsJson.find("\"", fieldKeyPos + 1);
                                    if (fieldKeyEnd == std::string::npos) break;

                                    std::string fieldKey = fieldsJson.substr(fieldKeyPos + 1, fieldKeyEnd - fieldKeyPos - 1);
                                    if (fieldKey.empty()) break;

                                    usize colonPos = fieldsJson.find(":", fieldKeyEnd);
                                    if (colonPos == std::string::npos) break;

                                    usize valueStart = colonPos + 1;
                                    while (valueStart < fieldsJson.size() && std::isspace(fieldsJson[valueStart])) valueStart++;
                                    if (valueStart >= fieldsJson.size()) break;

                                    // Determine value type and parse
                                    if (fieldsJson[valueStart] == '"') {
                                        // String value
                                        std::string val = extractString(fieldsJson, fieldKeyPos, fieldKey);
                                        inst.values[fieldKey] = val;
                                    } else if (fieldsJson[valueStart] == '[') {
                                        // Array (vec2/vec3/vec4)
                                        glm::vec4 vec = extractVec4(fieldsJson, fieldKeyPos, fieldKey);
                                        usize arrEnd = fieldsJson.find("]", valueStart);
                                        std::string arrContent = fieldsJson.substr(valueStart + 1, arrEnd - valueStart - 1);
                                        int commaCount = 0;
                                        for (char c : arrContent) if (c == ',') commaCount++;
                                        if (commaCount == 1) {
                                            inst.values[fieldKey] = glm::vec2(vec.x, vec.y);
                                        } else if (commaCount == 2) {
                                            inst.values[fieldKey] = glm::vec3(vec.x, vec.y, vec.z);
                                        } else {
                                            inst.values[fieldKey] = vec;
                                        }
                                    } else if (fieldsJson.substr(valueStart, 4) == "true") {
                                        inst.values[fieldKey] = true;
                                    } else if (fieldsJson.substr(valueStart, 5) == "false") {
                                        inst.values[fieldKey] = false;
                                    } else if (fieldsJson[valueStart] == '-' || std::isdigit(fieldsJson[valueStart])) {
                                        // Number (f32 or i32)
                                        std::string numStr;
                                        usize numEnd = valueStart;
                                        while (numEnd < fieldsJson.size() &&
                                               (std::isdigit(fieldsJson[numEnd]) || fieldsJson[numEnd] == '.' ||
                                                fieldsJson[numEnd] == '-' || fieldsJson[numEnd] == 'e' || fieldsJson[numEnd] == 'E')) {
                                            numEnd++;
                                        }
                                        numStr = fieldsJson.substr(valueStart, numEnd - valueStart);
                                        if (numStr.find('.') != std::string::npos || numStr.find('e') != std::string::npos) {
                                            try { inst.values[fieldKey] = std::stof(numStr); } catch (...) {}
                                        } else {
                                            try { inst.values[fieldKey] = std::stoi(numStr); } catch (...) {}
                                        }
                                    }

                                    fieldKeyPos = fieldsJson.find(",", valueStart);
                                    if (fieldKeyPos == std::string::npos) break;
                                }
                            }
                        }

                        scriptsComp.instances.push_back(std::move(inst));
                    }

                    scriptObjStart = scriptObjEnd;
                }

                if (!scriptsComp.instances.empty()) {
                    registry.emplace<ecs::Scripts>(entity, std::move(scriptsComp));
                }
            }
        }

        entityStart = blockEnd;
    }

    // Resolve parent relationships
    for (const auto& [entity, parentUUID] : parentRelations) {
        auto it = uuidToEntity.find(parentUUID);
        if (it != uuidToEntity.end()) {
            Entity parentEntity = it->second;
            registry.emplace<ecs::Parent>(entity, parentEntity);

            // Add to parent's children
            if (!registry.has<ecs::Children>(parentEntity)) {
                registry.emplace<ecs::Children>(parentEntity);
            }
            registry.get<ecs::Children>(parentEntity).entities.push_back(entity);
        }
    }

    ES_LOG_INFO("Scene loaded successfully ({} entities)", uuidToEntity.size());
    return true;
}

void SceneSerializer::clearScene(ecs::Registry& registry) {
    std::vector<Entity> toDestroy;
    registry.forEachEntity([&](Entity entity) {
        toDestroy.push_back(entity);
    });
    for (Entity entity : toDestroy) {
        registry.destroy(entity);
    }
}

std::string SceneSerializer::getSceneName(const std::string& filePath) {
    fs::path path(filePath);
    return path.stem().string();
}

}  // namespace esengine::editor
