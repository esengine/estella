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

// The WGSL varying interface of the canonical 2D vertex stage. Injected into
// BOTH canonical stages (vertex emits it, fragment consumes it), so
// fragment-only twins write `fs_main(v : VSOut)` against an engine-owned
// struct — WGSL has no module-scope varyings to match by name.
std::string wgslCanonicalVSOut(bool lit) {
    std::string src =
        "struct VSOut {\n"
        "    @builtin(position) pos : vec4f,\n"
        "    @location(0) v_color : vec4f,\n"
        "    @location(1) v_texCoord : vec2f,\n";
    if (lit) {
        src += "    @location(2) v_worldPos : vec2f,\n";
    }
    // A mesh that HAS normals hands them on, with the full world position a
    // tangent frame needs. v_worldPos stays vec2 so one fragment stage serves
    // both vertex sources.
    src +=
        "#ifdef MESH_NORMALS\n"
        "    @location(3) v_worldNormal : vec3f,\n"
        "    @location(4) v_worldXYZ : vec3f,\n"
        "#endif\n";
    src += "};\n";
    return src;
}

// WGSL twin of canonical2DVertexStage: same attribute locations, GLSL names
// kept behind struct fields (a_position -> v.a_position) so the two stages diff
// cleanly. FrameConstants arrives with the injected headers.
std::string canonical2DVertexStageWGSL(bool lit) {
    std::string src = wgslCanonicalVSOut(lit);
    src +=
        "\n"
        "#ifdef SKINNED\n"
        "struct SkinConstants { bones : array<mat4x4f, 64> };\n"
        "@group(0) @binding(5) var<uniform> skin : SkinConstants;\n"
        "#endif\n"
        "\n"
        "struct VSIn {\n"
        "    @location(0) a_position : vec3f,\n"
        "    @location(1) a_color : vec4f,\n"
        "    @location(2) a_texCoord : vec2f,\n"
        "#ifdef MESH_NORMALS\n"
        "    @location(3) a_normal : vec3f,\n"
        "#endif\n"
        "#ifdef SKINNED\n"
        "    @location(5) a_joints : vec4u,\n"
        "    @location(6) a_weights : vec4f,\n"
        "    @location(12) a_instTint : vec4f,\n"
        "#else\n"
        "#ifdef MESH\n"
        "    @location(8)  a_model0 : vec4f,\n"
        "    @location(9)  a_model1 : vec4f,\n"
        "    @location(10) a_model2 : vec4f,\n"
        "    @location(11) a_model3 : vec4f,\n"
        "    @location(12) a_instTint : vec4f,\n"
        "#endif\n"
        "#ifdef MESH_NORMALS\n"
        "    @location(13) a_nrm0 : vec3f,\n"
        "    @location(14) a_nrm1 : vec3f,\n"
        "    @location(15) a_nrm2 : vec3f,\n"
        "#endif\n"
        "#endif\n"
        "};\n"
        "\n"
        "@vertex fn vs_main(v : VSIn) -> VSOut {\n"
        "    var out : VSOut;\n"
        // Bones are already world-space, so a skinned mesh's own transform is not
        // read — which is what glTF requires of one.
        "#ifdef SKINNED\n"
        "    let pose = v.a_weights.x * skin.bones[v.a_joints.x]\n"
        "             + v.a_weights.y * skin.bones[v.a_joints.y]\n"
        "             + v.a_weights.z * skin.bones[v.a_joints.z]\n"
        "             + v.a_weights.w * skin.bones[v.a_joints.w];\n"
        "    let world = pose * vec4f(v.a_position, 1.0);\n"
        "    out.v_color = v.a_color * v.a_instTint;\n"
        "#elif defined(MESH)\n"
        "    let world = mat4x4f(v.a_model0, v.a_model1, v.a_model2, v.a_model3) * vec4f(v.a_position, 1.0);\n"
        "    out.v_color = v.a_color * v.a_instTint;\n"
        "#else\n"
        "    let world = vec4f(v.a_position, 1.0);\n"
        "    out.v_color = v.a_color;\n"
        "#endif\n"
        "    out.pos = frame.projection * world;\n"
        "    out.v_texCoord = v.a_texCoord;\n"
        "#ifdef MESH_NORMALS\n"
        "#ifdef SKINNED\n"
        "    out.v_worldNormal = mat3x3f(pose[0].xyz, pose[1].xyz, pose[2].xyz) * v.a_normal;\n"
        "#else\n"
        "    out.v_worldNormal = mat3x3f(v.a_nrm0, v.a_nrm1, v.a_nrm2) * v.a_normal;\n"
        "#endif\n"
        "    out.v_worldXYZ = world.xyz;\n"
        "#endif\n";
    if (lit) {
        src += "    out.v_worldPos = world.xy;\n";
    }
    src +=
        "    return out;\n"
        "}\n";
    return src;
}

// The PostProcess domain's varying interface: a fullscreen pass carries only
// the uv (plus the position builtin, which doubles as the pixel coordinate).
std::string wgslPPVSOut() {
    return
        "struct VSOut {\n"
        "    @builtin(position) pos : vec4f,\n"
        "    @location(0) v_texCoord : vec2f,\n"
        "};\n";
}

// WGSL twin of canonicalPPVertexStage.
std::string canonicalPPVertexStageWGSL() {
    std::string src = wgslPPVSOut();
    src +=
        "\n"
        "struct VSIn {\n"
        "    @location(0) a_position : vec2f,\n"
        "    @location(1) a_texCoord : vec2f,\n"
        "};\n"
        "\n"
        "@vertex fn vs_main(v : VSIn) -> VSOut {\n"
        "    var out : VSOut;\n"
        "    out.pos = vec4f(v.a_position, 0.0, 1.0);\n"
        "    out.v_texCoord = v.a_texCoord;\n"
        "    return out;\n"
        "}\n";
    return src;
}

// Canonical PostProcess vertex stage for fragment-only .esshaders: fullscreen
// passes all share the clip-space pass-through (the engine draws one
// fullscreen triangle; no projection, no color).
std::string canonicalPPVertexStage() {
    return
        "layout(location = 0) in vec2 a_position;\n"
        "layout(location = 1) in vec2 a_texCoord;\n"
        "\n"
        "out vec2 v_texCoord;\n"
        "\n"
        "void main() {\n"
        "    v_texCoord = a_texCoord;\n"
        "    gl_Position = vec4(a_position, 0.0, 1.0);\n"
        "}\n";
}

