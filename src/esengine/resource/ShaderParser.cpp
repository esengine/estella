// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ShaderParser.cpp
 * @brief   Parser for unified .esshader file format
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "ShaderParser.hpp"
#include "../core/Log.hpp"

#include <sstream>
#include <algorithm>
#include <cctype>
#include <cstdlib>
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

        if (directive == "feature") {
            // Declares a compile-time variant keyword. Self-documenting; the consumer
            // chooses which features to enable and assembleStage injects their #defines.
            if (!argument.empty()) result.features.push_back(argument);
            continue;
        }

        if (directive == "param") {
            // Declarative material parameter: ShaderParser owns its std140 slot in the
            // generated MaterialConstants block (or a sampler unit for textures).
            ShaderProperty prop = parseParamDirective(argument);
            if (!prop.name.empty()) result.properties.push_back(prop);
            continue;
        }

        if (directive == "domain") {
            if (!argument.empty()) result.domain = argument;
            continue;
        }

        if (directive == "switch") {
            // Material-controlled compile-time toggle: `#pragma switch NAME [default(on|off)]`.
            std::istringstream sw(argument);
            ShaderSwitch decl;
            sw >> decl.name;
            if (!decl.name.empty()) {
                const usize p = argument.find("default(");
                if (p != std::string::npos) {
                    const usize open = p + 8;
                    const usize close = argument.find(')', open);
                    if (close != std::string::npos) {
                        const std::string v = trim(argument.substr(open, close - open));
                        decl.defaultOn = (v == "on" || v == "true" || v == "1");
                    }
                }
                result.switches.push_back(decl);
            }
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

    computeMaterialLayout(result);

    result.valid = true;
    return result;
}

std::string ShaderParser::assembleStage(const ParsedShader& parsed,
                                        ShaderStage stage,
                                        const std::string& platform,
                                        const std::vector<std::string>& features) {
    return assembleStageEx(parsed, stage, platform, features).source;
}

std::string ShaderParser::variantKey(const std::vector<std::string>& features) {
    std::vector<std::string> sorted(features);
    std::sort(sorted.begin(), sorted.end());
    std::string key;
    for (const auto& f : sorted) {
        if (!key.empty()) key += '|';
        key += f;
    }
    return key;
}

namespace {

u32 countNewlines(const std::string& s) {
    u32 n = 0;
    for (char c : s) {
        if (c == '\n') ++n;
    }
    return n;
}

const char* glslTypeName(ShaderPropertyType t) {
    switch (t) {
        case ShaderPropertyType::Float: return "float";
        case ShaderPropertyType::Vec2:  return "vec2";
        case ShaderPropertyType::Vec3:  return "vec3";
        case ShaderPropertyType::Vec4:
        case ShaderPropertyType::Color: return "vec4";
        case ShaderPropertyType::Int:   return "int";
        default:                        return "float";
    }
}

}  // namespace

