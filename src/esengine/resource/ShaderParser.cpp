/**
 * @file    ShaderParser.cpp
 * @brief   Parser for unified .esshader file format
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ShaderParser.hpp"
#include "../core/Log.hpp"

#include <sstream>
#include <algorithm>
#include <cctype>
#include <unordered_set>

namespace esengine::resource {

// =============================================================================
// Include Expansion
// =============================================================================

namespace {

constexpr u32 kMaxIncludeDepth = 16;

std::string ltrim(const std::string& s) {
    usize start = s.find_first_not_of(" \t");
    return start == std::string::npos ? std::string() : s.substr(start);
}

bool expandIncludes(const std::string& source,
                    const std::string& currentFile,
                    const ShaderIncludeResolver& resolver,
                    std::unordered_set<std::string>& active,
                    u32 depth,
                    std::string& out,
                    std::vector<SourceLine>& outMap,
                    std::string& errorMessage) {
    if (depth > kMaxIncludeDepth) {
        errorMessage = "Shader include depth exceeded " + std::to_string(kMaxIncludeDepth);
        return false;
    }

    std::istringstream stream(source);
    std::string line;
    u32 lineNumber = 0;
    while (std::getline(stream, line)) {
        ++lineNumber;
        const std::string lead = ltrim(line);
        if (lead.rfind("#include", 0) != 0) {
            out += line;
            out += '\n';
            outMap.push_back(SourceLine{currentFile, lineNumber});
            continue;
        }

        const usize q1 = lead.find('"');
        const usize q2 = (q1 == std::string::npos) ? std::string::npos : lead.find('"', q1 + 1);
        if (q1 == std::string::npos || q2 == std::string::npos || q2 <= q1 + 1) {
            errorMessage = "Malformed #include directive: " + line;
            return false;
        }
        const std::string path = lead.substr(q1 + 1, q2 - q1 - 1);

        if (!resolver) {
            errorMessage = "#include \"" + path + "\" used but no include resolver was provided";
            return false;
        }
        if (active.count(path) != 0) {
            errorMessage = "Circular #include of \"" + path + "\"";
            return false;
        }
        std::optional<std::string> contents = resolver(path);
        if (!contents) {
            errorMessage = "Could not resolve #include \"" + path + "\"";
            return false;
        }

        active.insert(path);
        if (!expandIncludes(*contents, path, resolver, active, depth + 1, out, outMap, errorMessage)) {
            return false;
        }
        active.erase(path);
    }
    return true;
}

}  // namespace

// =============================================================================
// Parser State
// =============================================================================

enum class ParseState {
    Global,
    Properties,
    Vertex,
    Fragment,
    Variant
};

// =============================================================================
// Public Methods
// =============================================================================

ParsedShader ShaderParser::parse(const std::string& source) {
    return parse(source, ShaderIncludeResolver{});
}

ParsedShader ShaderParser::parse(const std::string& source, const ShaderIncludeResolver& resolver) {
    ParsedShader result;
    result.valid = false;

    if (source.empty()) {
        result.errorMessage = "Empty shader source";
        return result;
    }

    std::string expanded;
    {
        std::unordered_set<std::string> active;
        std::string includeError;
        if (!expandIncludes(source, std::string{}, resolver, active, 0,
                            expanded, result.expandedLineMap, includeError)) {
            result.errorMessage = includeError;
            return result;
        }
    }

    std::istringstream stream(expanded);
    std::string line;
    ParseState state = ParseState::Global;
    std::string currentVariantName;
    std::ostringstream currentSection;
    std::vector<SourceLine> currentSectionMap;
    u32 lineNumber = 0;

    while (std::getline(stream, line)) {
        lineNumber++;
        std::string directive, argument;
        parseDirective(line, directive, argument);

        if (directive == "shader") {
            if (argument.size() >= 2 && argument.front() == '"' && argument.back() == '"') {
                result.name = argument.substr(1, argument.size() - 2);
            } else {
                result.name = argument;
            }
            continue;
        }

        if (directive == "version") {
            result.version = argument;
            continue;
        }

        if (directive == "properties") {
            if (state != ParseState::Global) {
                result.errorMessage = "Unexpected #pragma properties at line " + std::to_string(lineNumber);
                return result;
            }
            state = ParseState::Properties;
            continue;
        }

        if (directive == "vertex") {
            if (state != ParseState::Global) {
                result.errorMessage = "Unexpected #pragma vertex at line " + std::to_string(lineNumber);
                return result;
            }
            state = ParseState::Vertex;
            currentSection.str("");
            currentSection.clear();
            currentSectionMap.clear();
            continue;
        }

        if (directive == "fragment") {
            if (state != ParseState::Global) {
                result.errorMessage = "Unexpected #pragma fragment at line " + std::to_string(lineNumber);
                return result;
            }
            state = ParseState::Fragment;
            currentSection.str("");
            currentSection.clear();
            currentSectionMap.clear();
            continue;
        }

        if (directive == "variant") {
            if (state != ParseState::Global) {
                result.errorMessage = "Unexpected #pragma variant at line " + std::to_string(lineNumber);
                return result;
            }
            state = ParseState::Variant;
            currentVariantName = argument;
            currentSection.str("");
            currentSection.clear();
            currentSectionMap.clear();
            continue;
        }

        if (directive == "end") {
            switch (state) {
                case ParseState::Properties:
                    break;
                case ParseState::Vertex:
                    result.stages[ShaderStage::Vertex] = currentSection.str();
                    result.stageLineMaps[ShaderStage::Vertex] = std::move(currentSectionMap);
                    currentSectionMap.clear();
                    break;
                case ParseState::Fragment:
                    result.stages[ShaderStage::Fragment] = currentSection.str();
                    result.stageLineMaps[ShaderStage::Fragment] = std::move(currentSectionMap);
                    currentSectionMap.clear();
                    break;
                case ParseState::Variant:
                    result.variants[currentVariantName] = currentSection.str();
                    currentVariantName.clear();
                    currentSectionMap.clear();
                    break;
                default:
                    break;
            }
            state = ParseState::Global;
            continue;
        }

        switch (state) {
            case ParseState::Global:
                if (!trim(line).empty() && line[0] != '/' && trim(line).substr(0, 2) != "//") {
                    result.sharedCode += line + "\n";
                }
                break;

            case ParseState::Properties: {
                std::string trimmedLine = trim(line);
                if (!trimmedLine.empty() && trimmedLine.find("uniform") != std::string::npos) {
                    ShaderProperty prop = parsePropertyAnnotation(line);
                    if (!prop.name.empty()) {
                        result.properties.push_back(prop);
                    }
                }
                break;
            }

            case ParseState::Vertex:
            case ParseState::Fragment:
            case ParseState::Variant: {
                currentSection << line << "\n";
                const SourceLine src = (lineNumber >= 1 && lineNumber <= result.expandedLineMap.size())
                    ? result.expandedLineMap[lineNumber - 1]
                    : SourceLine{};
                currentSectionMap.push_back(src);
                break;
            }
        }
    }

    if (state != ParseState::Global) {
        result.errorMessage = "Unexpected end of file - missing #pragma end";
        return result;
    }

    if (result.stages.find(ShaderStage::Vertex) == result.stages.end()) {
        result.errorMessage = "Missing vertex shader stage";
        return result;
    }

    if (result.stages.find(ShaderStage::Fragment) == result.stages.end()) {
        result.errorMessage = "Missing fragment shader stage";
        return result;
    }

    result.valid = true;
    return result;
}

std::string ShaderParser::assembleStage(const ParsedShader& parsed,
                                        ShaderStage stage,
                                        const std::string& platform) {
    if (!parsed.valid) {
        return "";
    }

    auto stageIt = parsed.stages.find(stage);
    if (stageIt == parsed.stages.end()) {
        return "";
    }

    std::ostringstream assembled;

    if (!parsed.version.empty()) {
        assembled << "#version " << parsed.version << "\n";
    }

    if (!platform.empty()) {
        auto variantIt = parsed.variants.find(platform);
        if (variantIt != parsed.variants.end()) {
            assembled << variantIt->second;
        }
    }

    if (!parsed.sharedCode.empty()) {
        assembled << parsed.sharedCode;
    }

    assembled << stageIt->second;

    return assembled.str();
}

namespace {

std::string formatRemap(u32 logLine,
                        const std::vector<SourceLine>& stageMap,
                        u32 headerLineOffset,
                        bool parenStyle) {
    if (logLine <= headerLineOffset) return {};
    const u32 bodyLine = logLine - headerLineOffset;
    if (bodyLine == 0 || bodyLine > stageMap.size()) return {};
    const SourceLine& src = stageMap[bodyLine - 1];
    const std::string file = src.file.empty() ? std::string("<main>") : src.file;
    std::string out;
    if (parenStyle) {
        out = file + "(" + std::to_string(src.line) + ")";
    } else {
        out = file + ":" + std::to_string(src.line) + ":";
    }
    return out;
}

bool scanNumber(const std::string& log, usize start, usize& outEnd, u32& outNumber) {
    u32 num = 0;
    usize j = start;
    bool any = false;
    while (j < log.size() && std::isdigit(static_cast<unsigned char>(log[j]))) {
        num = num * 10 + static_cast<u32>(log[j] - '0');
        ++j;
        any = true;
    }
    if (!any) return false;
    outEnd = j;
    outNumber = num;
    return true;
}

}  // namespace

std::string ShaderParser::remapCompilerLog(const std::string& log,
                                           const std::vector<SourceLine>& stageMap,
                                           u32 headerLineOffset) {
    if (log.empty() || stageMap.empty()) return log;

    auto isWordChar = [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
    };

    std::string out;
    out.reserve(log.size());
    const usize n = log.size();
    usize i = 0;
    while (i < n) {
        const bool boundary = (i == 0) || !isWordChar(log[i - 1]);
        if (boundary && i + 2 < n && log[i] == '0' && log[i + 1] == ':') {
            usize end = 0;
            u32 num = 0;
            if (scanNumber(log, i + 2, end, num) && end < n && log[end] == ':') {
                std::string rep = formatRemap(num, stageMap, headerLineOffset, /*parenStyle*/ false);
                if (!rep.empty()) {
                    out += rep;
                    i = end + 1;
                    continue;
                }
            }
        }
        if (boundary && i + 2 < n && log[i] == '0' && log[i + 1] == '(') {
            usize end = 0;
            u32 num = 0;
            if (scanNumber(log, i + 2, end, num) && end < n && log[end] == ')') {
                std::string rep = formatRemap(num, stageMap, headerLineOffset, /*parenStyle*/ true);
                if (!rep.empty()) {
                    out += rep;
                    i = end + 1;
                    continue;
                }
            }
        }
        out += log[i++];
    }
    return out;
}

