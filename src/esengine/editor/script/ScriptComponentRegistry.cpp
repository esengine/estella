/**
 * @file    ScriptComponentRegistry.cpp
 * @brief   Script component registry implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ScriptComponentRegistry.hpp"
#include "../../core/Log.hpp"
#include "../../platform/FileSystem.hpp"

#include <filesystem>
#include <regex>
#include <sstream>

namespace fs = std::filesystem;

namespace esengine::editor {

// =============================================================================
// Type Mappings
// =============================================================================

namespace {

const std::unordered_map<std::string, ScriptFieldType> TYPE_MAP = {
    {"Type.f32", ScriptFieldType::F32},
    {"Type.i32", ScriptFieldType::I32},
    {"Type.bool", ScriptFieldType::Bool},
    {"Type.string", ScriptFieldType::String},
    {"Type.String", ScriptFieldType::String},
    {"Type.Vec2", ScriptFieldType::Vec2},
    {"Type.Vec3", ScriptFieldType::Vec3},
    {"Type.Vec4", ScriptFieldType::Vec4},
    {"Type.Color", ScriptFieldType::Color},
    {"Type.Entity", ScriptFieldType::Entity},
};

ScriptFieldValue getDefaultValue(ScriptFieldType type) {
    switch (type) {
        case ScriptFieldType::F32: return 0.0f;
        case ScriptFieldType::I32: return 0;
        case ScriptFieldType::Bool: return false;
        case ScriptFieldType::String: return std::string{};
        case ScriptFieldType::Vec2: return glm::vec2(0.0f);
        case ScriptFieldType::Vec3: return glm::vec3(0.0f);
        case ScriptFieldType::Vec4:
        case ScriptFieldType::Color: return glm::vec4(1.0f);
        case ScriptFieldType::Entity: return static_cast<u32>(0);
    }
    return 0.0f;
}

std::string trim(const std::string& str) {
    usize start = str.find_first_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    usize end = str.find_last_not_of(" \t\n\r");
    return str.substr(start, end - start + 1);
}

}  // namespace

// =============================================================================
// ScriptComponentRegistry Implementation
// =============================================================================

bool ScriptComponentRegistry::scanProject(const std::string& projectPath) {
    projectPath_ = projectPath;
    return rescan();
}

bool ScriptComponentRegistry::rescan() {
    if (projectPath_.empty()) {
        return false;
    }

    components_.clear();
    nameToIndex_.clear();

    std::string srcDir = projectPath_ + "/src";
    if (!fs::exists(srcDir)) {
        ES_LOG_DEBUG("No src directory found at {}", srcDir);
        return true;
    }

    auto tsFiles = findTypeScriptFiles(srcDir);
    ES_LOG_DEBUG("Found {} TypeScript files in {}", tsFiles.size(), srcDir);

    for (const auto& file : tsFiles) {
        parseFile(file);
    }

    ES_LOG_INFO("Discovered {} script components from TypeScript source", components_.size());
    return true;
}

std::vector<std::string> ScriptComponentRegistry::findTypeScriptFiles(const std::string& dir) {
    std::vector<std::string> files;

    try {
        for (const auto& entry : fs::recursive_directory_iterator(dir)) {
            if (entry.is_regular_file()) {
                std::string ext = entry.path().extension().string();
                if (ext == ".ts" || ext == ".tsx") {
                    // Skip node_modules and build directories
                    std::string pathStr = entry.path().string();
                    if (pathStr.find("node_modules") == std::string::npos &&
                        pathStr.find("/build/") == std::string::npos &&
                        pathStr.find("\\build\\") == std::string::npos) {
                        files.push_back(pathStr);
                    }
                }
            }
        }
    } catch (const std::exception& e) {
        ES_LOG_WARN("Error scanning directory {}: {}", dir, e.what());
    }

    return files;
}

usize ScriptComponentRegistry::parseFile(const std::string& filePath) {
    std::string source = FileSystem::readTextFile(filePath);
    if (source.empty()) {
        return 0;
    }

    usize found = 0;
    usize pos = 0;

    // Find all defineComponent calls
    while ((pos = source.find("defineComponent", pos)) != std::string::npos) {
        // Make sure it's not part of a larger identifier
        if (pos > 0) {
            char prev = source[pos - 1];
            if (std::isalnum(prev) || prev == '_') {
                pos++;
                continue;
            }
        }

        ScriptComponentDef def;
        def.sourceFile = filePath;

        if (parseDefineComponent(source, pos, def)) {
            if (!def.name.empty() && !def.fields.empty()) {
                // Check for duplicates
                if (nameToIndex_.find(def.name) == nameToIndex_.end()) {
                    nameToIndex_[def.name] = components_.size();
                    components_.push_back(std::move(def));
                    found++;
                } else {
                    ES_LOG_WARN("Duplicate component '{}' in {}", def.name, filePath);
                }
            }
        }

        pos++;
    }

    if (found > 0) {
        std::string relPath = fs::relative(filePath, projectPath_).string();
        ES_LOG_DEBUG("  {}: {} component(s)", relPath, found);
    }

    return found;
}

usize ScriptComponentRegistry::findMatchingBrace(const std::string& source, usize openPos, char open, char close) {
    if (openPos >= source.size() || source[openPos] != open) {
        return std::string::npos;
    }

    int depth = 1;
    usize pos = openPos + 1;
    bool inString = false;
    char stringChar = 0;

    while (pos < source.size() && depth > 0) {
        char c = source[pos];

        // Handle string literals
        if (!inString && (c == '"' || c == '\'' || c == '`')) {
            inString = true;
            stringChar = c;
        } else if (inString && c == stringChar && (pos == 0 || source[pos - 1] != '\\')) {
            inString = false;
        } else if (!inString) {
            if (c == open) depth++;
            else if (c == close) depth--;
        }

        pos++;
    }

    return depth == 0 ? pos : std::string::npos;
}

bool ScriptComponentRegistry::parseDefineComponent(const std::string& source, usize pos, ScriptComponentDef& outDef) {
    // Skip "defineComponent"
    pos += 15;

    // Skip whitespace
    while (pos < source.size() && std::isspace(source[pos])) pos++;

    // Expect (
    if (pos >= source.size() || source[pos] != '(') return false;
    pos++;

    // Skip whitespace
    while (pos < source.size() && std::isspace(source[pos])) pos++;

    // Expect { for schema
    if (pos >= source.size() || source[pos] != '{') return false;

    usize schemaStart = pos;
    usize schemaEnd = findMatchingBrace(source, schemaStart, '{', '}');
    if (schemaEnd == std::string::npos) return false;

    // Parse schema
    if (!parseSchema(source, schemaStart + 1, schemaEnd - 1, outDef.fields)) {
        return false;
    }

    pos = schemaEnd;

    // Skip whitespace and comma
    while (pos < source.size() && (std::isspace(source[pos]) || source[pos] == ',')) pos++;

    // Check for defaults object or name string
    if (pos < source.size() && source[pos] == '{') {
        usize defaultsStart = pos;
        usize defaultsEnd = findMatchingBrace(source, defaultsStart, '{', '}');
        if (defaultsEnd != std::string::npos) {
            parseDefaults(source, defaultsStart + 1, defaultsEnd - 1, outDef.fields);
            pos = defaultsEnd;
        }
    }

    // Skip whitespace and comma
    while (pos < source.size() && (std::isspace(source[pos]) || source[pos] == ',')) pos++;

    // Look for component name as string argument
    if (pos < source.size() && (source[pos] == '\'' || source[pos] == '"')) {
        char quote = source[pos];
        usize nameStart = pos + 1;
        usize nameEnd = source.find(quote, nameStart);
        if (nameEnd != std::string::npos) {
            outDef.name = source.substr(nameStart, nameEnd - nameStart);
        }
    }

    // If no explicit name, try to find variable name: const Foo = defineComponent(...)
    if (outDef.name.empty()) {
        // Search backwards for "const NAME = " or "export const NAME = "
        usize searchStart = source.rfind("const ", pos > 100 ? pos - 100 : 0);
        if (searchStart != std::string::npos && searchStart < pos) {
            usize nameStart = searchStart + 6;
            while (nameStart < pos && std::isspace(source[nameStart])) nameStart++;

            usize nameEnd = nameStart;
            while (nameEnd < pos && (std::isalnum(source[nameEnd]) || source[nameEnd] == '_')) nameEnd++;

            if (nameEnd > nameStart) {
                std::string varName = source.substr(nameStart, nameEnd - nameStart);
                // Verify this is followed by " = defineComponent"
                usize afterName = nameEnd;
                while (afterName < pos && std::isspace(source[afterName])) afterName++;
                if (afterName < pos && source[afterName] == '=') {
                    outDef.name = varName;
                }
            }
        }
    }

    return !outDef.name.empty();
}

bool ScriptComponentRegistry::parseSchema(const std::string& source, usize start, usize end,
                                          std::vector<ScriptFieldDef>& outFields) {
    std::string content = source.substr(start, end - start);

    // Match patterns like "fieldName: Type.xxx" or "fieldName : Type.xxx"
    std::regex fieldRegex(R"((\w+)\s*:\s*(Type\.\w+))");
    std::smatch match;
    std::string::const_iterator searchStart = content.cbegin();

    while (std::regex_search(searchStart, content.cend(), match, fieldRegex)) {
        std::string fieldName = match[1].str();
        std::string typeStr = match[2].str();

        auto it = TYPE_MAP.find(typeStr);
        if (it != TYPE_MAP.end()) {
            ScriptFieldDef field;
            field.name = fieldName;
            field.type = it->second;
            field.defaultValue = getDefaultValue(it->second);
            outFields.push_back(std::move(field));
        } else {
            ES_LOG_WARN("Unknown type '{}' for field '{}'", typeStr, fieldName);
        }

        searchStart = match.suffix().first;
    }

    return !outFields.empty();
}

void ScriptComponentRegistry::parseDefaults(const std::string& source, usize start, usize end,
                                            std::vector<ScriptFieldDef>& fields) {
    std::string content = source.substr(start, end - start);

    for (auto& field : fields) {
        // Look for "fieldName: value" pattern
        std::regex valueRegex(field.name + R"(\s*:\s*([^,}]+))");
        std::smatch match;

        if (std::regex_search(content, match, valueRegex)) {
            std::string valueStr = trim(match[1].str());

            switch (field.type) {
                case ScriptFieldType::F32:
                    try { field.defaultValue = std::stof(valueStr); } catch (...) {}
                    break;
                case ScriptFieldType::I32:
                    try { field.defaultValue = std::stoi(valueStr); } catch (...) {}
                    break;
                case ScriptFieldType::Bool:
                    field.defaultValue = (valueStr == "true");
                    break;
                case ScriptFieldType::String:
                    if ((valueStr.front() == '\'' || valueStr.front() == '"') &&
                        valueStr.size() >= 2) {
                        field.defaultValue = valueStr.substr(1, valueStr.size() - 2);
                    }
                    break;
                default:
                    break;
            }
        }
    }
}

const ScriptComponentDef* ScriptComponentRegistry::getComponent(const std::string& name) const {
    auto it = nameToIndex_.find(name);
    if (it == nameToIndex_.end()) return nullptr;
    return &components_[it->second];
}

bool ScriptComponentRegistry::hasComponent(const std::string& name) const {
    return nameToIndex_.count(name) > 0;
}

std::optional<ScriptComponentInstance> ScriptComponentRegistry::createInstance(const std::string& name) const {
    const auto* def = getComponent(name);
    if (!def) return std::nullopt;

    ScriptComponentInstance instance;
    instance.componentName = name;

    for (const auto& field : def->fields) {
        instance.values[field.name] = field.defaultValue;
    }

    return instance;
}

std::string ScriptComponentRegistry::fieldTypeToString(ScriptFieldType type) {
    switch (type) {
        case ScriptFieldType::F32: return "f32";
        case ScriptFieldType::I32: return "i32";
        case ScriptFieldType::Bool: return "bool";
        case ScriptFieldType::String: return "string";
        case ScriptFieldType::Vec2: return "Vec2";
        case ScriptFieldType::Vec3: return "Vec3";
        case ScriptFieldType::Vec4: return "Vec4";
        case ScriptFieldType::Color: return "Color";
        case ScriptFieldType::Entity: return "Entity";
    }
    return "f32";
}

ScriptFieldType ScriptComponentRegistry::stringToFieldType(const std::string& str) {
    if (str == "f32") return ScriptFieldType::F32;
    if (str == "i32") return ScriptFieldType::I32;
    if (str == "bool") return ScriptFieldType::Bool;
    if (str == "string") return ScriptFieldType::String;
    if (str == "Vec2") return ScriptFieldType::Vec2;
    if (str == "Vec3") return ScriptFieldType::Vec3;
    if (str == "Vec4") return ScriptFieldType::Vec4;
    if (str == "Color") return ScriptFieldType::Color;
    if (str == "Entity") return ScriptFieldType::Entity;
    return ScriptFieldType::F32;
}

std::string ScriptComponentRegistry::serializeValue(const ScriptFieldValue& value, ScriptFieldType type) {
    std::ostringstream ss;
    switch (type) {
        case ScriptFieldType::F32:
            ss << std::get<f32>(value);
            break;
        case ScriptFieldType::I32:
            ss << std::get<i32>(value);
            break;
        case ScriptFieldType::Bool:
            ss << (std::get<bool>(value) ? "true" : "false");
            break;
        case ScriptFieldType::String:
            ss << "\"" << std::get<std::string>(value) << "\"";
            break;
        case ScriptFieldType::Vec2: {
            auto v = std::get<glm::vec2>(value);
            ss << "[" << v.x << ", " << v.y << "]";
            break;
        }
        case ScriptFieldType::Vec3: {
            auto v = std::get<glm::vec3>(value);
            ss << "[" << v.x << ", " << v.y << ", " << v.z << "]";
            break;
        }
        case ScriptFieldType::Vec4:
        case ScriptFieldType::Color: {
            auto v = std::get<glm::vec4>(value);
            ss << "[" << v.x << ", " << v.y << ", " << v.z << ", " << v.w << "]";
            break;
        }
        case ScriptFieldType::Entity:
            ss << std::get<u32>(value);
            break;
    }
    return ss.str();
}

ScriptFieldValue ScriptComponentRegistry::parseValue(const std::string& json, ScriptFieldType type) {
    switch (type) {
        case ScriptFieldType::F32:
            try { return std::stof(json); } catch (...) { return 0.0f; }
        case ScriptFieldType::I32:
            try { return std::stoi(json); } catch (...) { return 0; }
        case ScriptFieldType::Bool:
            return json.find("true") != std::string::npos;
        case ScriptFieldType::String:
            return json;
        case ScriptFieldType::Vec2:
            return glm::vec2(0.0f);
        case ScriptFieldType::Vec3:
            return glm::vec3(0.0f);
        case ScriptFieldType::Vec4:
        case ScriptFieldType::Color:
            return glm::vec4(1.0f);
        case ScriptFieldType::Entity:
            try { return static_cast<u32>(std::stoul(json)); } catch (...) { return 0u; }
    }
    return 0.0f;
}

}  // namespace esengine::editor
