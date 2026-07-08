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
    src += "};\n";
    return src;
}

// WGSL twin of canonical2DVertexStage: same attribute locations, FrameConstants
// at group 0 binding 0, GLSL names kept behind struct fields (a_position ->
// v.a_position) so the two stages diff cleanly.
std::string canonical2DVertexStageWGSL(bool lit) {
    std::string src =
        "struct FrameConstants { projection : mat4x4f };\n"
        "@group(0) @binding(0) var<uniform> frame : FrameConstants;\n"
        "\n";
    src += wgslCanonicalVSOut(lit);
    src +=
        "\n"
        "struct VSIn {\n"
        "    @location(0) a_position : vec2f,\n"
        "    @location(1) a_color : vec4f,\n"
        "    @location(2) a_texCoord : vec2f,\n"
        "};\n"
        "\n"
        "@vertex fn vs_main(v : VSIn) -> VSOut {\n"
        "    var out : VSOut;\n"
        "    out.pos = frame.projection * vec4f(v.a_position, 0.0, 1.0);\n"
        "    out.v_color = v.a_color;\n"
        "    out.v_texCoord = v.a_texCoord;\n";
    if (lit) {
        src += "    out.v_worldPos = v.a_position;\n";
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

// Canonical 2D vertex stage for fragment-only .esshaders: the batch path bakes the
// world transform into the vertices, so all 2D shaders share this pass-through.
std::string canonical2DVertexStage(bool lit) {
    std::string src =
        "layout(location = 0) in vec2 a_position;\n"
        "layout(location = 1) in vec4 a_color;\n"
        "layout(location = 2) in vec2 a_texCoord;\n"
        "\n"
        "layout(std140) uniform FrameConstants {\n"
        "    mat4 u_projection;\n"
        "};\n"
        "\n"
        "out vec4 v_color;\n"
        "out vec2 v_texCoord;\n";
    if (lit) {
        src += "out highp vec2 v_worldPos;\n";
    }
    src +=
        "\n"
        "void main() {\n"
        "    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);\n"
        "    v_color = a_color;\n"
        "    v_texCoord = a_texCoord;\n";
    if (lit) {
        src += "    v_worldPos = a_position;\n";
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
            // WGSL twin section; no tag is the GLSL stage.
            if (!argument.empty() && argument != "wgsl") {
                result.errorMessage = "Unknown stage language '" + argument +
                                      "' at line " + std::to_string(lineNumber) +
                                      " (expected no tag for GLSL, or 'wgsl')";
                return result;
            }
            state = (directive == "vertex") ? ParseState::Vertex : ParseState::Fragment;
            currentSectionIsWGSL = (argument == "wgsl");
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
                    currentSectionMap.clear();
                    currentSectionIsWGSL = false;
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
fn applyLighting2D(albedo : vec3f, N : vec3f, worldPos : vec2f) -> vec3f {
    var lit = lc.u_ambient.rgb;
    for (var i = 0; i < 16; i++) {
        let pd = lc.u_lights[i].posDir;
        let col = lc.u_lights[i].color;
        let sh = lc.u_lights[i].shadow;
        var L : vec3f;
        var atten : f32;
        var aim = pd.xy;
        var castShadow = true;
        if (pd.z < 0.5) {
            let d = pd.xy - worldPos;
            let dist = length(d);
            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));
            L = normalize(vec3f(d, max(pd.w, 1.0)));
        } else if (pd.z < 1.5) {
            atten = 1.0;
            L = normalize(vec3f(-pd.xy, 1.0));
            var toLight = vec2f(0.0, 0.0);
            if (dot(pd.xy, pd.xy) > 1e-8) { toLight = normalize(-pd.xy); }
            castShadow = sh.y > 0.0 && dot(toLight, toLight) > 0.5;
            aim = worldPos + toLight * sh.y;
        } else {
            let sp = lc.u_lights[i].spot;
            let d = pd.xy - worldPos;
            let dist = length(d);
            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));
            L = normalize(vec3f(d, max(pd.w, 1.0)));
            var toFrag = sp.xy;
            if (dist > 0.0001) { toFrag = -d / dist; }
            atten *= smoothstep(sp.w, sp.z, dot(sp.xy, toFrag));
        }
        if (castShadow && col.a > 0.0 && atten > 0.0) {
            atten *= shadowFactor2D(worldPos, aim, sh.x);
        }
        let ndotl = max(dot(N, L), 0.0);
        lit += col.rgb * (col.a * ndotl * atten);
    }
    return albedo * lit;
}
)";

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
    }

    assembled << bodyIt->second;

    result.source = preprocessWGSL(assembled.str(), features);
    result.headerLineCount = headerLines;
    return result;
}

}  // namespace

ShaderParser::AssembledStage ShaderParser::assembleStageEx(const ParsedShader& parsed,
                                                           ShaderStage stage,
                                                           const std::string& platform,
                                                           const std::vector<std::string>& features,
                                                           ShaderTargetLanguage target) {
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
            "highp vec3 applyLighting2D(highp vec3 albedo, highp vec3 N, highp vec2 worldPos) {\n"
            "    highp vec3 lit = u_ambient.rgb;\n"
            "    for (int i = 0; i < 16; ++i) {\n"
            "        highp vec4 pd = u_lights[i].posDir;\n"
            "        highp vec4 col = u_lights[i].color;\n"
            "        highp vec4 sh = u_lights[i].shadow;\n"  // x = penumbra softness, y = directional distance
            "        highp vec3 L;\n"
            "        highp float atten;\n"
            "        highp vec2 target = pd.xy;\n"           // shadow-ray aim point (light position by default)
            "        bool castShadow = true;\n"
            "        if (pd.z < 0.5) {\n"
            "            highp vec2 d = pd.xy - worldPos;\n"
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
            "            target = worldPos + toLight * sh.y;\n"
            "        } else {\n"
            "            highp vec4 sp = u_lights[i].spot;\n"
            "            highp vec2 d = pd.xy - worldPos;\n"
            "            highp float dist = length(d);\n"
            "            atten = max(0.0, 1.0 - dist / max(pd.w, 0.0001));\n"
            "            L = normalize(vec3(d, max(pd.w, 1.0)));\n"
            "            highp vec2 toFrag = (dist > 0.0001) ? (-d / dist) : sp.xy;\n"
            "            atten *= smoothstep(sp.w, sp.z, dot(sp.xy, toFrag));\n"
            "        }\n"
            // Only pay for the shadow test when the light actually reaches this fragment (skips the
            // zeroed/inactive slots and unlit fragments — cheaper than the old unconditional call).
            "        if (castShadow && col.a > 0.0 && atten > 0.0) {\n"
            "            atten *= shadowFactor2D(worldPos, target, sh.x);\n"
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