// Canonical 2D vertex stage for fragment-only .esshaders, in its three VERTEX
// SOURCES: batch (already world space), resident mesh (local + a per-object
// transform), skinned (posed by bones). One material serves all three.
std::string canonical2DVertexStage(bool lit) {
    std::string src =
        "layout(location = 0) in vec3 a_position;\n"
        "layout(location = 1) in vec4 a_color;\n"
        "layout(location = 2) in vec2 a_texCoord;\n"
        "#ifdef MESH_NORMALS\n"
        "layout(location = 3) in vec3 a_normal;\n"
        "#endif\n"
        "#ifdef SKINNED\n"
        "layout(location = 5) in uvec4 a_joints;\n"
        "layout(location = 6) in vec4 a_weights;\n"
        "layout(location = 12) in vec4 a_instTint;\n"
        // This draw's pose, rewritten immediately before it (SkinConstants, binding 5).
        "layout(std140) uniform SkinConstants {\n"
        "    mat4 u_bones[64];\n"
        "};\n"
        "#else\n"
        "#ifdef MESH\n"
        "layout(location = 8)  in vec4 a_model0;\n"
        "layout(location = 9)  in vec4 a_model1;\n"
        "layout(location = 10) in vec4 a_model2;\n"
        "layout(location = 11) in vec4 a_model3;\n"
        "layout(location = 12) in vec4 a_instTint;\n"
        "#endif\n"
        "#ifdef MESH_NORMALS\n"
        "layout(location = 13) in vec3 a_nrm0;\n"
        "layout(location = 14) in vec3 a_nrm1;\n"
        "layout(location = 15) in vec3 a_nrm2;\n"
        "#endif\n"
        "#endif\n"
        "\n"
        "out vec4 v_color;\n"
        "out vec2 v_texCoord;\n"
        "#ifdef MESH_NORMALS\n"
        "out highp vec3 v_worldNormal;\n"
        "out highp vec3 v_worldXYZ;\n"
        "#endif\n";
    if (lit) {
        src += "out highp vec2 v_worldPos;\n";
    }
    src +=
        "\n"
        "void main() {\n"
        // Bones are already world-space, so a skinned mesh's own transform is not
        // read — which is what glTF requires of one.
        "#ifdef SKINNED\n"
        "    mat4 skin = a_weights.x * u_bones[a_joints.x]\n"
        "              + a_weights.y * u_bones[a_joints.y]\n"
        "              + a_weights.z * u_bones[a_joints.z]\n"
        "              + a_weights.w * u_bones[a_joints.w];\n"
        "    vec4 world = skin * vec4(a_position, 1.0);\n"
        "    v_color = a_color * a_instTint;\n"
        "#elif defined(MESH)\n"
        "    vec4 world = mat4(a_model0, a_model1, a_model2, a_model3) * vec4(a_position, 1.0);\n"
        "    v_color = a_color * a_instTint;\n"
        "#else\n"
        "    vec4 world = vec4(a_position, 1.0);\n"
        "    v_color = a_color;\n"
        "#endif\n"
        "    gl_Position = u_projection * world;\n"
        "    v_texCoord = a_texCoord;\n"
        "#ifdef MESH_NORMALS\n"
        "#ifdef SKINNED\n"
        "    v_worldNormal = mat3(skin) * a_normal;\n"
        "#else\n"
        "    v_worldNormal = mat3(a_nrm0, a_nrm1, a_nrm2) * a_normal;\n"
        "#endif\n"
        "    v_worldXYZ = world.xyz;\n"
        "#endif\n";
    if (lit) {
        src += "    v_worldPos = world.xy;\n";
    }
    src += "}\n";
    return src;
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
    bool currentSectionIsWGSL = false;
    bool currentSectionIsFullWGSL = false;
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
            if (!prop.name.empty()) {
                // Engine-injected uniforms — a param with the same name would redeclare them.
                if (prop.name == "u_time" || prop.name == "u_viewport" || prop.name == "u_projection") {
                    result.errorMessage = "#pragma param '" + prop.name +
                                          "' is reserved (engine-injected uniform)";
                    return result;
                }
                result.properties.push_back(prop);
            }
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

        if (directive == "vertex" || directive == "fragment") {
            if (state != ParseState::Global) {
                result.errorMessage = "Unexpected #pragma " + directive +
                                      " at line " + std::to_string(lineNumber);
                return result;
            }
            // Optional language tag: `#pragma fragment wgsl` opens the stage's
            // WGSL twin section; `wgsl full` marks a SELF-CONTAINED twin whose
            // assembly skips every injected header (the cook-generated shape);
            // no tag is the GLSL stage.
            if (!argument.empty() && argument != "wgsl" && argument != "wgsl full") {
                result.errorMessage = "Unknown stage language '" + argument +
                                      "' at line " + std::to_string(lineNumber) +
                                      " (expected no tag for GLSL, 'wgsl', or 'wgsl full')";
                return result;
            }
            state = (directive == "vertex") ? ParseState::Vertex : ParseState::Fragment;
            currentSectionIsWGSL = !argument.empty();
            currentSectionIsFullWGSL = (argument == "wgsl full");
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
                case ParseState::Fragment: {
                    const ShaderStage s = (state == ParseState::Vertex) ? ShaderStage::Vertex
                                                                        : ShaderStage::Fragment;
                    auto& stages = currentSectionIsWGSL ? result.wgslStages : result.stages;
                    auto& maps = currentSectionIsWGSL ? result.wgslStageLineMaps : result.stageLineMaps;
                    stages[s] = currentSection.str();
                    maps[s] = std::move(currentSectionMap);
                    if (currentSectionIsWGSL && currentSectionIsFullWGSL) {
                        result.wgslStageFull[s] = true;
                    }
                    currentSectionMap.clear();
                    currentSectionIsWGSL = false;
                    currentSectionIsFullWGSL = false;
                    break;
                }
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
        // Fragment-only authoring: 2D domains get the canonical batch-space
        // pass-through, PostProcess the canonical fullscreen pass-through.
        if (result.domain == "Unlit2D" || result.domain == "Lit2D") {
            result.stages[ShaderStage::Vertex] = canonical2DVertexStage(result.domain == "Lit2D");
            result.vertexIsCanonical = true;
        } else if (result.domain == "PostProcess") {
            result.stages[ShaderStage::Vertex] = canonicalPPVertexStage();
        } else {
            result.errorMessage = "Missing vertex shader stage";
            return result;
        }
    }

    if (result.stages.find(ShaderStage::Fragment) == result.stages.end()) {
        result.errorMessage = "Missing fragment shader stage";
        return result;
    }

    // Same for the WGSL twin: a fragment-only twin gets the domain's canonical
    // WGSL vertex, and the flag makes the fragment assembly inject the matching
    // VSOut interface. A file with no wgsl sections simply has no twin.
    if (result.wgslStages.count(ShaderStage::Fragment) != 0 &&
        result.wgslStages.count(ShaderStage::Vertex) == 0) {
        if (result.domain == "Unlit2D" || result.domain == "Lit2D") {
            result.wgslStages[ShaderStage::Vertex] = canonical2DVertexStageWGSL(result.domain == "Lit2D");
            result.wgslVertexIsCanonical = true;
        } else if (result.domain == "PostProcess") {
            result.wgslStages[ShaderStage::Vertex] = canonicalPPVertexStageWGSL();
            result.wgslVertexIsCanonical = true;
        }
    }

    computeMaterialLayout(result);

    result.valid = true;
    return result;
}