// =============================================================================
// Private Methods
// =============================================================================

void ShaderParser::parseDirective(const std::string& line,
                                  std::string& directive,
                                  std::string& argument) {
    directive.clear();
    argument.clear();

    std::string trimmedLine = trim(line);
    if (trimmedLine.substr(0, 7) != "#pragma") {
        return;
    }

    std::string rest = trim(trimmedLine.substr(7));
    if (rest.empty()) {
        return;
    }

    usize spacePos = rest.find_first_of(" \t");
    if (spacePos == std::string::npos) {
        directive = rest;
    } else {
        directive = rest.substr(0, spacePos);
        argument = trim(rest.substr(spacePos + 1));
    }
}

ShaderProperty ShaderParser::parsePropertyAnnotation(const std::string& line) {
    ShaderProperty prop;

    usize uniformPos = line.find("uniform");
    if (uniformPos == std::string::npos) {
        return prop;
    }

    std::string afterUniform = trim(line.substr(uniformPos + 7));
    usize spacePos = afterUniform.find_first_of(" \t");
    if (spacePos == std::string::npos) {
        return prop;
    }

    std::string glslType = afterUniform.substr(0, spacePos);
    std::string rest = trim(afterUniform.substr(spacePos));

    usize semicolonPos = rest.find(';');
    if (semicolonPos == std::string::npos) {
        return prop;
    }

    prop.name = trim(rest.substr(0, semicolonPos));

    if (glslType == "float") {
        prop.type = ShaderPropertyType::Float;
    } else if (glslType == "vec2") {
        prop.type = ShaderPropertyType::Vec2;
    } else if (glslType == "vec3") {
        prop.type = ShaderPropertyType::Vec3;
    } else if (glslType == "vec4") {
        prop.type = ShaderPropertyType::Vec4;
    } else if (glslType == "int") {
        prop.type = ShaderPropertyType::Int;
    } else if (glslType == "sampler2D") {
        prop.type = ShaderPropertyType::Texture;
    } else {
        prop.type = ShaderPropertyType::Unknown;
    }

    usize propStart = line.find("@property");
    if (propStart != std::string::npos) {
        usize parenStart = line.find('(', propStart);
        usize parenEnd = line.find(')', parenStart);
        if (parenStart != std::string::npos && parenEnd != std::string::npos) {
            std::string params = line.substr(parenStart + 1, parenEnd - parenStart - 1);

            usize typePos = params.find("type");
            if (typePos != std::string::npos) {
                usize eqPos = params.find('=', typePos);
                if (eqPos != std::string::npos) {
                    usize valStart = params.find_first_not_of(" \t", eqPos + 1);
                    usize valEnd = params.find_first_of(" \t,)", valStart);
                    if (valStart != std::string::npos) {
                        std::string typeVal = params.substr(valStart, valEnd - valStart);
                        prop.type = stringToPropertyType(typeVal);
                    }
                }
            }

            usize defaultPos = params.find("default");
            if (defaultPos != std::string::npos) {
                usize eqPos = params.find('=', defaultPos);
                if (eqPos != std::string::npos) {
                    usize valStart = params.find_first_not_of(" \t", eqPos + 1);
                    usize valEnd = params.find_first_of(",)", valStart);
                    if (valStart != std::string::npos) {
                        prop.defaultValue = trim(params.substr(valStart, valEnd - valStart));
                    }
                }
            }

            usize namePos = params.find("name");
            if (namePos != std::string::npos) {
                usize quoteStart = params.find('"', namePos);
                usize quoteEnd = params.find('"', quoteStart + 1);
                if (quoteStart != std::string::npos && quoteEnd != std::string::npos) {
                    prop.displayName = params.substr(quoteStart + 1, quoteEnd - quoteStart - 1);
                }
            }
        }
    }

    if (prop.displayName.empty()) {
        prop.displayName = prop.name;
        if (prop.displayName.size() > 2 && prop.displayName.substr(0, 2) == "u_") {
            prop.displayName = prop.displayName.substr(2);
        }
        if (!prop.displayName.empty()) {
            prop.displayName[0] = static_cast<char>(std::toupper(prop.displayName[0]));
        }
    }

    return prop;
}

ShaderPropertyType ShaderParser::stringToPropertyType(const std::string& typeStr) {
    if (typeStr == "float") return ShaderPropertyType::Float;
    if (typeStr == "vec2") return ShaderPropertyType::Vec2;
    if (typeStr == "vec3") return ShaderPropertyType::Vec3;
    if (typeStr == "vec4") return ShaderPropertyType::Vec4;
    if (typeStr == "color") return ShaderPropertyType::Color;
    if (typeStr == "int") return ShaderPropertyType::Int;
    if (typeStr == "texture") return ShaderPropertyType::Texture;
    return ShaderPropertyType::Unknown;
}

std::string ShaderParser::trim(const std::string& str) {
    const char* whitespace = " \t\r\n";
    usize start = str.find_first_not_of(whitespace);
    if (start == std::string::npos) {
        return "";
    }
    usize end = str.find_last_not_of(whitespace);
    return str.substr(start, end - start + 1);
}

}  // namespace esengine::resource
