/**
 * @file    ProjectSerializer.cpp
 * @brief   Project file JSON serialization implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ProjectSerializer.hpp"
#include "../../core/Log.hpp"

#include <sstream>

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
    while (valueStart < json.size() && !std::isdigit(json[valueStart])) {
        ++valueStart;
    }
    if (valueStart >= json.size()) return 0;

    try {
        return std::stoull(json.substr(valueStart));
    } catch (...) {
        return 0;
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

std::vector<std::string> extractStringArray(const std::string& json, usize startPos,
                                             const std::string& key) {
    std::vector<std::string> result;
    std::string searchKey = "\"" + key + "\":";
    usize keyPos = json.find(searchKey, startPos);
    if (keyPos == std::string::npos) return result;

    usize arrayStart = json.find("[", keyPos);
    usize arrayEnd = json.find("]", arrayStart);
    if (arrayStart == std::string::npos || arrayEnd == std::string::npos) return result;

    std::string arrayContent = json.substr(arrayStart + 1, arrayEnd - arrayStart - 1);
    usize pos = 0;
    while ((pos = arrayContent.find("\"", pos)) != std::string::npos) {
        usize endPos = pos + 1;
        while (endPos < arrayContent.size()) {
            if (arrayContent[endPos] == '"' && arrayContent[endPos - 1] != '\\') break;
            ++endPos;
        }
        if (endPos < arrayContent.size()) {
            result.push_back(unescapeJsonString(arrayContent.substr(pos + 1, endPos - pos - 1)));
        }
        pos = endPos + 1;
    }
    return result;
}

}  // namespace

// =============================================================================
// Project Serialization
// =============================================================================

std::string ProjectSerializer::serialize(const ProjectInfo& project) {
    std::stringstream ss;

    ss << "{\n";
    ss << "  \"version\": " << project.formatVersion << ",\n";
    ss << "  \"name\": \"" << escapeJsonString(project.name) << "\",\n";
    ss << "  \"engineVersion\": \"" << escapeJsonString(project.engineVersion) << "\",\n";
    ss << "  \"created\": " << project.created << ",\n";
    ss << "  \"lastOpened\": " << project.lastOpened << ",\n";

    ss << "  \"settings\": {\n";

    ss << "    \"targetPlatforms\": [";
    for (usize i = 0; i < project.settings.targetPlatforms.size(); ++i) {
        if (i > 0) ss << ", ";
        ss << "\"" << targetPlatformToString(project.settings.targetPlatforms[i]) << "\"";
    }
    ss << "],\n";

    ss << "    \"defaultScene\": \"" << escapeJsonString(project.settings.defaultScene) << "\",\n";

    ss << "    \"renderer\": {\n";
    ss << "      \"defaultWidth\": " << project.settings.renderer.defaultWidth << ",\n";
    ss << "      \"defaultHeight\": " << project.settings.renderer.defaultHeight << ",\n";
    ss << "      \"vsync\": " << (project.settings.renderer.vsync ? "true" : "false") << "\n";
    ss << "    }\n";

    ss << "  }\n";
    ss << "}\n";

    return ss.str();
}

bool ProjectSerializer::deserialize(const std::string& json, ProjectInfo& outProject) {
    if (json.empty()) {
        ES_LOG_ERROR("ProjectSerializer: Empty JSON");
        return false;
    }

    outProject.formatVersion = static_cast<u32>(extractUInt(json, 0, "version"));
    outProject.name = extractString(json, 0, "name");
    outProject.engineVersion = extractString(json, 0, "engineVersion");
    outProject.created = extractUInt(json, 0, "created");
    outProject.lastOpened = extractUInt(json, 0, "lastOpened");

    if (outProject.name.empty()) {
        ES_LOG_ERROR("ProjectSerializer: Missing project name");
        return false;
    }

    usize settingsPos = json.find("\"settings\":");
    if (settingsPos != std::string::npos) {
        auto platforms = extractStringArray(json, settingsPos, "targetPlatforms");
        outProject.settings.targetPlatforms.clear();
        for (const auto& p : platforms) {
            outProject.settings.targetPlatforms.push_back(targetPlatformFromString(p));
        }

        outProject.settings.defaultScene = extractString(json, settingsPos, "defaultScene");

        usize rendererPos = json.find("\"renderer\":", settingsPos);
        if (rendererPos != std::string::npos) {
            outProject.settings.renderer.defaultWidth =
                static_cast<u32>(extractUInt(json, rendererPos, "defaultWidth"));
            outProject.settings.renderer.defaultHeight =
                static_cast<u32>(extractUInt(json, rendererPos, "defaultHeight"));
            outProject.settings.renderer.vsync = extractBool(json, rendererPos, "vsync");

            if (outProject.settings.renderer.defaultWidth == 0) {
                outProject.settings.renderer.defaultWidth = 1280;
            }
            if (outProject.settings.renderer.defaultHeight == 0) {
                outProject.settings.renderer.defaultHeight = 720;
            }
        }
    }

    return true;
}

// =============================================================================
// Recent Projects Serialization
// =============================================================================

std::string ProjectSerializer::serializeRecentProjects(
    const std::vector<RecentProject>& projects) {
    std::stringstream ss;

    ss << "{\n";
    ss << "  \"version\": 1,\n";
    ss << "  \"projects\": [\n";

    for (usize i = 0; i < projects.size(); ++i) {
        const auto& p = projects[i];
        ss << "    {\n";
        ss << "      \"path\": \"" << escapeJsonString(p.path) << "\",\n";
        ss << "      \"name\": \"" << escapeJsonString(p.name) << "\",\n";
        ss << "      \"lastOpened\": " << p.lastOpened << "\n";
        ss << "    }";
        if (i + 1 < projects.size()) ss << ",";
        ss << "\n";
    }

    ss << "  ]\n";
    ss << "}\n";

    return ss.str();
}

bool ProjectSerializer::deserializeRecentProjects(
    const std::string& json, std::vector<RecentProject>& outProjects) {
    outProjects.clear();

    if (json.empty()) {
        return false;
    }

    usize pos = 0;
    while ((pos = json.find("\"path\":", pos)) != std::string::npos) {
        RecentProject project;
        project.path = extractString(json, pos, "path");
        project.name = extractString(json, pos, "name");
        project.lastOpened = extractUInt(json, pos, "lastOpened");

        if (!project.path.empty()) {
            outProjects.push_back(std::move(project));
        }

        usize nextBrace = json.find("}", pos);
        if (nextBrace == std::string::npos) break;
        pos = nextBrace + 1;
    }

    return true;
}

}  // namespace esengine::editor