std::string ShaderParser::assembleStage(const ParsedShader& parsed,
                                        ShaderStage stage,
                                        const std::string& platform,
                                        const std::vector<std::string>& features,
                                        ShaderTargetLanguage target) {
    return assembleStageEx(parsed, stage, platform, features, target).source;
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

std::vector<std::string> ShaderParser::splitFeatures(const std::string& csv) {
    std::vector<std::string> features;
    for (usize start = 0; start <= csv.size();) {
        const usize comma = csv.find(',', start);
        const usize end = comma == std::string::npos ? csv.size() : comma;
        const std::string f = trim(csv.substr(start, end - start));
        if (!f.empty()) features.push_back(f);
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return features;
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

// =============================================================================
// WGSL emission — the injected headers' twins. Uniform blocks keep their GLSL
// member names behind short block vars, so a body ports mechanically:
// u_time -> tc.u_time, u_progress -> mc.u_progress, u_lights -> lc.u_lights.
// WGSL's uniform address-space layout equals std140 member-for-member for the
// param type set (f32/i32 align 4, vec2 8, vec3/vec4 16), so MaterialConstants
// offsets computed by computeMaterialLayout hold for both languages.
// =============================================================================

const char* wgslTypeName(ShaderPropertyType t) {
    switch (t) {
        case ShaderPropertyType::Float: return "f32";
        case ShaderPropertyType::Vec2:  return "vec2f";
        case ShaderPropertyType::Vec3:  return "vec3f";
        case ShaderPropertyType::Vec4:
        case ShaderPropertyType::Color: return "vec4f";
        case ShaderPropertyType::Int:   return "i32";
        default:                        return "f32";
    }
}

// Engine-owned frame block (u_time / u_viewport), binding 3 — the GLSL
// kTimeHeader's twin. Injected into every WGSL stage; the device's explicit
// layouts make a declared-but-unused block legal, same as GL.
const char* kFrameHeaderWGSL =
    "struct FrameConstants { projection : mat4x4f, camera : vec4f };\n"
    "@group(0) @binding(0) var<uniform> frame : FrameConstants;\n"
    "fn viewDirection(worldPos : vec3f) -> vec3f {\n"
    "    if (frame.camera.w > 0.5) { return normalize(frame.camera.xyz - worldPos); }\n"
    "    return frame.camera.xyz;\n"
    "}\n";

const char* kTimeHeaderWGSL =
    "struct TimeConstants { u_time : vec4f, u_viewport : vec4f };\n"
    "@group(0) @binding(3) var<uniform> tc : TimeConstants;\n";

// The batch texture contract for fragment-only 2D twins: u_textures[8]
// de-combined into texture_2d t0..t7 (bindings 0..7) + samplers s0..s7
// (bindings 8..15) — the group-1 convention (WebGPUMappings). Bodies sample
// `textureSampleLevel(t0, s0, uv, 0.0)` where GLSL reads u_textures[0].
std::string wgslBatchTextureDecls() {
    std::string src;
    for (u32 i = 0; i < 8; ++i) {
        const std::string n = std::to_string(i);
        src += "@group(1) @binding(" + n + ") var t" + n + " : texture_2d<f32>;\n";
        src += "@group(1) @binding(" + std::to_string(8 + i) + ") var s" + n + " : sampler;\n";
    }
    return src;
}

// #pragma param texture uniforms: material units (>= 8) extend group 1 at
// texture bindings unit+8 (16..23) with samplers at unit+16 (24..31) — the
// WebGPUMappings unit→binding convention. The sampler rides the param's name
// with an _s suffix: textureSampleLevel(u_mask, u_mask_s, uv, 0.0).
std::string wgslMaterialTextureDecls(const ParsedShader& parsed) {
    std::string src;
    for (const auto& p : parsed.properties) {
        if (!p.fromParam || p.type != ShaderPropertyType::Texture || p.textureUnit < 0) continue;
        const u32 unit = static_cast<u32>(p.textureUnit);
        src += "@group(1) @binding(" + std::to_string(unit + 8) + ") var " + p.name +
               " : texture_2d<f32>;\n";
        src += "@group(1) @binding(" + std::to_string(unit + 16) + ") var " + p.name +
               "_s : sampler;\n";
    }
    return src;
}

// Lit2D injection twin: LightConstants (binding 2) + the lighting/shadow
// helpers, ported line for line from the GLSL kLit2DHeader. Array strides
// (Light2D = 64 bytes, vec4f = 16) satisfy WGSL's uniform layout rules, so the
// block matches renderer/LightConstants.hpp on both backends. sampleNormal
// takes the de-combined texture+sampler pair and samples mip 0 explicitly,
// keeping calls legal in non-uniform control flow.
const char* kColorHelpersWGSL = R"(fn srgbToLinear(c : vec3f) -> vec3f {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), c));
}
fn linearToSrgb(c : vec3f) -> vec3f {
    return mix(c * 12.92, 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), c));
}
)";