ShaderParser::AssembledStage ShaderParser::assembleStageEx(const ParsedShader& parsed,
                                                           ShaderStage stage,
                                                           const std::string& platform,
                                                           const std::vector<std::string>& features) {
    AssembledStage result;

    if (!parsed.valid) return result;

    auto stageIt = parsed.stages.find(stage);
    if (stageIt == parsed.stages.end()) return result;

    std::ostringstream assembled;
    u32 headerLines = 0;

    if (!parsed.version.empty()) {
        assembled << "#version " << parsed.version << "\n";
        ++headerLines;
    }

    // Feature #defines go right after #version (GLSL requires #version first), so the
    // shader body can #ifdef compile-time variants. Counted into headerLines so the
    // compile-log line remap stays accurate.
    for (const auto& f : features) {
        assembled << "#define " << f << " 1\n";
        ++headerLines;
    }

    // Auto-generated material params (#pragma param): the std140 MaterialConstants block
    // (non-texture params in declared order == std140 offset order) plus sampler uniforms.
    // Injected after the #defines so both stages share one block and the body can use the
    // params by name. A stage that doesn't reference them just carries an unused block.
    // Members carry an explicit `highp` so the block is self-contained: a fragment shader
    // has no default float precision until its own `precision` line, which follows this
    // injected header — qualifying each member avoids a "no precision specified" error.
    if (parsed.materialBlockSize > 0) {
        assembled << "layout(std140) uniform MaterialConstants {\n";
        ++headerLines;
        for (const auto& p : parsed.properties) {
            if (!p.fromParam || p.std140Offset < 0) continue;
            assembled << "    highp " << glslTypeName(p.type) << " " << p.name << ";\n";
            ++headerLines;
        }
        assembled << "};\n";
        ++headerLines;
    }
    for (const auto& p : parsed.properties) {
        if (p.fromParam && p.type == ShaderPropertyType::Texture) {
            assembled << "uniform highp sampler2D " << p.name << ";\n";
            ++headerLines;
        }
    }

    // Lit2D domain: inject the shared LightConstants block (std140) + the es_applyLighting2D()
    // helper into the fragment stage. Authors write the surface (albedo) and a world-position
    // varying, then call the helper — the engine owns the std140 layout so a hand-written struct
    // can't silently mismatch renderer/LightConstants.hpp and corrupt lighting. Members + locals
    // carry explicit highp for the same reason MaterialConstants does: a fragment shader has no
    // default float precision until its `precision` line, which follows this injected header.
    // The light-array size and packing here MUST match renderer/LightConstants.hpp (MAX_LIGHTS_2D,
    // GpuLight2D = two vec4s).
    if (stage == ShaderStage::Fragment && parsed.domain == "Lit2D") {
        static const char* kLit2DHeader =
            "struct es_Light2D { highp vec4 posDir; highp vec4 color; highp vec4 spot; };\n"
            "layout(std140) uniform LightConstants {\n"
            "    highp vec4 u_ambient;\n"
            "    es_Light2D u_lights[16];\n"
            "};\n"
            // Engine-owned normal-map convention (RGB[0,1] -> normal[-1,1], normalized), so every
            // Lit2D shader unpacks tangent-space normals the same way. 2D applies it screen-space
            // (no per-sprite tangent frame); a flat surface uses vec3(0,0,1).
            "highp vec3 es_sampleNormal(in highp sampler2D map, in highp vec2 uv) {\n"
            "    return normalize(texture(map, uv).xyz * 2.0 - 1.0);\n"
            "}\n"
            "highp vec3 es_applyLighting2D(highp vec3 albedo, highp vec3 N, highp vec2 worldPos) {\n"
            "    highp vec3 lit = u_ambient.rgb;\n"
            "    for (int i = 0; i < 16; ++i) {\n"
            "        highp vec4 pd = u_lights[i].posDir;\n"
            "        highp vec4 col = u_lights[i].color;\n"
            "        highp vec3 L;\n"
            "        highp float atten;\n"
            "        if (pd.z < 0.5) {\n"
            "            highp vec2 d = pd.xy - worldPos;\n"
            "            highp float dist = length(d);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = normalize(vec3(d, max(pd.w, 1.0)));\n"
            "        } else if (pd.z < 1.5) {\n"
            "            atten = 1.0;\n"
            "            L = normalize(vec3(-pd.xy, 1.0));\n"
            "        } else {\n"
            "            highp vec4 sp = u_lights[i].spot;\n"
            "            highp vec2 d = pd.xy - worldPos;\n"
            "            highp float dist = length(d);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = normalize(vec3(d, max(pd.w, 1.0)));\n"
            "            highp vec2 toFrag = (dist > 0.0001) ? (-d / dist) : sp.xy;\n"
            "            atten *= smoothstep(sp.w, sp.z, dot(sp.xy, toFrag));\n"
            "        }\n"
            "        highp float ndotl = max(dot(N, L), 0.0);\n"
            "        lit += col.rgb * (col.a * ndotl * atten);\n"
            "    }\n"
            "    return albedo * lit;\n"
            "}\n";
        assembled << kLit2DHeader;
        headerLines += countNewlines(kLit2DHeader);
    }

    if (!platform.empty()) {
        auto variantIt = parsed.variants.find(platform);
        if (variantIt != parsed.variants.end()) {
            assembled << variantIt->second;
            headerLines += countNewlines(variantIt->second);
        }
    }

    if (!parsed.sharedCode.empty()) {
        assembled << parsed.sharedCode;
        headerLines += countNewlines(parsed.sharedCode);
    }

    assembled << stageIt->second;

    result.source = assembled.str();
    result.headerLineCount = headerLines;
    return result;
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

ShaderProperty ShaderParser::parseParamDirective(const std::string& argument) {
    ShaderProperty prop;
    prop.fromParam = true;

    std::istringstream ss(argument);
    std::string typeStr;
    ss >> prop.name >> typeStr;
    if (prop.name.empty() || typeStr.empty()) {
        prop.name.clear();  // signal invalid → caller drops it
        return prop;
    }
    prop.type = stringToPropertyType(typeStr);

    // Extract the contents of a `key(...)` clause from the directive argument.
    auto clause = [&](const char* key) -> std::optional<std::string> {
        const std::string token = std::string(key) + "(";
        usize p = argument.find(token);
        if (p == std::string::npos) return std::nullopt;
        usize open = p + token.size();
        usize close = argument.find(')', open);
        if (close == std::string::npos) return std::nullopt;
        return trim(argument.substr(open, close - open));
    };

    if (auto d = clause("default")) prop.defaultValue = *d;
    if (auto u = clause("ui")) prop.ui = *u;
    if (auto r = clause("range")) {
        usize comma = r->find(',');
        if (comma != std::string::npos) {
            prop.rangeMin = static_cast<f32>(std::atof(trim(r->substr(0, comma)).c_str()));
            prop.rangeMax = static_cast<f32>(std::atof(trim(r->substr(comma + 1)).c_str()));
            prop.hasRange = true;
        }
    }

    // Default display name: strip a leading u_ and capitalize.
    prop.displayName = prop.name;
    if (prop.displayName.size() > 2 && prop.displayName.substr(0, 2) == "u_") {
        prop.displayName = prop.displayName.substr(2);
    }
    if (!prop.displayName.empty()) {
        prop.displayName[0] = static_cast<char>(std::toupper(prop.displayName[0]));
    }
    return prop;
}

void ShaderParser::computeMaterialLayout(ParsedShader& shader) {
    // std140 size/alignment for the supported scalar/vector param types.
    auto sizeAlign = [](ShaderPropertyType t, u32& size, u32& align) {
        switch (t) {
            case ShaderPropertyType::Float:
            case ShaderPropertyType::Int:   size = 4;  align = 4;  break;
            case ShaderPropertyType::Vec2:  size = 8;  align = 8;  break;
            case ShaderPropertyType::Vec3:  size = 12; align = 16; break;
            case ShaderPropertyType::Vec4:
            case ShaderPropertyType::Color: size = 16; align = 16; break;
            default:                        size = 0;  align = 0;  break;
        }
    };
    auto alignUp = [](u32 v, u32 a) -> u32 { return a == 0 ? v : (v + a - 1) & ~(a - 1); };

    // Material texture units start above the batch path's 0..7 slots
    // (must match renderer/MaterialConstants.hpp MATERIAL_TEXTURE_UNIT_BASE).
    u32 textureUnit = 8;
    u32 offset = 0;

    for (auto& p : shader.properties) {
        if (!p.fromParam) continue;  // legacy properties-block entries are reflection-only
        if (p.type == ShaderPropertyType::Texture) {
            p.textureUnit = static_cast<i32>(textureUnit++);
            p.std140Offset = -1;
            continue;
        }
        u32 size = 0, align = 0;
        sizeAlign(p.type, size, align);
        if (size == 0) { p.std140Offset = -1; continue; }  // Unknown — not packed
        offset = alignUp(offset, align);
        p.std140Offset = static_cast<i32>(offset);
        offset += size;
    }

    shader.materialBlockSize = (offset == 0) ? 0 : alignUp(offset, 16);
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
