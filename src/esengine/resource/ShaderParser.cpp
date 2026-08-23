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

// WGSL twin of canonicalVertexStage: same attribute locations, GLSL names
// kept behind struct fields (a_position -> v.a_position) so the two stages diff
// cleanly. FrameConstants arrives with the injected headers.
std::string canonicalVertexStageWGSL(bool lit) {
    std::string src = wgslCanonicalVSOut(lit);
    src +=
        "\n"
        "#ifdef SKINNED\n"
        "struct SkinConstants { bones : array<mat4x4f, 64> };\n"
        "@group(0) @binding(5) var<uniform> skin : SkinConstants;\n"
        "#endif\n"
        "\n"
        "struct VSIn {\n"
        // A particle's quad corner is the vertex; where that corner lands is on the
        // instance, so this layout replaces the block rather than adding to it.
        "#ifdef PARTICLE\n"
        "    @location(0) a_position : vec2f,\n"
        "    @location(1) a_texCoord : vec2f,\n"
        "    @location(2) a_inst_position : vec3f,\n"
        "    @location(3) a_inst_size : vec2f,\n"
        "    @location(4) a_inst_rotation : f32,\n"
        "    @location(5) a_inst_color : vec4f,\n"
        "    @location(6) a_inst_uv_offset : vec2f,\n"
        "    @location(7) a_inst_uv_scale : vec2f,\n"
        "#else\n"
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
        "#endif\n"
        "};\n"
        "\n"
        "@vertex fn vs_main(v : VSIn) -> VSOut {\n"
        "    var out : VSOut;\n"
        // A particle faces the viewer wherever it is seen from; head-on and
        // orthographic the axes come out (1,0,0) and (0,1,0), the flat quad a 2D
        // scene has always drawn.
        "#ifdef PARTICLE\n"
        "    let scaled = v.a_position * v.a_inst_size;\n"
        "    let cosR = cos(v.a_inst_rotation);\n"
        "    let sinR = sin(v.a_inst_rotation);\n"
        "    let rotated = vec2f(scaled.x * cosR - scaled.y * sinR,\n"
        "                        scaled.x * sinR + scaled.y * cosR);\n"
        "    let fwd = viewDirection(v.a_inst_position);\n"
        // Looking straight down the world up, that axis cannot orient the quad.
        "    var refUp = vec3f(0.0, 1.0, 0.0);\n"
        "    if (abs(fwd.y) > 0.999) { refUp = vec3f(0.0, 0.0, 1.0); }\n"
        "    let right = normalize(cross(refUp, fwd));\n"
        "    let up = cross(fwd, right);\n"
        "    let world = vec4f(v.a_inst_position + right * rotated.x + up * rotated.y, 1.0);\n"
        "    out.v_color = v.a_inst_color;\n"
        // Bones are already world-space, so a skinned mesh's own transform is not
        // read — which is what glTF requires of one.
        "#elif defined(SKINNED)\n"
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
        "#ifdef PARTICLE\n"
        // A sheet animation moves the frame under the same quad.
        "    out.v_texCoord = v.a_texCoord * v.a_inst_uv_scale + v.a_inst_uv_offset;\n"
        "#else\n"
        "    out.v_texCoord = v.a_texCoord;\n"
        "#endif\n"
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
std::string canonicalVertexStage(bool lit) {
    std::string src =
        // A particle's quad corner is the vertex; where that corner lands is on the
        // instance. The layout differs from every other source, so it replaces the
        // block rather than adding to it.
        "#ifdef PARTICLE\n"
        "layout(location = 0) in vec2 a_position;\n"
        "layout(location = 1) in vec2 a_texCoord;\n"
        "layout(location = 2) in vec3 a_inst_position;\n"
        "layout(location = 3) in vec2 a_inst_size;\n"
        "layout(location = 4) in float a_inst_rotation;\n"
        "layout(location = 5) in vec4 a_inst_color;\n"
        "layout(location = 6) in vec2 a_inst_uv_offset;\n"
        "layout(location = 7) in vec2 a_inst_uv_scale;\n"
        "#else\n"
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
        // A particle faces the viewer wherever it is seen from; head-on and
        // orthographic the axes come out (1,0,0) and (0,1,0), the flat quad a 2D
        // scene has always drawn.
        "#ifdef PARTICLE\n"
        "    vec2 scaled = a_position * a_inst_size;\n"
        "    float cosR = cos(a_inst_rotation);\n"
        "    float sinR = sin(a_inst_rotation);\n"
        "    vec2 rotated = vec2(scaled.x * cosR - scaled.y * sinR,\n"
        "                        scaled.x * sinR + scaled.y * cosR);\n"
        "    highp vec3 fwd = viewDirection(a_inst_position);\n"
        // Looking straight down the world up, that axis cannot orient the quad.
        "    highp vec3 refUp = abs(fwd.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);\n"
        "    highp vec3 right = normalize(cross(refUp, fwd));\n"
        "    highp vec3 up = cross(fwd, right);\n"
        "    vec4 world = vec4(a_inst_position + right * rotated.x + up * rotated.y, 1.0);\n"
        "    v_color = a_inst_color;\n"
        // Bones are already world-space, so a skinned mesh's own transform is not
        // read — which is what glTF requires of one.
        "#elif defined(SKINNED)\n"
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
        "#ifdef PARTICLE\n"
        // A sheet animation moves the frame under the same quad.
        "    v_texCoord = a_texCoord * a_inst_uv_scale + a_inst_uv_offset;\n"
        "#else\n"
        "    v_texCoord = a_texCoord;\n"
        "#endif\n"
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

/**
 * A domain a shader was authored against, under the name the engine uses now.
 * A `.esshader` has no format version to migrate by, so the spelling from before
 * the lit domains were renamed is answered here: one door, and nothing
 * downstream sees two names.
 */
std::string normalizeDomain(const std::string& authored) {
    if (authored == "Lit2D") return "Lit";
    if (authored == "Unlit2D") return "Unlit";
    return authored;
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
            if (!argument.empty()) result.domain = normalizeDomain(argument);
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
        if (result.domain == "Unlit" || result.domain == "Lit") {
            result.stages[ShaderStage::Vertex] = canonicalVertexStage(result.domain == "Lit");
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
        if (result.domain == "Unlit" || result.domain == "Lit") {
            result.wgslStages[ShaderStage::Vertex] = canonicalVertexStageWGSL(result.domain == "Lit");
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

// Lit injection twin: LightConstants (binding 2) + the lighting/shadow
// helpers, ported line for line from the GLSL kLitHeader. Array strides
// (Light = 64 bytes, vec4f = 16) satisfy WGSL's uniform layout rules, so the
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

const char* kLitHeaderWGSL = R"(struct Light { posDir : vec4f, color : vec4f, spot : vec4f, shadow : vec4f, shadowMap : vec4f };
struct LightConstants {
    u_ambient : vec4f,
    u_lights : array<Light, 16>,
    u_occluderCount : vec4f,
    u_occluders : array<vec4f, 8>,
    u_shadowMatrix : array<mat4x4f, 16>,
    u_shadowTile : array<vec4f, 16>,
    u_shadowParams : vec4f,
    u_envIrradiance : array<vec4f, 9>,
    u_envParams : vec4f,
    u_envTint : vec4f,
};
@group(0) @binding(2) var<uniform> lc : LightConstants;
fn packDepth(d : f32) -> vec3f {
    let enc = fract(d * vec3f(1.0, 255.0, 65025.0));
    return enc - enc.yzz * vec3f(1.0 / 255.0, 1.0 / 255.0, 0.0);
}
fn unpackDepth(c : vec3f) -> f32 {
    return dot(c, vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
}
fn stepFor(texel : f32, slope : f32, reach : f32) -> f32 {
    // How far toward the light a lookup has to ask from: one texel of doubt about where
    // the map sampled this surface, plus whatever `reach` texels of it are worth at the
    // angle it stands.
    return texel * (1.5 * (1.0 + slope) + reach * slope);
}
fn shadowDepth(m : mat4x4f, p : vec3f) -> f32 {
    let c = m * vec4f(p, 1.0);
    return clamp(c.z / max(c.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);
}
fn shadowTap(at : vec2f, lo : vec2f, hi : vec2f, here : f32) -> f32 {
#ifdef ES_RECEIVE_SHADOW
    // A tap that leaves its tile reads another map entirely — a neighbouring cube face,
    // which is the least related depth in the atlas.
    let d = unpackDepth(textureSampleLevel(t2, s2, clamp(at, lo, hi), 0.0).rgb);
    return select(1.0, 0.0, d < here);
#else
    // The map's sampler is only declared where a shader receives one.
    return 1.0;
#endif
}
fn diskTap(i : i32, n : i32, radius : f32) -> vec2f {
    // A spiral, not a table: the golden angle spreads any number of taps evenly over a
    // disc, so the pattern follows the count instead of being pasted in beside it.
    let a = f32(i) * 2.3999632;
    // Turned over in v for the reason the tile's rect is: an offset in texture space
    // follows the axis the texture is sampled along, and this backend's runs the other
    // way. A spiral is not its own mirror, so without this the two average other points.
    return radius * sqrt((f32(i) + 0.5) / f32(n)) * vec2f(cos(a), -sin(a));
}
// The widest disc the tap count below can average over: past it the samples sit further
// apart than the texels they average, and a penumbra bands instead of blurring. It bounds
// the search too — a blocker outside it cannot widen an edge that cannot be drawn wider.
const kShadowDisc = 8.0;
fn shadowFactor3D(worldPos : vec3f, N : vec3f, L : vec3f, source : vec2f,
                  first : i32, count : i32) -> f32 {
#ifndef ES_RECEIVE_SHADOW
    return 1.0;
#else
    if (lc.u_shadowParams.x < 0.5) { return 1.0; }
    // How steeply the surface stands to the light: one texel covers a patch of it, and
    // the steeper the patch the further apart its ends are. Clamped, because edge-on is
    // a tangent that runs away.
    let NoL = clamp(dot(N, L), 0.0, 1.0);
    let slope = sqrt(1.0 - NoL * NoL) / max(NoL, 0.15);
    // Nearest tile first: a light's tiles overlap, and the first one covering a
    // fragment is the one that spends the most texels on it.
    for (var k = 0; k < 16; k++) {
        if (k >= count) { break; }
        let t = first + k;
        let m = lc.u_shadowMatrix[t];
        let lcp = m * vec4f(worldPos, 1.0);
        // Behind the light, where a divide by a negative w mirrors the point into the
        // map's own square and shadows it against whatever the light sees the other
        // way. A cube's six faces have five of themselves behind each one.
        if (lcp.w <= 0.0) { continue; }
        let proj = lcp.xyz / lcp.w;
        let uv = proj.xy * 0.5 + 0.5;
        // Depth counts as outside as much as the square does: this matrix and the one
        // that wrote the map both run z over [0, 1], so past either end is somewhere
        // the map never saw.
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0
            || proj.z < 0.0 || proj.z > 1.0) { continue; }
        let rect = lc.u_shadowTile[t];
        // One texel of this tile in WORLD units where this fragment stands: the matrix's
        // x scale is clip per world, w how far away this is (1 where the map has no eye),
        // and the rect over one atlas texel how many texels the square holds.
        let texels = max(rect.z / max(lc.u_shadowParams.y, 1e-9), 1.0);
        let across = length(vec3f(m[0].x, m[1].x, m[2].x));
        let texel = 2.0 * lcp.w / max(across * texels, 1e-9);
        // Ask a step toward the light rather than shift the answer: a step in world units
        // is the same step whether a map's depth runs linearly with distance or
        // hyperbolically, which is what lets one expression serve a cascade and a cone.
        let here = shadowDepth(m, worldPos + L * stepFor(texel, slope, 0.0));
        // The ONE place the two backends must not agree: v = 0 samples a texture's
        // bottom in GL and its top here, and the rect arrives with its low corner in
        // GL's terms — so the tile and the square inside it are both turned over.
        let base = vec2f(rect.x, 1.0 - rect.y - rect.z);
        let at0 = base + vec2f(uv.x, 1.0 - uv.y) * rect.z;
        let lo = base + lc.u_shadowParams.y * 0.5;
        let hi = base + rect.z - lc.u_shadowParams.y * 0.5;
        // How wide the source is in the unit this map measures depth in: world units
        // where its w varies with position, so it has an eye to measure them from, and
        // the tangent of the angle it subtends where its w is 1 everywhere.
        let hasEye = length(vec3f(m[0].w, m[1].w, m[2].w)) > 0.5;
        let src = select(source.y, source.x, hasEye);
        // A source with no size throws one edge, and four taps are its whole cost.
        if (src <= 0.0) {
            var lit = 0.0;
            for (var y = 0; y < 2; y++) {
                for (var x = 0; x < 2; x++) {
                    let o = (vec2f(f32(x), f32(y)) - 0.5) * lc.u_shadowParams.y;
                    lit += shadowTap(at0 + o, lo, hi, here);
                }
            }
            return lit * 0.25;
        }
        // What blocks this fragment, over the whole disc an edge can reach across — and
        // against a depth that forgives that reach, since a tap r texels away lands r
        // texels along the surface and a one-texel bias would call the slope a blocker.
        let reach = shadowDepth(m, worldPos + L * stepFor(texel, slope, kShadowDisc));
        var sum = 0.0;
        var hits = 0.0;
        for (var i = 0; i < 8; i++) {
            let at = clamp(at0 + diskTap(i, 8, kShadowDisc) * lc.u_shadowParams.y, lo, hi);
            let d = unpackDepth(textureSampleLevel(t2, s2, at, 0.0).rgb);
            if (d < reach) { sum += d; hits += 1.0; }
        }
        if (hits < 0.5) { return 1.0; }
        // How far the receiver stands beyond what blocks it, and how far from the light
        // that blocker is. A is the length of the map's depth row, and each kind of map
        // inverts its own with it: hyperbolic where it has an eye, linear where w is 1.
        let A = length(vec3f(m[0].z, m[1].z, m[2].z));
        let zb = 2.0 * (sum / hits) - 1.0;
        var dbw = 1.0;
        var span = (proj.z - zb) / max(A, 1e-9);
        if (hasEye) {
            dbw = lcp.w * (A - proj.z) / max(A - zb, 1e-6);
            span = lcp.w - dbw;
        }
        // A source subtending src/dbw at the blocker throws that much penumbra across the
        // span beyond it — which is why a shadow hardens as its caster nears what it
        // falls on, and why a sun's angle and a lamp's size are the same expression.
        let radius = clamp(src * span / max(dbw * texel, 1e-4), 0.5, kShadowDisc);
        let wide = shadowDepth(m, worldPos + L * stepFor(texel, slope, radius));
        // Thirty-two, where the hard edge needs four: the disc is as wide as the source
        // makes it, and a penumbra averaged over too few taps bands instead of blurring.
        var soft = 0.0;
        for (var i = 0; i < 32; i++) {
            soft += shadowTap(at0 + diskTap(i, 32, radius) * lc.u_shadowParams.y, lo, hi, wide);
        }
        return soft * (1.0 / 32.0);
    }
    return 1.0;
#endif
}
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
)"
// Split, not restructured: MSVC caps ONE string literal at 16380 bytes
// and this twin passed it. Adjacent literals concatenate with no cap, so
// the WGSL is byte-for-byte what it was.
R"(fn distributionGGX(NdotH : f32, a : f32) -> f32 {
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
fn envIrradiance(N : vec3f) -> vec3f {
    let sh = lc.u_envIrradiance[0].rgb * 0.282095
        + lc.u_envIrradiance[1].rgb * (0.488603 * N.y)
        + lc.u_envIrradiance[2].rgb * (0.488603 * N.z)
        + lc.u_envIrradiance[3].rgb * (0.488603 * N.x)
        + lc.u_envIrradiance[4].rgb * (1.092548 * N.x * N.y)
        + lc.u_envIrradiance[5].rgb * (1.092548 * N.y * N.z)
        + lc.u_envIrradiance[6].rgb * (0.315392 * (3.0 * N.z * N.z - 1.0))
        + lc.u_envIrradiance[7].rgb * (1.092548 * N.x * N.z)
        + lc.u_envIrradiance[8].rgb * (0.546274 * (N.x * N.x - N.y * N.y));
    return lc.u_ambient.rgb + max(sh, vec3f(0.0)) * lc.u_envTint.rgb;
}
fn octEncode(d : vec3f) -> vec2f {
    var p = d.xz / max(abs(d.x) + abs(d.y) + abs(d.z), 1e-6);
    if (d.y < 0.0) {
        p = (1.0 - abs(vec2f(p.y, p.x)))
          * vec2f(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
    }
    return p * 0.5 + 0.5;
}
fn envSampleMip(R : vec3f, mip : f32) -> vec3f {
#ifndef ES_ENV_MAP
    return vec3f(0.0);
#else
    let face = lc.u_envParams.w;
    let size = face * exp2(-mip);
    let yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;
    let atlasW = face + 2.0;
    let atlasH = 2.0 * face * (1.0 - exp2(-(lc.u_envParams.z + 1.0)))
               + 2.0 * (lc.u_envParams.z + 1.0);
    let uv = octEncode(R);
    let px = vec2f(1.0 + uv.x * size, yOff + 1.0 + uv.y * size);
    let t = textureSampleLevel(t3, s3, px / vec2f(atlasW, atlasH), 0.0);
    return t.rgb * t.rgb * (t.a * t.a * lc.u_envParams.y);
#endif
}
fn envRadiance(R : vec3f, roughness : f32) -> vec3f {
    if (lc.u_envParams.x < 0.5) { return lc.u_ambient.rgb; }
    let lod = clamp(roughness, 0.0, 1.0) * lc.u_envParams.z;
    let lo = floor(lod);
    let a = envSampleMip(R, lo);
    let b = envSampleMip(R, min(lo + 1.0, lc.u_envParams.z));
    return lc.u_ambient.rgb + mix(a, b, lod - lo) * lc.u_envTint.rgb;
}
// Which definition of "where is the light" this surface is shaded with. One with a
// real third coordinate measures against the light's own; a sprite has no depth to
// measure against, so a positional light goes on hovering its radius above it.
#ifdef ES_SURFACE_3D
fn lightVector(pd : vec4f, sh : vec4f, worldPos : vec3f) -> vec3f {
    return vec3f(pd.xy, sh.z) - worldPos;
}
fn lightDistance(toLight : vec3f) -> f32 { return length(toLight); }
fn spotCone(sp : vec4f, sh : vec4f, toLight : vec3f, dist : f32) -> f32 {
    let axis = normalize(vec3f(sp.xy, sh.w));
    var toFrag = axis;
    if (dist > 0.0001) { toFrag = -toLight / dist; }
    return smoothstep(sp.w, sp.z, dot(axis, toFrag));
}
#else
fn lightVector(pd : vec4f, sh : vec4f, worldPos : vec3f) -> vec3f {
    return vec3f(pd.xy - worldPos.xy, max(pd.w, 1.0));
}
fn lightDistance(toLight : vec3f) -> f32 { return length(toLight.xy); }
fn spotCone(sp : vec4f, sh : vec4f, toLight : vec3f, dist : f32) -> f32 {
    // A cone aimed out of the plane has no axis IN it, and this half of the shading
    // has nowhere else to read one — so it lights the way an unrotated spot always has.
    var axis = vec2f(0.0, -1.0);
    if (dot(sp.xy, sp.xy) > 1e-8) { axis = normalize(sp.xy); }
    var toFrag = axis;
    if (dist > 0.0001) { toFrag = -toLight.xy / dist; }
    return smoothstep(sp.w, sp.z, dot(axis, toFrag));
}
#endif
fn towardLight(toLight : vec3f, N : vec3f) -> vec3f {
    if (dot(toLight, toLight) > 1e-8) { return normalize(toLight); }
    return N;
}
fn applyLightingPBR(albedo : vec3f, N : vec3f, worldPos : vec3f, V : vec3f, metallic : f32,
                    roughness : f32, specular : f32, ao : f32) -> vec3f {
    let F0 = mix(vec3f(0.04), albedo, vec3f(metallic));
    let a = max(roughness * roughness, 1e-3);
    let NdotV = max(dot(N, V), 1e-4);
    var lit = envIrradiance(N) * ao;
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
            let toL = lightVector(pd, sh, worldPos);
            let dist = lightDistance(toL);
            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));
            L = towardLight(toL, N);
        } else if (pd.z < 1.5) {
            atten = 1.0;
            L = normalize(-vec3f(pd.xy, pd.w));
            var toLight = vec2f(0.0, 0.0);
            if (dot(pd.xy, pd.xy) > 1e-8) { toLight = normalize(-pd.xy); }
            castShadow = sh.y > 0.0 && dot(toLight, toLight) > 0.5;
            aim = worldPos.xy + toLight * sh.y;
        } else {
            let sp = lc.u_lights[i].spot;
            let toL = lightVector(pd, sh, worldPos);
            let dist = lightDistance(toL);
            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));
            L = towardLight(toL, N);
            atten *= spotCone(sp, sh, toL, dist);
        }
        if (castShadow && col.a > 0.0 && atten > 0.0) {
            atten *= shadowFactor2D(worldPos.xy, aim, sh.x);
        }
        let sm = lc.u_lights[i].shadowMap;
        if (sm.y > 0.0 && atten > 0.0) {
            atten *= shadowFactor3D(worldPos, N, L, vec2f(sh.x, sm.z), i32(sm.x), i32(sm.y));
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
    gloss += envRadiance(reflect(-V, N), roughness) * (ao * specular)
           * (F0 * ab.x + vec3f(ab.y));
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

    const bool lit = parsed.domain == "Lit";
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
        if (lit) inject(kLitHeaderWGSL);
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

    // Lit domain: inject the shared LightConstants block (std140) + the applyLighting2D()
    // helper into the fragment stage. Authors write the surface (albedo) and a world-position
    // varying, then call the helper — the engine owns the std140 layout so a hand-written struct
    // can't silently mismatch renderer/LightConstants.hpp and corrupt lighting. Members + locals
    // carry explicit highp for the same reason MaterialConstants does: a fragment shader has no
    // default float precision until its `precision` line, which follows this injected header.
    // The light-array size and packing here MUST match renderer/LightConstants.hpp (MAX_LIGHTS,
    // GpuLight = four vec4s).
    if (stage == ShaderStage::Fragment && parsed.domain == "Lit") {
        static const char* kLitHeader =
            "struct Light { highp vec4 posDir; highp vec4 color; highp vec4 spot; highp vec4 shadow;"
            " highp vec4 shadowMap; };\n"
            "layout(std140) uniform LightConstants {\n"
            "    highp vec4 u_ambient;\n"
            "    Light u_lights[16];\n"
            "    highp vec4 u_occluderCount;\n"   // x = active occluder count
            "    highp vec4 u_occluders[8];\n"    // world AABBs (minX,minY,maxX,maxY)
            "    highp mat4 u_shadowMatrix[16];\n"  // world -> each atlas tile's clip
            "    highp vec4 u_shadowTile[16];\n"  // xy = origin, z = side, w = bias
            "    highp vec4 u_shadowParams;\n"    // x = has map, y = one atlas texel
            "    highp vec4 u_envIrradiance[9];\n"  // SH9, rgb in xyz; zero = no environment
            "    highp vec4 u_envParams;\n"       // x = has map, y = range, z = maxLod, w = face
            "    highp vec4 u_envTint;\n"         // the ambient light's colour, scaling both halves
            "};\n"
            // The shadow map rides the draw's third texture slot, behind the feature the
            // MESH vertex sources set: the batch stream owns 0..7 as a per-vertex merge
            // product, so a sampler pinned to slot 2 there would read someone's sprite.
            "#ifdef ES_RECEIVE_SHADOW\n"
            "uniform highp sampler2D u_shadowMap;\n"
            "#endif\n"
            "#ifdef ES_ENV_MAP\n"
            "uniform highp sampler2D u_envMap;\n"
            "#endif\n"
            // 24 bits of depth across RGB — an 8-bit target is what both backends have
            // in common, and a metre of world depth does not survive 8 of them. The
            // pair lives together: two files would be two chances to disagree.
            "highp vec3 packDepth(in highp float d) {\n"
            "    highp vec3 enc = fract(d * vec3(1.0, 255.0, 65025.0));\n"
            "    return enc - enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);\n"
            "}\n"
            "highp float unpackDepth(in highp vec3 c) {\n"
            "    return dot(c, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));\n"
            "}\n"
            // How far toward the light a lookup has to ask from: one texel of doubt about
            // where the map sampled this surface, plus whatever `reach` texels of it are
            // worth at the angle it stands.
            "highp float stepFor(in highp float texel, in highp float slope,\n"
            "                    in highp float reach) {\n"
            "    return texel * (1.5 * (1.0 + slope) + reach * slope);\n"
            "}\n"
            "highp float shadowDepth(in highp mat4 m, in highp vec3 p) {\n"
            "    highp vec4 c = m * vec4(p, 1.0);\n"
            "    return clamp(c.z / max(c.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);\n"
            "}\n"
            // A tap that leaves its tile reads another map entirely — a neighbouring
            // cube face, which is the least related depth in the atlas.
            "highp float shadowTap(in highp vec2 at, in highp vec2 lo, in highp vec2 hi,\n"
            "                      in highp float here) {\n"
            "#ifdef ES_RECEIVE_SHADOW\n"
            "    return unpackDepth(texture(u_shadowMap, clamp(at, lo, hi)).rgb) < here\n"
            "        ? 0.0 : 1.0;\n"
            "#else\n"
            "    return 1.0;\n"
            "#endif\n"
            "}\n"
            // The widest disc the tap count below can average over: past it the samples
            // sit further apart than the texels they average, and a penumbra bands rather
            // than blurs. It bounds the search too, which can find no wider an edge.
            "const highp float kShadowDisc = 8.0;\n"
            // A spiral, not a table: the golden angle spreads any number of taps evenly
            // over a disc, so the pattern follows the count instead of sitting beside it.
            "highp vec2 diskTap(in int i, in int n, in highp float radius) {\n"
            "    highp float a = float(i) * 2.3999632;\n"
            "    return radius * sqrt((float(i) + 0.5) / float(n)) * vec2(cos(a), sin(a));\n"
            "}\n"
            // Visibility of a world point from the light that rendered the map. Depth is
            // written and compared through the SAME matrix and expression, so the two
            // backends' clip-z conventions cancel. 2x2 taps: one is a staircase.
            "highp float shadowFactor3D(in highp vec3 worldPos, in highp vec3 N, in highp vec3 L,\n"
            "                           in highp vec2 source, in int first, in int count) {\n"
            "#ifndef ES_RECEIVE_SHADOW\n"
            "    return 1.0;\n"
            "#else\n"
            "    if (u_shadowParams.x < 0.5) return 1.0;\n"
            // How steeply the surface stands to the light: one texel covers a patch of
            // it, and the steeper the patch the further apart its ends are. Clamped,
            // because edge-on is a tangent that runs away.
            "    highp float NoL = clamp(dot(N, L), 0.0, 1.0);\n"
            "    highp float slope = sqrt(1.0 - NoL * NoL) / max(NoL, 0.15);\n"
            // Nearest tile first: a light's tiles overlap, and the first one covering
            // a fragment is the one that spends the most texels on it.
            "    for (int k = 0; k < 16; ++k) {\n"
            "        if (k >= count) break;\n"
            "        int t = first + k;\n"
            "        highp mat4 m = u_shadowMatrix[t];\n"
            "        highp vec4 lc = m * vec4(worldPos, 1.0);\n"
            // Behind the light, where a divide by a negative w mirrors the point into
            // the map's own square and shadows it against whatever the light sees the
            // other way. A cube's six faces have five of themselves behind each one.
            "        if (lc.w <= 0.0) continue;\n"
            "        highp vec3 proj = lc.xyz / lc.w;\n"
            "        highp vec2 uv = proj.xy * 0.5 + 0.5;\n"
            // Outside every tile is lit: darkening what a map does not cover would be a
            // visible square of night. Depth counts as outside as much as the square
            // does — both matrices run z over [0, 1], so past either end is unseen.
            "        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0\n"
            "            || proj.z < 0.0 || proj.z > 1.0) continue;\n"
            // The tile's rect is data, so a tile need not be the same size as its
            // neighbour and this expression does not care which one it is reading.
            "        highp vec4 rect = u_shadowTile[t];\n"
            // One texel of this tile in WORLD units where this fragment stands: the
            // matrix's x scale is clip per world, w how far away this is (1 where the map
            // has no eye), and the rect over one atlas texel how many texels it holds.
            "        highp float texels = max(rect.z / max(u_shadowParams.y, 1e-9), 1.0);\n"
            "        highp float across = length(vec3(m[0][0], m[1][0], m[2][0]));\n"
            "        highp float texel = 2.0 * lc.w / max(across * texels, 1e-9);\n"
            // Ask a step toward the light rather than shift the answer: a step in world
            // units is the same step whether a map's depth runs linearly with distance or
            // hyperbolically, which is what lets one expression serve a cascade and a cone.
            "        highp float here = shadowDepth(m, worldPos + L * stepFor(texel, slope, 0.0));\n"
            "        highp vec2 at0 = rect.xy + uv * rect.z;\n"
            "        highp vec2 lo = rect.xy + u_shadowParams.y * 0.5;\n"
            "        highp vec2 hi = rect.xy + rect.z - u_shadowParams.y * 0.5;\n"
            // How wide the source is in the unit this map measures depth in: world units
            // where its w varies with position, so it has an eye to measure them from, and
            // the tangent of the angle it subtends where its w is 1 everywhere.
            "        bool hasEye = length(vec3(m[0][3], m[1][3], m[2][3])) > 0.5;\n"
            "        highp float src = hasEye ? source.x : source.y;\n"
            // A source with no size throws one edge, and four taps are its whole cost.
            "        if (src <= 0.0) {\n"
            "            highp float lit = 0.0;\n"
            "            for (int y = 0; y < 2; ++y) {\n"
            "                for (int x = 0; x < 2; ++x) {\n"
            "                    highp vec2 o = (vec2(float(x), float(y)) - 0.5) * u_shadowParams.y;\n"
            "                    lit += shadowTap(at0 + o, lo, hi, here);\n"
            "                }\n"
            "            }\n"
            "            return lit * 0.25;\n"
            "        }\n"
            // What blocks this fragment, over the whole disc an edge can reach across —
            // against a depth that forgives that reach, since a tap r texels out lands r
            // texels along the surface and a one-texel bias would call the slope one.
            "        highp float reach = shadowDepth(m, worldPos + L * stepFor(texel, slope, kShadowDisc));\n"
            "        highp float sum = 0.0;\n"
            "        highp float hits = 0.0;\n"
            "        for (int i = 0; i < 8; ++i) {\n"
            "            highp vec2 at = clamp(at0 + diskTap(i, 8, kShadowDisc) * u_shadowParams.y, lo, hi);\n"
            "            highp float d = unpackDepth(texture(u_shadowMap, at).rgb);\n"
            "            if (d < reach) { sum += d; hits += 1.0; }\n"
            "        }\n"
            "        if (hits < 0.5) return 1.0;\n"
            // How far the receiver stands beyond what blocks it, and how far from the
            // light that blocker is. A is the length of the map's depth row, and each map
            // inverts its own with it: hyperbolic where it has an eye, linear where w is 1.
            "        highp float A = length(vec3(m[0][2], m[1][2], m[2][2]));\n"
            "        highp float zb = 2.0 * (sum / hits) - 1.0;\n"
            "        highp float dbw = 1.0;\n"
            "        highp float span = (proj.z - zb) / max(A, 1e-9);\n"
            "        if (hasEye) {\n"
            "            dbw = lc.w * (A - proj.z) / max(A - zb, 1e-6);\n"
            "            span = lc.w - dbw;\n"
            "        }\n"
            // A source subtending src/dbw at the blocker throws that much penumbra across
            // the span beyond it — which is why a shadow hardens as its caster nears what
            // it falls on, and why a sun's angle and a lamp's size are one expression.
            "        highp float radius = clamp(src * span / max(dbw * texel, 1e-4),\n"
            "                                   0.5, kShadowDisc);\n"
            "        highp float wide = shadowDepth(m, worldPos + L * stepFor(texel, slope, radius));\n"
            // Thirty-two, where the hard edge needs four: the disc is as wide as the
            // source makes it, and a penumbra averaged over too few taps bands rather
            // than blurs.
            "        highp float soft = 0.0;\n"
            "        for (int i = 0; i < 32; ++i) {\n"
            "            soft += shadowTap(at0 + diskTap(i, 32, radius) * u_shadowParams.y,\n"
            "                              lo, hi, wide);\n"
            "        }\n"
            "        return soft * (1.0 / 32.0);\n"
            "    }\n"
            "    return 1.0;\n"
            "#endif\n"
            "}\n"
            // Engine-owned normal-map convention (RGB[0,1] -> normal[-1,1], normalized), so every
            // Lit shader unpacks tangent-space normals the same way. 2D applies it screen-space
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
            // The environment's diffuse half. With no environment the coefficients are
            // zero and this IS the flat ambient term, which is what keeps every existing
            // scene pixel-identical rather than merely close.
            "highp vec3 envIrradiance(in highp vec3 N) {\n"
            "    highp vec3 sh = u_envIrradiance[0].rgb * 0.282095\n"
            "        + u_envIrradiance[1].rgb * (0.488603 * N.y)\n"
            "        + u_envIrradiance[2].rgb * (0.488603 * N.z)\n"
            "        + u_envIrradiance[3].rgb * (0.488603 * N.x)\n"
            "        + u_envIrradiance[4].rgb * (1.092548 * N.x * N.y)\n"
            "        + u_envIrradiance[5].rgb * (1.092548 * N.y * N.z)\n"
            "        + u_envIrradiance[6].rgb * (0.315392 * (3.0 * N.z * N.z - 1.0))\n"
            "        + u_envIrradiance[7].rgb * (1.092548 * N.x * N.z)\n"
            "        + u_envIrradiance[8].rgb * (0.546274 * (N.x * N.x - N.y * N.y));\n"
            "    return u_ambient.rgb + max(sh, vec3(0.0)) * u_envTint.rgb;\n"
            "}\n"
            // Direction -> the octahedral unit square, +Y at the centre. The importer's
            // octEncode, in the shading language; the two must agree texel for texel.
            "highp vec2 octEncode(in highp vec3 d) {\n"
            "    highp vec2 p = d.xz / max(abs(d.x) + abs(d.y) + abs(d.z), 1e-6);\n"
            "    if (d.y < 0.0) {\n"
            "        p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);\n"
            "    }\n"
            "    return p * 0.5 + 0.5;\n"
            "}\n"
            // One mip of the prefiltered atlas. The mips stack downward, each face ringed
            // by a border texel, so the offset is a closed form rather than a table:
            // sum(face >> j, j < mip) = 2*face*(1 - 2^-mip), plus two rows per mip.
            "highp vec3 envSampleMip(in highp vec3 R, in highp float mip) {\n"
            "#ifndef ES_ENV_MAP\n"
            "    return vec3(0.0);\n"
            "#else\n"
            "    highp float face = u_envParams.w;\n"
            "    highp float size = face * exp2(-mip);\n"
            "    highp float yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;\n"
            "    highp float atlasW = face + 2.0;\n"
            "    highp float atlasH = 2.0 * face * (1.0 - exp2(-(u_envParams.z + 1.0)))\n"
            "                       + 2.0 * (u_envParams.z + 1.0);\n"
            "    highp vec2 uv = octEncode(R);\n"
            "    highp vec2 px = vec2(1.0 + uv.x * size, yOff + 1.0 + uv.y * size);\n"
            "    highp vec4 t = texture(u_envMap, px / vec2(atlasW, atlasH));\n"
            "    return t.rgb * t.rgb * (t.a * t.a * u_envParams.y);\n"
            "#endif\n"
            "}\n"
            // The environment's specular half, at the roughness asked for. Without a map
            // this is the flat ambient term, the same way the diffuse half is.
            "highp vec3 envRadiance(in highp vec3 R, in highp float roughness) {\n"
            "    if (u_envParams.x < 0.5) return u_ambient.rgb;\n"
            "    highp float lod = clamp(roughness, 0.0, 1.0) * u_envParams.z;\n"
            "    highp float lo = floor(lod);\n"
            "    highp vec3 a = envSampleMip(R, lo);\n"
            "    highp vec3 b = envSampleMip(R, min(lo + 1.0, u_envParams.z));\n"
            "    return u_ambient.rgb + mix(a, b, lod - lo) * u_envTint.rgb;\n"
            "}\n"
            // Where a positional light is, from here, and how far. Real geometry measures
            // against the light's own world height; a sprite has no depth of its own and
            // keeps the plane's convention of one hovering its falloff radius above it.
            // Which definition of "where is the light" this surface is shaded with.
            // One with a real third coordinate measures against the light's own; a
            // sprite has none, so a light goes on hovering its radius above it.
            "#ifdef ES_SURFACE_3D\n"
            "highp vec3 lightVector(in highp vec4 pd, in highp vec4 sh, in highp vec3 worldPos) {\n"
            "    return vec3(pd.xy, sh.z) - worldPos;\n"
            "}\n"
            "highp float lightDistance(in highp vec3 toLight) { return length(toLight); }\n"
            "highp float spotCone(in highp vec4 sp, in highp vec4 sh, in highp vec3 toLight,\n"
            "                     in highp float dist) {\n"
            "    highp vec3 axis = normalize(vec3(sp.xy, sh.w));\n"
            "    highp vec3 toFrag = (dist > 0.0001) ? -toLight / dist : axis;\n"
            "    return smoothstep(sp.w, sp.z, dot(axis, toFrag));\n"
            "}\n"
            "#else\n"
            "highp vec3 lightVector(in highp vec4 pd, in highp vec4 sh, in highp vec3 worldPos) {\n"
            "    return vec3(pd.xy - worldPos.xy, max(pd.w, 1.0));\n"
            "}\n"
            "highp float lightDistance(in highp vec3 toLight) { return length(toLight.xy); }\n"
            "highp float spotCone(in highp vec4 sp, in highp vec4 sh, in highp vec3 toLight,\n"
            "                     in highp float dist) {\n"
            // A cone aimed out of the plane has no axis IN it, and this half of the
            // shading has nowhere else to read one, so it keeps lighting the way an
            // unrotated spot always has.
            "    highp vec2 axis = dot(sp.xy, sp.xy) > 1e-8 ? normalize(sp.xy) : vec2(0.0, -1.0);\n"
            "    highp vec2 toFrag = (dist > 0.0001) ? -toLight.xy / dist : axis;\n"
            "    return smoothstep(sp.w, sp.z, dot(axis, toFrag));\n"
            "}\n"
            "#endif\n"
            // A light sitting exactly on the surface has no direction to give; the plane's
            // convention could never produce one, real positions can. Lighting it along its
            // own normal is the limit that approaches from every side.
            "highp vec3 towardLight(in highp vec3 toLight, in highp vec3 N) {\n"
            "    return dot(toLight, toLight) > 1e-8 ? normalize(toLight) : N;\n"
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
            // environment; a surface's own lights are unobstructed by it.
            "    highp vec3 lit = envIrradiance(N) * ao;\n"
            "    highp vec3 gloss = vec3(0.0);\n"
            // A Light has no third coordinate, so distance stays in the plane and a
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
            "            highp vec3 toL = lightVector(pd, sh, worldPos);\n"
            "            highp float dist = lightDistance(toL);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = towardLight(toL, N);\n"
            "        } else if (pd.z < 1.5) {\n"
            "            atten = 1.0;\n"
            // pd.w is the aim's third component here; point/spot spend that slot on radius.
            "            L = normalize(-vec3(pd.xy, pd.w));\n"
            // Directional rays are parallel: aim at a far point toward the light source, opt in via
            // a positive march distance, and require a real direction (a zeroed one casts nothing).
            "            highp vec2 toLight = (dot(pd.xy, pd.xy) > 1e-8) ? normalize(-pd.xy) : vec2(0.0);\n"
            "            castShadow = sh.y > 0.0 && dot(toLight, toLight) > 0.5;\n"
            "            target = worldPos.xy + toLight * sh.y;\n"
            "        } else {\n"
            "            highp vec4 sp = u_lights[i].spot;\n"
            "            highp vec3 toL = lightVector(pd, sh, worldPos);\n"
            "            highp float dist = lightDistance(toL);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = towardLight(toL, N);\n"
            "            atten *= spotCone(sp, sh, toL, dist);\n"
            "        }\n"
            // Only pay for the shadow test when the light actually reaches this fragment (skips the
            // zeroed/inactive slots and unlit fragments — cheaper than the old unconditional call).
            "        if (castShadow && col.a > 0.0 && atten > 0.0) {\n"
            "            atten *= shadowFactor2D(worldPos.xy, target, sh.x);\n"
            "        }\n"
            // The tiles this light rendered into, which are its own: a fragment
            // tested against every map in the atlas would be darkened by geometry
            // seen from somewhere no light reaching it is standing.
            "        highp vec4 sm = u_lights[i].shadowMap;\n"
            "        if (sm.y > 0.0 && atten > 0.0) {\n"
            "            atten *= shadowFactor3D(worldPos, N, L, vec2(sh.x, sm.z),\n"
            "                                    int(sm.x), int(sm.y));\n"
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
            "    gloss += envRadiance(reflect(-V, N), roughness) * (ao * specular)\n"
            "           * (F0 * ab.x + ab.y);\n"
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
        assembled << kLitHeader;
        headerLines += countNewlines(kLitHeader);
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