const char* kLit2DHeaderWGSL = R"(struct Light2D { posDir : vec4f, color : vec4f, spot : vec4f, shadow : vec4f };
struct LightConstants {
    u_ambient : vec4f,
    u_lights : array<Light2D, 16>,
    u_occluderCount : vec4f,
    u_occluders : array<vec4f, 8>,
};
@group(0) @binding(2) var<uniform> lc : LightConstants;
fn sampleNormal(map : texture_2d<f32>, samp : sampler, uv : vec2f) -> vec3f {
    return normalize(textureSampleLevel(map, samp, uv, 0.0).xyz * 2.0 - 1.0);
}
fn perturbNormal(N : vec3f, worldPos : vec3f, uv : vec2f, tangentNormal : vec3f) -> vec3f {
    let dp1 = dpdx(worldPos);
    // Negated: this backend's framebuffer y runs the other way, so dpdy answers
    // with the opposite sign to GLSL's dFdy. Left alone it flips T and B, and a
    // normal map lights the wrong side — which only the second backend shows.
    let dp2 = -dpdy(worldPos);
    let duv1 = dpdx(uv);
    let duv2 = -dpdy(uv);
    let dp2perp = cross(dp2, N);
    let dp1perp = cross(N, dp1);
    let T = dp2perp * duv1.x + dp1perp * duv2.x;
    let B = dp2perp * duv1.y + dp1perp * duv2.y;
    let m = max(max(dot(T, T), dot(B, B)), 1e-12);
    if (m <= 1e-11) { return N; }
    let invmax = inverseSqrt(m);
    return normalize(mat3x3f(T * invmax, B * invmax, N) * tangentNormal);
}
fn segHitsBox(p0 : vec2f, p1 : vec2f, box : vec4f) -> f32 {
    if (p0.x >= box.x && p0.y >= box.y && p0.x <= box.z && p0.y <= box.w) { return 0.0; }
    let d = p1 - p0;
    var tmin = 0.0;
    var tmax = 1.0;
    for (var a = 0; a < 2; a++) {
        let da = select(d.y, d.x, a == 0);
        let p0a = select(p0.y, p0.x, a == 0);
        let lo = select(box.y, box.x, a == 0) - p0a;
        let hi = select(box.w, box.z, a == 0) - p0a;
        if (abs(da) < 1e-5) {
            if (lo > 0.0 || hi < 0.0) { return 0.0; }
        } else {
            let t1 = lo / da;
            let t2 = hi / da;
            tmin = max(tmin, min(t1, t2));
            tmax = min(tmax, max(t1, t2));
            if (tmin > tmax) { return 0.0; }
        }
    }
    return 1.0;
}
fn shadowFactor2D(worldPos : vec2f, aim : vec2f, softness : f32) -> f32 {
    let n = i32(lc.u_occluderCount.x);
    if (n <= 0) { return 1.0; }
    if (softness < 1e-4) {
        for (var i = 0; i < 8; i++) {
            if (i >= n) { break; }
            if (segHitsBox(worldPos, aim, lc.u_occluders[i]) > 0.5) { return 0.0; }
        }
        return 1.0;
    }
    let dir = aim - worldPos;
    let dl = length(dir);
    var perp = vec2f(1.0, 0.0);
    if (dl > 1e-4) { perp = vec2f(-dir.y, dir.x) / dl; }
    var blocked = 0.0;
    for (var s = 0; s < 5; s++) {
        let t = f32(s) / 4.0 * 2.0 - 1.0;
        let tp = aim + perp * (t * softness);
        for (var i = 0; i < 8; i++) {
            if (i >= n) { break; }
            if (segHitsBox(worldPos, tp, lc.u_occluders[i]) > 0.5) { blocked += 1.0; break; }
        }
    }
    return 1.0 - blocked / 5.0;
}
fn distributionGGX(NdotH : f32, a : f32) -> f32 {
    let a2 = a * a;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(3.14159265 * d * d, 1e-7);
}
fn geometrySmith(NdotV : f32, NdotL : f32, roughness : f32) -> f32 {
    let k = (roughness + 1.0) * (roughness + 1.0) * 0.125;
    return (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));
}
fn fresnelSchlick(VdotH : f32, F0 : vec3f) -> vec3f {
    return F0 + (vec3f(1.0) - F0) * pow(1.0 - VdotH, 5.0);
}
fn envBRDFApprox(NdotV : f32, roughness : f32) -> vec2f {
    let r = roughness * vec4f(-1.0, -0.0275, -0.572, 0.022)
          + vec4f(1.0, 0.0425, 1.04, -0.04);
    let a = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
    return vec2f(-1.04, 1.04) * a + r.zw;
}
fn applyLightingPBR(albedo : vec3f, N : vec3f, worldPos : vec3f, V : vec3f, metallic : f32,
                    roughness : f32, specular : f32, ao : f32) -> vec3f {
    let F0 = mix(vec3f(0.04), albedo, vec3f(metallic));
    let a = max(roughness * roughness, 1e-3);
    let NdotV = max(dot(N, V), 1e-4);
    var lit = lc.u_ambient.rgb * ao;
    var gloss = vec3f(0.0);
    for (var i = 0; i < 16; i++) {
        let pd = lc.u_lights[i].posDir;
        let col = lc.u_lights[i].color;
        let sh = lc.u_lights[i].shadow;
        var L : vec3f;
        var atten : f32;
        var aim = pd.xy;
        var castShadow = true;
        if (pd.z < 0.5) {
            let d = pd.xy - worldPos.xy;
            let dist = length(d);
            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));
            L = normalize(vec3f(d, max(pd.w, 1.0)));
        } else if (pd.z < 1.5) {
            atten = 1.0;
            L = normalize(vec3f(-pd.xy, 1.0));
            var toLight = vec2f(0.0, 0.0);
            if (dot(pd.xy, pd.xy) > 1e-8) { toLight = normalize(-pd.xy); }
            castShadow = sh.y > 0.0 && dot(toLight, toLight) > 0.5;
            aim = worldPos.xy + toLight * sh.y;
        } else {
            let sp = lc.u_lights[i].spot;
            let d = pd.xy - worldPos.xy;
            let dist = length(d);
            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));
            L = normalize(vec3f(d, max(pd.w, 1.0)));
            var toFrag = sp.xy;
            if (dist > 0.0001) { toFrag = -d / dist; }
            atten *= smoothstep(sp.w, sp.z, dot(sp.xy, toFrag));
        }
        if (castShadow && col.a > 0.0 && atten > 0.0) {
            atten *= shadowFactor2D(worldPos.xy, aim, sh.x);
        }
        let ndotl = max(dot(N, L), 0.0);
        let radiance = col.rgb * (col.a * ndotl * atten);
        lit += radiance;
        if (specular > 0.0) {
            let H = normalize(L + V);
            let brdf = distributionGGX(max(dot(N, H), 0.0), a)
                     * geometrySmith(NdotV, ndotl, roughness)
                     / max(4.0 * NdotV * ndotl, 1e-4);
            gloss += radiance * fresnelSchlick(max(dot(V, H), 0.0), F0)
                   * (brdf * 3.14159265 * specular);
        }
    }
    let ab = envBRDFApprox(NdotV, roughness);
    gloss += lc.u_ambient.rgb * (ao * specular) * (F0 * ab.x + vec3f(ab.y));
    return albedo * (1.0 - metallic) * lit + gloss;
}
fn applyLighting2DAO(albedo : vec3f, N : vec3f, worldPos : vec2f, ao : f32) -> vec3f {
    let P = vec3f(worldPos, 0.0);
    return applyLightingPBR(albedo, N, P, viewDirection(P), 0.0, 1.0, 0.0, ao);
}
fn applyLighting2D(albedo : vec3f, N : vec3f, worldPos : vec2f) -> vec3f {
    return applyLighting2DAO(albedo, N, worldPos, 1.0);
}
)";

// Blanks a hand-written `layout(std140) uniform <block> {...};` out of a GLSL
// stage: shaders predating the injected block still carry their own, and one
// block declared twice never links. Blanked (not cut) so line remapping lands.
std::string blankUniformBlock(const std::string& src, const std::string& blockName) {
    const std::string needle = "uniform " + blockName;
    const usize at = src.find(needle);
    if (at == std::string::npos) return src;

    const usize lineStart = src.rfind('\n', at) == std::string::npos ? 0 : src.rfind('\n', at) + 1;
    // Only a declaration counts: the same words inside a comment must survive.
    const std::string prefix = src.substr(lineStart, at - lineStart);
    if (prefix.find_first_not_of(" \t") != std::string::npos
        && prefix.find("layout") == std::string::npos) {
        return src;
    }
    const usize open = src.find('{', at);
    if (open == std::string::npos) return src;
    const usize close = src.find("};", open);
    if (close == std::string::npos) return src;

    std::string out = src;
    for (usize i = lineStart; i < close + 2; ++i) {
        if (out[i] != '\n') out[i] = ' ';
    }
    return out;
}

std::string trimWs(const std::string& s) {
    const usize a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return {};
    const usize b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

// WGSL has no preprocessor, so feature permutations resolve at assembly time:
// #ifdef/#ifndef/#else/#elif defined(NAME)/#endif over the assembled text,
// with the feature set as the defined names. GLSL keeps real #defines for the
// driver, so both targets see identical variant logic in the authored bodies.
std::string preprocessWGSL(const std::string& source, const std::vector<std::string>& features) {
    const std::unordered_set<std::string> defined(features.begin(), features.end());
    struct Frame {
        bool parentActive;  ///< Whether the enclosing region emits lines.
        bool taken;         ///< A branch of this #if chain has already emitted.
        bool active;        ///< The current branch emits lines.
    };
    std::vector<Frame> stack;
    auto activeNow = [&]() { return stack.empty() || stack.back().active; };

    std::string out;
    out.reserve(source.size());
    std::istringstream in(source);
    std::string line;
    while (std::getline(in, line)) {
        const std::string lead = ltrim(line);
        if (lead.rfind("#ifdef", 0) == 0 || lead.rfind("#ifndef", 0) == 0) {
            const bool neg = lead.rfind("#ifndef", 0) == 0;
            const std::string name = trimWs(lead.substr(neg ? 7 : 6));
            const bool parent = activeNow();
            const bool cond = parent && ((defined.count(name) != 0) != neg);
            stack.push_back(Frame{parent, cond, cond});
            continue;
        }
        if (lead.rfind("#elif", 0) == 0 && !stack.empty()) {
            bool cond = false;
            const usize p = lead.find("defined(");
            if (p != std::string::npos) {
                const usize close = lead.find(')', p + 8);
                if (close != std::string::npos) {
                    cond = defined.count(trimWs(lead.substr(p + 8, close - p - 8))) != 0;
                }
            }
            Frame& f = stack.back();
            f.active = f.parentActive && !f.taken && cond;
            f.taken = f.taken || f.active;
            continue;
        }
        if (lead.rfind("#else", 0) == 0 && !stack.empty()) {
            Frame& f = stack.back();
            f.active = f.parentActive && !f.taken;
            f.taken = true;
            continue;
        }
        if (lead.rfind("#endif", 0) == 0) {
            if (!stack.empty()) stack.pop_back();
            continue;
        }
        if (activeNow()) {
            out += line;
            out += '\n';
        }
    }
    return out;
}

const char* stageName(ShaderStage stage) {
    return stage == ShaderStage::Vertex ? "vertex" : "fragment";
}

// The WGSL assembly: the stage's twin body behind the per-language injected
// headers, then the assembly-time feature preprocessor. Platform variants and
// sharedCode are GLSL-only mechanisms — twins carry their own helpers.
// headerLineCount is exact when the body carries no #if lines (removed lines
// shift the compile-log remap; acceptable for hand-authored twins).
ShaderParser::AssembledStage assembleWGSLStage(const ParsedShader& parsed,
                                               ShaderStage stage,
                                               const std::vector<std::string>& features) {
    ShaderParser::AssembledStage result;
    if (!parsed.valid) return result;

    auto bodyIt = parsed.wgslStages.find(stage);
    if (bodyIt == parsed.wgslStages.end()) {
        ES_LOG_ERROR("Shader '{}' has no WGSL twin for the {} stage (add '#pragma {} wgsl')",
                     parsed.name, stageName(stage), stageName(stage));
        return result;
    }

    // A `wgsl full` twin is a self-contained program (the cook-generated shape):
    // it carries its own declarations at the engine's binding conventions, so
    // injecting the shared headers would double-declare them.
    auto fullIt = parsed.wgslStageFull.find(stage);
    if (fullIt != parsed.wgslStageFull.end() && fullIt->second) {
        result.source = preprocessWGSL(bodyIt->second, features);
        result.headerLineCount = 0;
        return result;
    }

    std::ostringstream assembled;
    u32 headerLines = 0;
    auto inject = [&](const std::string& s) {
        assembled << s;
        headerLines += countNewlines(s);
    };

    const bool lit = parsed.domain == "Lit2D";
    if (stage == ShaderStage::Fragment && parsed.wgslVertexIsCanonical) {
        // The canonical vertex's varying interface (domain-shaped) + the
        // engine texture contract — fragment-only twins run under the batch
        // conventions (PostProcess reads its input/scene as t0/s0 and t1/s1).
        inject(parsed.domain == "PostProcess" ? wgslPPVSOut() : wgslCanonicalVSOut(lit));
        inject(wgslBatchTextureDecls());
    }
    inject(kFrameHeaderWGSL);
    inject(kTimeHeaderWGSL);
    if (parsed.materialBlockSize > 0) {
        std::string block = "struct MaterialConstants {\n";
        for (const auto& p : parsed.properties) {
            if (!p.fromParam || p.std140Offset < 0) continue;
            block += "    " + p.name + " : " + wgslTypeName(p.type) + ",\n";
        }
        block += "};\n"
                 "@group(0) @binding(1) var<uniform> mc : MaterialConstants;\n";
        inject(block);
    }
    if (stage == ShaderStage::Fragment) {
        inject(wgslMaterialTextureDecls(parsed));
        if (lit) inject(kLit2DHeaderWGSL);
        inject(kColorHelpersWGSL);
    }

    assembled << bodyIt->second;

    result.source = preprocessWGSL(assembled.str(), features);
    result.headerLineCount = headerLines;
    return result;
}

}  // namespace

bool ShaderParser::s_linearColor = false;

void ShaderParser::setLinearColorSpace(bool linear) { s_linearColor = linear; }
bool ShaderParser::linearColorSpace() { return s_linearColor; }

ShaderParser::AssembledStage ShaderParser::assembleStageEx(const ParsedShader& parsed,
                                                           ShaderStage stage,
                                                           const std::string& platform,
                                                           const std::vector<std::string>& featuresIn,
                                                           ShaderTargetLanguage target) {
    // The color space is a process-global compile input: every shader — batch
    // variants, plugin shaders, blit, materials, post effects — sees the same
    // ES_LINEAR world with no per-call-site wiring. It must be set before the
    // renderer compiles shaders; flipping it later requires a reload.
    std::vector<std::string> features = featuresIn;
    if (s_linearColor
        && std::find(features.begin(), features.end(), "ES_LINEAR") == features.end()) {
        features.push_back("ES_LINEAR");
    }
    if (target == ShaderTargetLanguage::WGSL) {
        return assembleWGSLStage(parsed, stage, features);
    }
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

    // sRGB transfer helpers, available to every fragment stage in both modes —
    // authored bodies branch on ES_LINEAR. Exact piecewise IEC 61966-2-1, so the
    // CPU-side conversions (light/clear colors) match bit-for-bit within fp32.
    if (stage == ShaderStage::Fragment) {
        static const char* kColorHelpers =
            "highp vec3 srgbToLinear(highp vec3 c) {\n"
            "    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));\n"
            "}\n"
            "highp vec3 linearToSrgb(highp vec3 c) {\n"
            "    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));\n"
            "}\n";
        assembled << kColorHelpers;
        headerLines += countNewlines(kColorHelpers);
    }

    // The per-frame view-projection, injected identically into every stage (a block
    // declared two ways does not link) and engine-owned, so it cannot drift from the
    // std140 mirror in FrameConstants.hpp. highp: fragment has no default this early.
    static const char* kFrameHeader =
        "layout(std140) uniform FrameConstants {\n"
        "    highp mat4 u_projection;\n"
        "    highp vec4 u_camera;\n"  // xyz = eye (w=1) or direction toward it (w=0)
        "};\n"
        "highp vec3 viewDirection(in highp vec3 worldPos) {\n"
        "    return u_camera.w > 0.5 ? normalize(u_camera.xyz - worldPos) : u_camera.xyz;\n"
        "}\n";
    assembled << kFrameHeader;
    headerLines += countNewlines(kFrameHeader);

    // Engine-owned frame block, injected into every stage (identical in both, so the
    // program links). u_time = (elapsed s, delta s, 0, 0); u_viewport = canvas
    // (w, h, 1/w, 1/h) in pixels; binding 3 (Shader::compile).
    static const char* kTimeHeader =
        "layout(std140) uniform TimeConstants { highp vec4 u_time; highp vec4 u_viewport; };\n";
    assembled << kTimeHeader;
    headerLines += countNewlines(kTimeHeader);

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

    // Lit2D domain: inject the shared LightConstants block (std140) + the applyLighting2D()
    // helper into the fragment stage. Authors write the surface (albedo) and a world-position
    // varying, then call the helper — the engine owns the std140 layout so a hand-written struct
    // can't silently mismatch renderer/LightConstants.hpp and corrupt lighting. Members + locals
    // carry explicit highp for the same reason MaterialConstants does: a fragment shader has no
    // default float precision until its `precision` line, which follows this injected header.
    // The light-array size and packing here MUST match renderer/LightConstants.hpp (MAX_LIGHTS_2D,
    // GpuLight2D = four vec4s).
    if (stage == ShaderStage::Fragment && parsed.domain == "Lit2D") {
        static const char* kLit2DHeader =
            "struct Light2D { highp vec4 posDir; highp vec4 color; highp vec4 spot; highp vec4 shadow; };\n"
            "layout(std140) uniform LightConstants {\n"
            "    highp vec4 u_ambient;\n"
            "    Light2D u_lights[16];\n"
            "    highp vec4 u_occluderCount;\n"   // x = active occluder count
            "    highp vec4 u_occluders[8];\n"    // world AABBs (minX,minY,maxX,maxY)
            "};\n"
            // Engine-owned normal-map convention (RGB[0,1] -> normal[-1,1], normalized), so every
            // Lit2D shader unpacks tangent-space normals the same way. 2D applies it screen-space
            // (no per-sprite tangent frame); a flat surface uses vec3(0,0,1).
            "highp vec3 sampleNormal(in highp sampler2D map, in highp vec2 uv) {\n"
            "    return normalize(texture(map, uv).xyz * 2.0 - 1.0);\n"
            "}\n"
            // Tangent frame from screen-space derivatives, so a tangent-space normal
            // lands in world space without the geometry carrying a tangent channel —
            // which most exported models do not. Degenerate UVs return N unchanged.
            "highp vec3 perturbNormal(in highp vec3 N, in highp vec3 worldPos,\n"
            "                         in highp vec2 uv, in highp vec3 tangentNormal) {\n"
            "    highp vec3 dp1 = dFdx(worldPos);\n"
            "    highp vec3 dp2 = dFdy(worldPos);\n"
            "    highp vec2 duv1 = dFdx(uv);\n"
            "    highp vec2 duv2 = dFdy(uv);\n"
            "    highp vec3 dp2perp = cross(dp2, N);\n"
            "    highp vec3 dp1perp = cross(N, dp1);\n"
            "    highp vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;\n"
            "    highp vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;\n"
            "    highp float m = max(dot(T, T), dot(B, B));\n"
            "    if (m <= 1e-11) return N;\n"
            "    highp float invmax = inversesqrt(m);\n"
            "    return normalize(mat3(T * invmax, B * invmax, N) * tangentNormal);\n"
            "}\n"
            // 2D hard shadows: a slab test of the fragment->light segment against a world AABB.
            // Returns 1.0 when the segment crosses the box's interior, else 0.0. The [0,1] param
            // clamp means boxes behind the fragment or beyond the light don't occlude. A box
            // occludes the world OUTSIDE it, never a fragment inside itself — so a lit sprite
            // that is also a ShadowCaster2D casts shadows without blacking out its own pixels
            // (and geometry overlapping an occluder isn't spuriously darkened by it).
            "highp float segHitsBox(in highp vec2 p0, in highp vec2 p1, in highp vec4 box) {\n"
            "    if (p0.x >= box.x && p0.y >= box.y && p0.x <= box.z && p0.y <= box.w) return 0.0;\n"
            "    highp vec2 d = p1 - p0;\n"
            "    highp float tmin = 0.0;\n"
            "    highp float tmax = 1.0;\n"
            "    for (int a = 0; a < 2; ++a) {\n"
            "        highp float da = (a == 0) ? d.x : d.y;\n"
            "        highp float p0a = (a == 0) ? p0.x : p0.y;\n"
            "        highp float lo = ((a == 0) ? box.x : box.y) - p0a;\n"
            "        highp float hi = ((a == 0) ? box.z : box.w) - p0a;\n"
            "        if (abs(da) < 1e-5) {\n"
            "            if (lo > 0.0 || hi < 0.0) return 0.0;\n"
            "        } else {\n"
            "            highp float t1 = lo / da;\n"
            "            highp float t2 = hi / da;\n"
            "            tmin = max(tmin, min(t1, t2));\n"
            "            tmax = min(tmax, max(t1, t2));\n"
            "            if (tmin > tmax) return 0.0;\n"
            "        }\n"
            "    }\n"
            "    return 1.0;\n"
            "}\n"
            // Soft 2D shadows: averages occlusion of K rays cast from the fragment toward points
            // spread across the light's apparent size (softness = source half-extent, world units).
            // softness 0 collapses to the single hard-edged centre ray — bit-identical to the prior
            // behaviour; larger softness widens the penumbra the way an area light's shadow does.
            // `target` is the point the rays aim at — the light position for point/spot, or a far
            // point along the light direction for directional — so one primitive shadows every type.
            // No occluders (count 0) -> always 1.0, inert until the render path feeds boxes.
            "highp float shadowFactor2D(in highp vec2 worldPos, in highp vec2 target, in highp float softness) {\n"
            "    int n = int(u_occluderCount.x);\n"
            "    if (n <= 0) return 1.0;\n"
            "    if (softness < 1e-4) {\n"
            "        for (int i = 0; i < 8; ++i) {\n"
            "            if (i >= n) break;\n"
            "            if (segHitsBox(worldPos, target, u_occluders[i]) > 0.5) return 0.0;\n"
            "        }\n"
            "        return 1.0;\n"
            "    }\n"
            "    highp vec2 dir = target - worldPos;\n"
            "    highp float dl = length(dir);\n"
            "    highp vec2 perp = (dl > 1e-4) ? vec2(-dir.y, dir.x) / dl : vec2(1.0, 0.0);\n"
            "    const int K = 5;\n"
            "    highp float blocked = 0.0;\n"
            "    for (int s = 0; s < K; ++s) {\n"
            "        highp float t = float(s) / float(K - 1) * 2.0 - 1.0;\n"
            "        highp vec2 tp = target + perp * (t * softness);\n"
            "        for (int i = 0; i < 8; ++i) {\n"
            "            if (i >= n) break;\n"
            "            if (segHitsBox(worldPos, tp, u_occluders[i]) > 0.5) { blocked += 1.0; break; }\n"
            "        }\n"
            "    }\n"
            "    return 1.0 - blocked / float(K);\n"
            "}\n"
            // The microfacet terms: GGX distribution, Smith geometry (the direct-light k,
            // off perceptual roughness), Schlick fresnel. Guarded denominators, because a
            // specular weight of zero must multiply a finite number to reach exactly zero.
            "highp float distributionGGX(in highp float NdotH, in highp float a) {\n"
            "    highp float a2 = a * a;\n"
            "    highp float d = NdotH * NdotH * (a2 - 1.0) + 1.0;\n"
            "    return a2 / max(3.14159265 * d * d, 1e-7);\n"
            "}\n"
            "highp float geometrySmith(in highp float NdotV, in highp float NdotL,\n"
            "                          in highp float roughness) {\n"
            "    highp float k = (roughness + 1.0) * (roughness + 1.0) * 0.125;\n"
            "    return (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));\n"
            "}\n"
            "highp vec3 fresnelSchlick(in highp float VdotH, in highp vec3 F0) {\n"
            "    return F0 + (vec3(1.0) - F0) * pow(1.0 - VdotH, 5.0);\n"
            "}\n"
            // The split-sum environment term, Karis' analytic fit: scale and bias for F0
            // over a whole hemisphere. A lookup table is the usual carrier; the fit costs
            // no texture unit and is within a value or two of one over the [0,1] range.
            "highp vec2 envBRDFApprox(in highp float NdotV, in highp float roughness) {\n"
            "    highp vec4 r = roughness * vec4(-1.0, -0.0275, -0.572, 0.022)\n"
            "                 + vec4(1.0, 0.0425, 1.04, -0.04);\n"
            "    highp float a = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;\n"
            "    return vec2(-1.04, 1.04) * a + r.zw;\n"
            "}\n"
            // The lighting model in its general form; a lit 2D surface is its zero
            // (metallic 0, roughness 1, specular 0 leaves albedo * NdotL, pixel for pixel
            // what this engine has always drawn), so there is one model and not two.
            "highp vec3 applyLightingPBR(in highp vec3 albedo, in highp vec3 N, in highp vec3 worldPos,\n"
            "                            in highp vec3 V, in highp float metallic,\n"
            "                            in highp float roughness, in highp float specular,\n"
            "                            in highp float ao) {\n"
            // glTF's specularFactor scales the whole lobe, so 0 removes it rather than
            // leaving Schlick's grazing-angle rim behind.
            "    highp vec3 F0 = mix(vec3(0.04), albedo, metallic);\n"
            "    highp float a = max(roughness * roughness, 1e-3);\n"
            "    highp float NdotV = max(dot(N, V), 1e-4);\n"
            // Occlusion darkens the light that arrives from everywhere, which is the
            // ambient term; a surface's own lights are unobstructed by it.
            "    highp vec3 lit = u_ambient.rgb * ao;\n"
            "    highp vec3 gloss = vec3(0.0);\n"
            // A Light2D has no third coordinate, so distance stays in the plane and a
            // point light's height is its radius. Normal and view are the 3D part.
            "    for (int i = 0; i < 16; ++i) {\n"
            "        highp vec4 pd = u_lights[i].posDir;\n"
            "        highp vec4 col = u_lights[i].color;\n"
            "        highp vec4 sh = u_lights[i].shadow;\n"  // x = penumbra softness, y = directional distance
            "        highp vec3 L;\n"
            "        highp float atten;\n"
            "        highp vec2 target = pd.xy;\n"           // shadow-ray aim point (light position by default)
            "        bool castShadow = true;\n"
            "        if (pd.z < 0.5) {\n"
            "            highp vec2 d = pd.xy - worldPos.xy;\n"
            "            highp float dist = length(d);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = normalize(vec3(d, max(pd.w, 1.0)));\n"
            "        } else if (pd.z < 1.5) {\n"
            "            atten = 1.0;\n"
            "            L = normalize(vec3(-pd.xy, 1.0));\n"
            // Directional rays are parallel: aim at a far point toward the light source, opt in via
            // a positive march distance, and require a real direction (a zeroed one casts nothing).
            "            highp vec2 toLight = (dot(pd.xy, pd.xy) > 1e-8) ? normalize(-pd.xy) : vec2(0.0);\n"
            "            castShadow = sh.y > 0.0 && dot(toLight, toLight) > 0.5;\n"
            "            target = worldPos.xy + toLight * sh.y;\n"
            "        } else {\n"
            "            highp vec4 sp = u_lights[i].spot;\n"
            "            highp vec2 d = pd.xy - worldPos.xy;\n"
            "            highp float dist = length(d);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = normalize(vec3(d, max(pd.w, 1.0)));\n"
            "            highp vec2 toFrag = (dist > 0.0001) ? (-d / dist) : sp.xy;\n"
            "            atten *= smoothstep(sp.w, sp.z, dot(sp.xy, toFrag));\n"
            "        }\n"
            // Only pay for the shadow test when the light actually reaches this fragment (skips the
            // zeroed/inactive slots and unlit fragments — cheaper than the old unconditional call).
            "        if (castShadow && col.a > 0.0 && atten > 0.0) {\n"
            "            atten *= shadowFactor2D(worldPos.xy, target, sh.x);\n"
            "        }\n"
            "        highp float ndotl = max(dot(N, L), 0.0);\n"
            "        highp vec3 radiance = col.rgb * (col.a * ndotl * atten);\n"
            "        lit += radiance;\n"
            // A uniform branch: a surface that reflects nothing does not pay for the lobe.
            // The pi turns the engine's light intensity into the irradiance the BRDF wants,
            // which the diffuse side cancels against albedo/pi and never has to spell out.
            "        if (specular > 0.0) {\n"
            "            highp vec3 H = normalize(L + V);\n"
            "            highp float brdf = distributionGGX(max(dot(N, H), 0.0), a)\n"
            "                             * geometrySmith(NdotV, ndotl, roughness)\n"
            "                             / max(4.0 * NdotV * ndotl, 1e-4);\n"
            "            gloss += radiance * fresnelSchlick(max(dot(V, H), 0.0), F0)\n"
            "                   * (brdf * 3.14159265 * specular);\n"
            "        }\n"
            "    }\n"
            // The environment, which for this engine is the ambient term: the same
            // radiance from every direction. A metal has no diffuse, so without a
            // reflection of it a metal is black wherever no light happens to point.
            "    highp vec2 ab = envBRDFApprox(NdotV, roughness);\n"
            "    gloss += u_ambient.rgb * (ao * specular) * (F0 * ab.x + ab.y);\n"
            "    return albedo * (1.0 - metallic) * lit + gloss;\n"
            "}\n"
            "highp vec3 applyLighting2DAO(highp vec3 albedo, highp vec3 N, highp vec2 worldPos,\n"
            "                             highp float ao) {\n"
            "    highp vec3 P = vec3(worldPos, 0.0);\n"
            "    return applyLightingPBR(albedo, N, P, viewDirection(P), 0.0, 1.0, 0.0, ao);\n"
            "}\n"
            "highp vec3 applyLighting2D(highp vec3 albedo, highp vec3 N, highp vec2 worldPos) {\n"
            "    return applyLighting2DAO(albedo, N, worldPos, 1.0);\n"
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

    assembled << blankUniformBlock(stageIt->second, "FrameConstants");

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
