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
#include "../renderer/store/InstanceConstants.hpp"
#include "../renderer/store/MaterialConstants.hpp"
#include "../renderer/rhi/GfxEnums.hpp"
#include "../renderer/rhi/WgslBindings.hpp"

#include <string_view>
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <unordered_set>

namespace esengine::resource {

// =============================================================================
// Include Expansion
// =============================================================================

namespace {

// The pieces of a stream this file used, without the stream: libc++'s iostream pulls its locale machinery into the module for the sake of
// splitting lines and appending text, and these do both.

/// getline(stream, line) over a string: lines split at '\n', no empty line after a final one, an empty source yields none.
class LineReader {
public:
    explicit LineReader(const std::string& text) : text_(text) {}
    bool next(std::string& line) {
        if (pos_ >= text_.size()) return false;
        const usize end = text_.find('\n', pos_);
        if (end == std::string::npos) {
            line.assign(text_, pos_, std::string::npos);
            pos_ = text_.size();
        } else {
            line.assign(text_, pos_, end - pos_);
            pos_ = end + 1;
        }
        return true;
    }

private:
    const std::string& text_;
    usize pos_ = 0;
};

/// `stream >> token`: the next run of non-space characters, empty when there are none left.
std::string nextToken(const std::string& text, usize& pos) {
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos;
    const usize start = pos;
    while (pos < text.size() && !std::isspace(static_cast<unsigned char>(text[pos]))) ++pos;
    return text.substr(start, pos - start);
}

/// An ostringstream that only appends.
class TextBuilder {
public:
    TextBuilder& operator<<(const std::string& s) { text_ += s; return *this; }
    TextBuilder& operator<<(std::string_view s) { text_ += s; return *this; }
    TextBuilder& operator<<(const char* s) { text_ += s; return *this; }
    TextBuilder& operator<<(char c) { text_ += c; return *this; }
    const std::string& str() const { return text_; }
    void str(const char*) { text_.clear(); }
    void clear() {}

private:
    std::string text_;
};

/**
 * @brief How a vertex stage reaches its own object's record.
 *
 * @details Built from the layout constants rather than written out, so the texel
 *          a shader reads and the texel the packer writes cannot drift apart.
 *          `esInstance*` is the name a stage reaches for; a stage that names one
 *          gets this header, the way a stage that names `tN` gets that unit.
 */
/** @brief The same record, for a WGSL vertex stage. @see instanceRecordGLSLDecls */
std::string instanceRecordWGSL() {
    const std::string texels = std::to_string(MESH_INSTANCE_TEXELS);
    const std::string width = std::to_string(MESH_INSTANCE_TEXTURE_WIDTH);
    const std::string unit = std::to_string(MESH_INSTANCE_TEXTURE_UNIT);
    return
        "struct InstanceConstants { base : vec4u };\n"
        "@group(0) @binding(" + std::to_string(INSTANCE_CONSTANTS_BINDING)
            + ") var<uniform> inst : InstanceConstants;\n"
        // vs_main's instance_index, put where the helpers can reach it — WGSL has
        // no global for it the way GLSL has gl_InstanceID.
        "var<private> g_instanceId : i32 = 0;\n"
        "fn esInstanceTexel(texel : i32) -> vec4f {\n"
        "    let at = (i32(inst.base.x) + g_instanceId) * " + texels + " + texel;\n"
        "    return textureLoad(t" + unit + ", vec2i(at % " + width + ", at / " + width + "), 0);\n"
        "}\n"
        "fn esInstanceModel() -> mat4x4f {\n"
        "    let r0 = esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_MODEL) + ");\n"
        "    let r1 = esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_MODEL + 1) + ");\n"
        "    let r2 = esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_MODEL + 2) + ");\n"
        "    return mat4x4f(vec4f(r0.x, r1.x, r2.x, 0.0), vec4f(r0.y, r1.y, r2.y, 0.0),\n"
        "                   vec4f(r0.z, r1.z, r2.z, 0.0), vec4f(r0.w, r1.w, r2.w, 1.0));\n"
        "}\n"
        "fn esInstanceNormalMatrix() -> mat3x3f {\n"
        "    return mat3x3f(esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_NORMAL) + ").xyz,\n"
        "                   esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_NORMAL + 1) + ").xyz,\n"
        "                   esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_NORMAL + 2) + ").xyz);\n"
        "}\n"
        "fn esInstanceTint() -> vec4f { return esInstanceTexel("
            + std::to_string(MESH_INSTANCE_TEXEL_TINT) + "); }\n"
        "fn esInstanceLightmapRect() -> vec4f { return esInstanceTexel("
            + std::to_string(MESH_INSTANCE_TEXEL_LIGHTMAP) + "); }\n";
}

/**
 * @brief The record's block, texture and prototypes; the bodies follow the stage.
 * @details ANGLE on D3D11 caches input layouts by vertex format and puts SV_InstanceID
 *          where gl_InstanceID first appears, so naming it before the attributes shifts
 *          them for every program sharing the layout.
 */
std::string instanceRecordGLSLDecls() {
    return
        "layout(std140) uniform InstanceConstants {\n"
        "    highp uvec4 u_instanceBase;\n"
        "};\n"
        "uniform highp sampler2D u_instanceData;\n"
        "highp vec4 esInstanceTexel(int texel);\n"
        "highp mat4 esInstanceModel();\n"
        "highp mat3 esInstanceNormalMatrix();\n"
        "highp vec4 esInstanceTint();\n"
        "highp vec4 esInstanceLightmapRect();\n";
}

std::string instanceRecordGLSLBodies() {
    const std::string texels = std::to_string(MESH_INSTANCE_TEXELS);
    const std::string width = std::to_string(MESH_INSTANCE_TEXTURE_WIDTH);
    return
        "highp vec4 esInstanceTexel(int texel) {\n"
        "    int at = (int(u_instanceBase.x) + ES_INSTANCE_ID) * " + texels + " + texel;\n"
        "    return texelFetch(u_instanceData, ivec2(at % " + width + ", at / " + width + "), 0);\n"
        "}\n"
        "highp mat4 esInstanceModel() {\n"
        "    highp vec4 r0 = esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_MODEL) + ");\n"
        "    highp vec4 r1 = esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_MODEL + 1) + ");\n"
        "    highp vec4 r2 = esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_MODEL + 2) + ");\n"
        "    return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0),\n"
        "                vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 1.0));\n"
        "}\n"
        "highp mat3 esInstanceNormalMatrix() {\n"
        "    return mat3(esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_NORMAL) + ").xyz,\n"
        "                esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_NORMAL + 1) + ").xyz,\n"
        "                esInstanceTexel(" + std::to_string(MESH_INSTANCE_TEXEL_NORMAL + 2) + ").xyz);\n"
        "}\n"
        "highp vec4 esInstanceTint() { return esInstanceTexel("
            + std::to_string(MESH_INSTANCE_TEXEL_TINT) + "); }\n"
        "highp vec4 esInstanceLightmapRect() { return esInstanceTexel("
            + std::to_string(MESH_INSTANCE_TEXEL_LIGHTMAP) + "); }\n";
}


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

    LineReader stream(source);
    std::string line;
    u32 lineNumber = 0;
    while (stream.next(line)) {
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

// Swap a placeholder that a canonical stage's literal text carries for the material's hook (or
// nothing, which is what keeps a stage without one byte-for-byte what it was).
void fillHook(std::string& src, const std::string& token, const std::string& text) {
    for (usize at = src.find(token); at != std::string::npos; at = src.find(token, at + text.size())) {
        src.replace(at, token.size(), text);
    }
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
        // The layer the sprite is on (plus 129), or 0 where the draw has none to give.
        src += "    @location(8) @interpolate(flat) v_lightLayer : f32,\n";
    }
    // A mesh that HAS normals hands them on, with the full world position a
    // tangent frame needs. v_worldPos stays vec2 so one fragment stage serves
    // both vertex sources.
    src +=
        "#ifdef MESH_NORMALS\n"
        "    @location(3) v_worldNormal : vec3f,\n"
        "    @location(4) v_worldXYZ : vec3f,\n"
        "#endif\n"
        // The geometry's own tangent frame (xyz along +u, w the bitangent's handedness), when the mesh carries one.
        "#ifdef MESH_TANGENTS\n"
        "    @location(7) v_worldTangent : vec4f,\n"
        "#endif\n"
        // mesh.esshader's twin of the same varying, carried through a material's
        // variant so the LAYOUT matches. What a material's fragment makes of it
        // is the material's, as all of its shading is.
        "#ifdef MESH_LIGHTMAP\n"
        "    @location(5) v_lightmap : vec3f,\n"
        "#endif\n";
    if (lit) {
        // Which run of coefficients this instance reads. Flat: an index, not a
        // gradient — and the fragment stage has no instance number of its own.
        src += "    @location(6) @interpolate(flat) v_probeSlot : f32,\n";
    }
    src += "};\n";
    return src;
}

// WGSL twin of canonicalVertexStage: same attribute locations, GLSL names
// kept behind struct fields (a_position -> v.a_position) so the two stages diff
// cleanly. FrameConstants arrives with the injected headers.
std::string canonicalVertexStageWGSL(bool lit, const std::string& hook = {}) {
    std::string src = wgslCanonicalVSOut(lit);
    src +=
        "\n"
        "#ifdef SKINNED\n"
        "struct SkinConstants { bones : array<mat4x4f, 64> };\n"
        "@group(0) @binding(5) var<uniform> skin : SkinConstants;\n"
        "#endif\n"
        "#ifdef MESH\n"
        // The GLSL twin's morph block. Declaring the texture in the VERTEX stage
        // is what earns it vertex visibility in the bind-group layout.
        "struct MorphConstants { info : vec4f, shape : array<vec4f, 8> };\n"
        "@group(0) @binding(6) var<uniform> morph : MorphConstants;\n"
        "@group(1) @binding(4) var t4 : texture_2d<f32>;\n"
        "fn morphDelta(index : f32) -> vec3f {\n"
        "    let width = morph.info.w;\n"
        "    return textureLoad(t4, vec2i(i32(index % width), i32(index / width)), 0).xyz;\n"
        "}\n"
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
        "#ifdef MESH_LIGHTMAP\n"
        "    @location(7) a_texCoord1 : vec2f,\n"
        "#endif\n"
        "#ifdef MESH_TANGENTS\n"
        "    @location(4) a_tangent : vec4f,\n"
        "#endif\n"
        + std::string(lit ? "#if !defined(MESH) && !defined(SKINNED)\n"
                            "    @location(4) a_lightLayer : f32,\n"
                            "#endif\n" : "") +
        "#ifdef SKINNED\n"
        "    @location(5) a_joints : vec4u,\n"
        "    @location(6) a_weights : vec4f,\n"
        "#endif\n"
        "#ifdef MESH\n"
        // What the GLSL twin reads as gl_VertexID.
        "    @builtin(vertex_index) vertexIndex : u32,\n"
        "#endif\n"
        "#endif\n"
        "};\n"
        "\n"
        "\n"
        "@@WGSL_HOOK@@"
        "@vertex fn vs_main(v : VSIn, @builtin(instance_index) instanceId : u32) -> VSOut {\n"
        "    var out : VSOut;\n"
        "    g_instanceId = i32(instanceId);\n"
        "#ifdef MESH\n"
        "    var local = v.a_position;\n"
        "#ifdef MESH_NORMALS\n"
        "    var localNormal = v.a_normal;\n"
        "#else\n"
        "    var localNormal = vec3f(0.0, 0.0, 1.0);\n"
        "#endif\n"
        // Before the pose: a target was authored against the mesh at rest.
        "    let live = i32(morph.info.x);\n"
        "    for (var i = 0; i < 8; i = i + 1) {\n"
        "        if (i >= live) { break; }\n"
        "        let at = (morph.shape[i].x * morph.info.y + f32(v.vertexIndex)) * morph.info.z;\n"
        "        local = local + morph.shape[i].y * morphDelta(at);\n"
        "        if (morph.info.z > 1.5) {\n"
        "            localNormal = localNormal + morph.shape[i].y * morphDelta(at + 1.0);\n"
        "        }\n"
        "    }\n"
        "@@WGSL_CALL@@"
        "#endif\n"
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
        "    let world = pose * vec4f(local, 1.0);\n"
        "    out.v_color = v.a_color * esInstanceTint();\n"
        "#elif defined(MESH)\n"
        "    let world = esInstanceModel() * vec4f(local, 1.0);\n"
        "    out.v_color = @@WGSL_MESH_COLOR@@ * esInstanceTint();\n"
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
        "    out.v_worldNormal = mat3x3f(pose[0].xyz, pose[1].xyz, pose[2].xyz) * localNormal;\n"
        "#else\n"
        "    out.v_worldNormal = esInstanceNormalMatrix() * localNormal;\n"
        "#endif\n"
        "    out.v_worldXYZ = world.xyz;\n"
        "#ifdef MESH_TANGENTS\n"
        "#ifdef SKINNED\n"
        "    out.v_worldTangent = vec4f(mat3x3f(pose[0].xyz, pose[1].xyz, pose[2].xyz) * v.a_tangent.xyz, v.a_tangent.w);\n"
        "#else\n"
        "    let tangentModel = mat3x3f(esInstanceModel()[0].xyz, esInstanceModel()[1].xyz, esInstanceModel()[2].xyz);\n"
        "    out.v_worldTangent = vec4f(tangentModel * v.a_tangent.xyz,\n"
        "                               select(v.a_tangent.w, -v.a_tangent.w, determinant(tangentModel) < 0.0));\n"
        "#endif\n"
        "#endif\n"
        "#endif\n"
        "#ifdef MESH_LIGHTMAP\n"
        "    let lmRect = esInstanceLightmapRect();\n"
        "    out.v_lightmap = vec3f(v.a_texCoord1 * lmRect.xy + lmRect.zw,\n"
        "                           select(0.0, 1.0, lmRect.x > 0.0));\n"
        "#endif\n";
    if (lit) {
        src += "    out.v_worldPos = world.xy;\n";
        src += "#if !defined(MESH) && !defined(SKINNED) && !defined(PARTICLE)\n    out.v_lightLayer = v.a_lightLayer;\n#else\n    out.v_lightLayer = 0.0;\n#endif\n";
        // Declared by wgslVSOut under the same condition, so filled here —
        // a slot left at zero makes every instance read the first probe.
        src += "    out.v_probeSlot = f32(instanceId);\n";
    }
    src +=
        "    return out;\n"
        "}\n";
    // The vertex's own colour is the one per-vertex channel a hook has besides its position, normal and uv: wind sways a plant by
    // a weight painted in it. A hook reads `es_vertexColor`, and what it leaves there is the colour the fragment gets (a terrain
    // tells it where the vertex lies in its height pages); one that does not touch it is not changed.
    fillHook(src, "@@WGSL_MESH_COLOR@@", hook.empty() ? std::string("v.a_color") : std::string("es_vertexColor"));
    fillHook(src, "@@WGSL_HOOK@@", hook.empty() ? std::string() :
        "#ifdef MESH\nvar<private> es_vertexColor : vec4f;\n" + hook + "\n#endif\n");
    fillHook(src, "@@WGSL_CALL@@", hook.empty() ? std::string() :
        "    es_vertexColor = v.a_color;\n    esMaterialVertex(&local, &localNormal, v.a_texCoord);\n");
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

// WGSL twin of canonicalPPVertexStage. The uv comes out in this device's texture
// space, row 0 at the top: the screen's y-up uv would sample a target this device
// stored top-down upside down, and every fullscreen pass would turn the image over.
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
        "    out.v_texCoord = vec2f(v.a_texCoord.x, 1.0 - v.a_texCoord.y);\n"
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
std::string canonicalVertexStage(bool lit, const std::string& hook = {}) {
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
        "#ifdef MESH_LIGHTMAP\n"
        "layout(location = 7) in vec2 a_texCoord1;\n"
        "#endif\n"
        "#ifdef MESH_TANGENTS\n"
        "layout(location = 4) in vec4 a_tangent;\n"
        "#endif\n"
        // The batch layout carries a sprite's layer in the lane text spends on its outline (see SPRITE_LAYER_BIAS); a lit batch draw reads it.
        + std::string(lit ? "#if !defined(MESH) && !defined(SKINNED)\n"
                            "layout(location = 4) in float a_lightLayer;\n"
                            "#endif\n" : "") +
        "#ifdef SKINNED\n"
        "layout(location = 5) in uvec4 a_joints;\n"
        "layout(location = 6) in vec4 a_weights;\n"
        // This draw's pose, rewritten immediately before it (SkinConstants, binding 5).
        "layout(std140) uniform SkinConstants {\n"
        "    mat4 u_bones[64];\n"
        "};\n"
        "#endif\n"
        "#endif\n"
        "#ifdef MESH\n"
        // The shapes a resident mesh is blended towards. See mesh.esshader, whose
        // vertex stage says the same thing to the same blocks: a material's mesh
        // variant deforms the same geometry, so it must deform it the same way.
        "layout(std140) uniform MorphConstants {\n"
        "    vec4 u_morphInfo;\n"
        "    vec4 u_morphShape[8];\n"
        "};\n"
        "uniform highp sampler2D u_morphDeltas;\n"
        "vec3 morphDelta(float index) {\n"
        "    float width = u_morphInfo.w;\n"
        "    return texelFetch(u_morphDeltas, ivec2(int(mod(index, width)), int(index / width)), 0).xyz;\n"
        "}\n"
        "void applyMorph(inout vec3 position, inout vec3 normal) {\n"
        "    int live = int(u_morphInfo.x);\n"
        "    float perVertex = u_morphInfo.z;\n"
        "    for (int i = 0; i < 8; i++) {\n"
        "        if (i >= live) break;\n"
        "        float at = (u_morphShape[i].x * u_morphInfo.y + float(gl_VertexID)) * perVertex;\n"
        "        position += u_morphShape[i].y * morphDelta(at);\n"
        "        if (perVertex > 1.5) normal += u_morphShape[i].y * morphDelta(at + 1.0);\n"
        "    }\n"
        "}\n"
        "#endif\n"
        "\n"
        "out vec4 v_color;\n"
        "out vec2 v_texCoord;\n"
        "#ifdef MESH_NORMALS\n"
        "out highp vec3 v_worldNormal;\n"
        "out highp vec3 v_worldXYZ;\n"
        "#ifdef MESH_TANGENTS\n"
        "out highp vec4 v_worldTangent;\n"
        "#endif\n"
        "#endif\n"
        "#ifdef MESH_LIGHTMAP\n"
        "out highp vec3 v_lightmap;\n"
        "#endif\n";
    if (lit) {
        src += "out highp vec2 v_worldPos;\n";
        // The layer the sprite is on (plus 129), or 0 where the draw has none to give. Flat: it is a label, not a gradient.
        src += "flat out highp float v_lightLayer;\n";
        // Which run of coefficients THIS instance reads. The fragment stage has
        // no instance index, and the draw's own base is the same for every
        // instance in a merged run — so the one stage that can say it, says it.

    }
    src +=
        "\n"
        "@@GLSL_HOOK@@"
        "void main() {\n"
        "#ifdef MESH\n"
        "    vec3 local = a_position;\n"
        "#ifdef MESH_NORMALS\n"
        "    vec3 localNormal = a_normal;\n"
        "#else\n"
        "    vec3 localNormal = vec3(0.0, 0.0, 1.0);\n"
        "#endif\n"
        // Before the pose: a target was authored against the mesh at rest.
        "    applyMorph(local, localNormal);\n"
        "@@GLSL_CALL@@"
        "#endif\n"
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
        "    vec4 world = skin * vec4(local, 1.0);\n"
        "    v_color = a_color * esInstanceTint();\n"
        "#elif defined(MESH)\n"
        "    vec4 world = esInstanceModel() * vec4(local, 1.0);\n"
        "    v_color = @@GLSL_MESH_COLOR@@ * esInstanceTint();\n"
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
        "    v_worldNormal = mat3(skin) * localNormal;\n"
        "#else\n"
        "    v_worldNormal = esInstanceNormalMatrix() * localNormal;\n"
        "#endif\n"
        "    v_worldXYZ = world.xyz;\n"
        "#ifdef MESH_TANGENTS\n"
        "#ifdef SKINNED\n"
        "    v_worldTangent = vec4(mat3(skin) * a_tangent.xyz, a_tangent.w);\n"
        "#else\n"
        "    mat3 tangentModel = mat3(esInstanceModel());\n"
        // A mirrored placement turns the bitangent the other way round.
        "    v_worldTangent = vec4(tangentModel * a_tangent.xyz, determinant(tangentModel) < 0.0 ? -a_tangent.w : a_tangent.w);\n"
        "#endif\n"
        "#endif\n"
        "#endif\n"
        "#ifdef MESH_LIGHTMAP\n"
        "    highp vec4 lmRect = esInstanceLightmapRect();\n"
        "    v_lightmap = vec3(a_texCoord1 * lmRect.xy + lmRect.zw,\n"
        "                      lmRect.x > 0.0 ? 1.0 : 0.0);\n"
        "#endif\n";
    if (lit) {
        src += "    v_worldPos = world.xy;\n";
        src += "#if !defined(MESH) && !defined(SKINNED) && !defined(PARTICLE)\n    v_lightLayer = a_lightLayer;\n#else\n    v_lightLayer = 0.0;\n#endif\n";
        // The instance's own run of probe coefficients — declared by the Lit
        // vertex header, so filled under the same condition.
        src += "    v_probeSlot = float(ES_INSTANCE_ID);\n";
    }
    src += "}\n";
    fillHook(src, "@@GLSL_MESH_COLOR@@", hook.empty() ? std::string("a_color") : std::string("es_vertexColor"));
    fillHook(src, "@@GLSL_HOOK@@", hook.empty() ? std::string() :
        "#ifdef MESH\nhighp vec4 es_vertexColor;\n" + hook + "\n#endif\n");
    fillHook(src, "@@GLSL_CALL@@", hook.empty() ? std::string() :
        "    es_vertexColor = a_color;\n    esMaterialVertex(local, localNormal, a_texCoord);\n");
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
    Variant,
    VertexHook
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

    LineReader stream(expanded);
    std::string line;
    ParseState state = ParseState::Global;
    std::string currentVariantName;
    TextBuilder currentSection;
    std::vector<SourceLine> currentSectionMap;
    bool currentSectionIsWGSL = false;
    bool currentSectionIsFullWGSL = false;
    u32 lineNumber = 0;

    while (stream.next(line)) {
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

        if (directive == "coverage") {
            result.coverageParam = argument;
            continue;
        }

        if (directive == "tips") {
            result.tipParam = argument;
            continue;
        }

        if (directive == "hairshadow") {
            result.hairShadowParam = argument;
            continue;
        }

        if (directive == "gbuffer") {
            result.usesGBuffer = true;
            continue;
        }

        if (directive == "lights") {
            result.usesLights = true;
            continue;
        }

        if (directive == "highprecision") {
            result.highPrecision = true;
            continue;
        }

        if (directive == "vertexbounds") {
            // How far the vertex hook may move a vertex, in the mesh's local units.
            result.vertexBounds = std::strtof(argument.c_str(), nullptr);
            if (!(result.vertexBounds >= 0.0f)) result.vertexBounds = 0.0f;
            continue;
        }

        if (directive == "vertexoffset") {
            if (state != ParseState::Global) {
                result.errorMessage = "Unexpected #pragma vertexoffset at line " + std::to_string(lineNumber);
                return result;
            }
            if (!argument.empty() && argument != "wgsl") {
                result.errorMessage = "Unknown vertexoffset language '" + argument + "' at line " +
                                      std::to_string(lineNumber) + " (expected no tag for GLSL, or 'wgsl')";
                return result;
            }
            state = ParseState::VertexHook;
            currentSectionIsWGSL = !argument.empty();
            currentSectionIsFullWGSL = false;
            currentSection.str("");
            currentSection.clear();
            currentSectionMap.clear();
            continue;
        }

        if (directive == "domain") {
            if (!argument.empty()) result.domain = normalizeDomain(argument);
            continue;
        }

        if (directive == "switch") {
            // Material-controlled compile-time toggle: `#pragma switch NAME [default(on|off)]`.
            usize swPos = 0;
            ShaderSwitch decl;
            decl.name = nextToken(argument, swPos);
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
                case ParseState::VertexHook:
                    (currentSectionIsWGSL ? result.wgslVertexHook : result.vertexHook) = currentSection.str();
                    currentSectionMap.clear();
                    currentSectionIsWGSL = false;
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
            case ParseState::VertexHook:
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
            result.stages[ShaderStage::Vertex] = canonicalVertexStage(result.domain == "Lit", result.vertexHook);
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
            result.wgslStages[ShaderStage::Vertex] = canonicalVertexStageWGSL(result.domain == "Lit", result.wgslVertexHook);
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
    "struct FrameConstants {\n"
    "    projection : mat4x4f,\n"
    "    camera : vec4f,\n"
    "    inverseViewProjection : mat4x4f,\n"
    "    renderOrigin : vec4f,\n"
    "};\n"
    "@group(0) @binding(0) var<uniform> frame : FrameConstants;\n"
    "fn viewDirection(worldPos : vec3f) -> vec3f {\n"
    "    if (frame.camera.w > 0.5) { return normalize(frame.camera.xyz - worldPos); }\n"
    "    return frame.camera.xyz;\n"
    "}\n"
    // A fullscreen pass's uv runs down the screen here, and this device clips z to [0, 1].
    "fn worldFromDepth(uv : vec2f, depth : f32) -> vec3f {\n"
    "    let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);\n"
    "    let world = frame.inverseViewProjection * clip;\n"
    "    return world.xyz / world.w;\n"
    "}\n";

const char* kTimeHeaderWGSL =
    "struct TimeConstants { u_time : vec4f, u_viewport : vec4f };\n"
    "@group(0) @binding(3) var<uniform> tc : TimeConstants;\n";

// The batch texture contract for fragment-only 2D twins: u_textures[8]
// de-combined into texture_2d t0..t7 (bindings 0..7) + samplers s0..s7
// (bindings 8..15) — the group-1 convention (WebGPUMappings). Bodies sample
// `textureSampleLevel(t0, s0, uv, 0.0)` where GLSL reads u_textures[0].
std::string wgslBatchTextureDecls(bool postProcess) {
    std::string src;
    for (u32 i = 0; i < 8; ++i) {
        const std::string n = std::to_string(i);
        // A fullscreen pass reads the scene's DEPTH at the top engine unit, and a
        // depth texture is its own WGSL type with no sampler under it. PostProcess
        // only: unit 7 is an ordinary batch texture in every other domain.
        if (postProcess && i == kSceneDepthUnit) {
            src += "@group(1) @binding(" + n + ") var t" + n + " : texture_depth_2d;\n";
            continue;
        }
        src += "@group(1) @binding(" + n + ") var t" + n + " : texture_2d<f32>;\n";
        src += "@group(1) @binding(" + std::to_string(8 + i) + ") var s" + n + " : sampler;\n";
    }
    return src;
}

/**
 * The `tN` / `sN` bindings a stage NAMES and has not declared for itself. The engine
 * owns what `tN` means, so it completes the set rather than asking a twin to repeat the
 * convention — an unresolved name is an invalid pipeline that mentions no shader. An
 * already-declared unit is left alone, so a cooked twin assembles unchanged.
 */
std::string wgslReachedTextureDecls(const std::string& source, bool postProcess) {
    u32 reachedTex = 0;
    u32 reachedSam = 0;
    scanWGSLReachedUnits(source.c_str(), reachedTex, reachedSam);
    const u32 declared = scanWGSLBindingMask(source.c_str(), 1);
    std::string src;
    for (u32 unit = 0; unit < WGSL_MAX_TEXTURE_UNITS; ++unit) {
        const std::string n = std::to_string(unit);
        if ((reachedTex & (1u << unit)) != 0
            && (declared & (1u << textureBindingForUnit(unit))) == 0) {
            // A fullscreen pass reads the scene's DEPTH at the top engine unit, and a
            // depth texture is its own WGSL type with no sampler under it.
            src += "@group(1) @binding(" + std::to_string(textureBindingForUnit(unit)) + ") var t" + n
                 + (postProcess && unit == kSceneDepthUnit ? " : texture_depth_2d;\n"
                                                           : " : texture_2d<f32>;\n");
        }
        if ((reachedSam & (1u << unit)) != 0
            && (declared & (1u << samplerBindingForUnit(unit))) == 0) {
            src += "@group(1) @binding(" + std::to_string(samplerBindingForUnit(unit)) + ") var s" + n
                 + " : sampler;\n";
        }
    }
    return src;
}

// #pragma param texture uniforms: material units (>= 8) take the unit→binding
// convention in rhi/WgslBindings.hpp, and the sampler rides the param's own name with
// an _s suffix: textureSampleLevel(u_mask, u_mask_s, uv, 0.0).
//
// The sampler is declared only for a texture the stage samples through it. A texture read with textureLoad alone has
// no sampler to bind, and that is what lets a 32-bit float one (the motion pass's) be its binding: a float32 texture
// cannot be filtered, and a layout that pairs it with a filtering sampler is refused by the device.
std::string wgslMaterialTextureDecls(const ParsedShader& parsed, const std::string& body, const std::string* only = nullptr) {
    std::string src;
    for (const auto& p : parsed.properties) {
        if (!p.fromParam || p.type != ShaderPropertyType::Texture || p.textureUnit < 0) continue;
        if (only && only->find(p.name) == std::string::npos) continue;
        const u32 unit = static_cast<u32>(p.textureUnit);
        src += "@group(1) @binding(" + std::to_string(unit + 8) + ") var " + p.name +
               (p.layered ? " : texture_2d_array<f32>;\n" : " : texture_2d<f32>;\n");
        if (body.find(p.name + "_s") == std::string::npos) continue;
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
fn acesFilmic(x : vec3f) -> vec3f {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn pbrNeutral(color : vec3f) -> vec3f {
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    var c = color;
    let x = min(c.r, min(c.g, c.b));
    var offset = 0.04;
    if (x < 0.08) { offset = x - 6.25 * x * x; }
    c = c - vec3f(offset);
    let peak = max(c.r, max(c.g, c.b));
    if (peak < startCompression) { return c; }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    c = c * (newPeak / peak);
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3f(newPeak), g);
}
)";

// The light block and the shadow map as a fullscreen pass sees them: the same block the Lit shaders read, the atlas on
// unit 2 where a pass has nothing else, and the two questions an effect asks of them — which light is the sun, and is
// this point of air in its light. One tap, no filtering: a fog sample is not a surface.
const char* kPostLightHeaderWGSL = R"(struct Light { posDir : vec4f, color : vec4f, spot : vec4f, shadow : vec4f, shadowMap : vec4f, falloff : vec4f };
struct LightConstants {
    u_ambient : vec4f,
    u_lights : array<Light, 16>,
    u_mask2DRect : vec4f,
    u_shadowMatrix : array<mat4x4f, 16>,
    u_shadowTile : array<vec4f, 16>,
    u_shadowParams : vec4f,
    u_envIrradiance : array<vec4f, 9>,
    u_envParams : vec4f,
    u_envTint : vec4f,
    u_reflParams : vec4f,
    u_reflBox : array<vec4f, 30>,
    u_bakedTint : vec4f,
    tiledLights : array<Light, 96>,
    tileMask : array<vec4u, 192>,
    tileInfo : vec4f,
};
@group(0) @binding(2) var<uniform> lc : LightConstants;
fn unpackDepth(c : vec3f) -> f32 {
    return dot(c, vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
}
// The first directional light that shines: xyz = where it stands in the sky, w = 1 (0 = none),
// color = its colour and strength, tiles = x first atlas tile, y how many.
struct Sun { dir : vec4f, color : vec4f, tiles : vec2i };
fn findSun() -> Sun {
    var s : Sun;
    s.dir = vec4f(0.0);
    s.color = vec4f(0.0);
    s.tiles = vec2i(0, 0);
    for (var i = 0; i < 16; i++) {
        let l = lc.u_lights[i];
        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {
            s.dir = vec4f(-normalize(vec3f(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);
            s.color = l.color;
            s.tiles = vec2i(i32(l.shadowMap.x), i32(l.shadowMap.y % 8.0));
            return s;
        }
    }
    return s;
}
fn sunVisibility(worldPos : vec3f, first : i32, count : i32) -> f32 {
    if (lc.u_shadowParams.x < 0.5 || count <= 0) { return 1.0; }
    for (var k = 0; k < 16; k++) {
        if (k >= count) { break; }
        let t = first + k;
        let m = lc.u_shadowMatrix[t];
        let c = m * vec4f(worldPos, 1.0);
        if (c.w <= 0.0) { continue; }
        let proj = c.xyz / c.w;
        let uv = proj.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) { continue; }
        let rect = lc.u_shadowTile[t];
        // The tile and the square inside it are turned over on this backend, as in the Lit header.
        let base = vec2f(rect.x, 1.0 - rect.y - rect.z);
        let at = base + vec2f(uv.x, 1.0 - uv.y) * rect.z;
        let lo = base + lc.u_shadowParams.y * 0.5;
        let hi = base + rect.z - lc.u_shadowParams.y * 0.5;
        let d = unpackDepth(textureSampleLevel(t2, s2, clamp(at, lo, hi), 0.0).rgb);
        return select(1.0, 0.0, d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025);
    }
    return 1.0;
}
)";

const char* kLitHeaderWGSL = R"(struct Light { posDir : vec4f, color : vec4f, spot : vec4f, shadow : vec4f, shadowMap : vec4f, falloff : vec4f };
struct LightConstants {
    u_ambient : vec4f,
    u_lights : array<Light, 16>,
    u_mask2DRect : vec4f,
    u_shadowMatrix : array<mat4x4f, 16>,
    u_shadowTile : array<vec4f, 16>,
    u_shadowParams : vec4f,
    u_envIrradiance : array<vec4f, 9>,
    u_envParams : vec4f,
    u_envTint : vec4f,
    u_reflParams : vec4f,
    u_reflBox : array<vec4f, 30>,
    u_bakedTint : vec4f,
    tiledLights : array<Light, 96>,
    tileMask : array<vec4u, 192>,
    tileInfo : vec4f,
};
@group(0) @binding(2) var<uniform> lc : LightConstants;
struct ProbeConstants { u_probeIrradiance : array<vec4f, 1000>, u_probeTail : vec4f };
@group(0) @binding(7) var<uniform> pc : ProbeConstants;
struct PlanarConstants { planarProjection : mat4x4f, planarParams : vec4f };
@group(0) @binding(9) var<uniform> planar : PlanarConstants;
// Which run of that block this fragment's instance reads. WGSL has no module
// varying, so the entry point hands it over — the GLSL twin reads the varying
// straight, which is the one place the two stages differ in shape.
var<private> g_probeSlot : f32 = 0.0;
// Set by a hair shader before it lights: how much of the light a layer of strands takes, per world unit along it (0 = a surface, a hard compare).
var<private> g_hairShadow : f32 = 0.0;
// Set by a shader that lights a surface the sun seldom shadows (the sea) before it lights: the shadow is read as an edge a source with no size
// throws, nine taps, and not as the penumbra of the sun's size, a search and a filter of up to sixty-four.
var<private> g_shadowHard : f32 = 0.0;
// The GLSL twin's v_lightmap, handed over by the entry point like the slot above.
var<private> g_lightmap : vec3f = vec3f(0.0);
// The mesh's own tangent frame, handed over by the entry point like the slot above; zero where the shader never sets it, which
// is what sends perturbNormal back to deriving a frame per pixel.
var<private> g_worldTangent : vec4f = vec4f(0.0);
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
// The same spiral turned by `spin` radians: a disc wider than the taps can cover without gaps between them bands where the same spiral
// lands on every pixel, and turning it by an angle that differs from one point of the surface to the next makes that grain instead.
fn diskTapSpun(i : i32, n : i32, radius : f32, spin : f32) -> vec2f {
    let a = f32(i) * 2.3999632 + spin;
    return radius * sqrt((f32(i) + 0.5) / f32(n)) * vec2f(cos(a), -sin(a));
}
// A turn for the spiral, fixed to the point of the surface (so it does not crawl as the camera moves).
fn shadowSpin(worldPos : vec3f) -> f32 {
    return 6.2831853 * fract(sin(dot(worldPos, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}
)"
// Split again for the same cap; the WGSL is unchanged.
R"(// The spiral taps for 8, 16 and 32 points, as numbers (see the GLSL twin): each is turned by the pixel's own spin where it is used.
const kSpiral8 = array<vec2f, 8>(
    vec2f(0.2500000, 0.0000000),
    vec2f(-0.3192901, 0.2924959),
    vec2f(0.0488724, -0.5568765),
    vec2f(0.4024445, 0.5249175),
    vec2f(-0.7385351, -0.1306364),
    vec2f(0.6996049, -0.4450315),
    vec2f(-0.2340040, 0.8704838),
    vec2f(-0.4462715, -0.8592682)
);
const kInner5 = array<vec2f, 5>(vec2f(0.0), vec2f(1.5, 0.0), vec2f(-1.5, 0.0), vec2f(0.0, 1.5), vec2f(0.0, -1.5));
const kSpiral16 = array<vec2f, 16>(
    vec2f(0.1767767, 0.0000000),
    vec2f(-0.2257722, 0.2068258),
    vec2f(0.0345580, -0.3937712),
    vec2f(0.2845713, 0.3711727),
    vec2f(-0.5222232, -0.0923739),
    vec2f(0.4946953, -0.3146848),
    vec2f(-0.1654658, 0.6155250),
    vec2f(-0.3155616, -0.6075943),
    vec2f(0.6846422, 0.2500301),
    vec2f(-0.7122560, 0.2940091),
    vec2f(0.3433543, -0.7337287),
    vec2f(0.2537305, 0.8089319),
    vec2f(-0.7647461, -0.4431856),
    vec2f(0.8971339, -0.1972327),
    vec2f(-0.5475066, 0.7787725),
    vec2f(-0.1264872, -0.9760896)
);
const kSpiral32 = array<vec2f, 32>(
    vec2f(0.1250000, 0.0000000),
    vec2f(-0.1596450, 0.1462479),
    vec2f(0.0244362, -0.2784383),
    vec2f(0.2012223, 0.2624588),
    vec2f(-0.3692676, -0.0653182),
    vec2f(0.3498024, -0.2225157),
    vec2f(-0.1170020, 0.4352419),
    vec2f(-0.2231357, -0.4296341),
    vec2f(0.4841152, 0.1767979),
    vec2f(-0.5036411, 0.2078959),
    vec2f(0.2427881, -0.5188246),
    vec2f(0.1794146, 0.5720012),
    vec2f(-0.5407571, -0.3133795),
    vec2f(0.6343695, -0.1394646),
    vec2f(-0.3871456, 0.5506753),
    vec2f(-0.0894400, -0.6901996),
    vec2f(0.5490720, 0.4627580),
    vec2f(-0.7388785, 0.0305553),
    vec2f(0.5389548, -0.5363326),
    vec2f(-0.0360577, 0.7797915),
    vec2f(-0.5128179, -0.6145265),
    vec2f(0.8123597, 0.1093013),
    vec2f(-0.6883103, 0.4789091),
    vec2f(0.1880855, -0.8360615),
    vec2f(0.4350338, 0.7591907),
    vec2f(-0.8504486, -0.2713156),
    vec2f(0.8261021, -0.3816809),
    vec2f(-0.3578875, 0.8551558),
    vec2f(-0.3194081, -0.8880335),
    vec2f(0.8499090, 0.4466874),
    vec2f(-0.9440344, 0.2488453),
    vec2f(0.5365950, -0.8345303)
);
// The widest disc a penumbra is averaged over, in texels of the map. It was 8, the widest the taps cover without gaps, which held a sun's
// penumbra to sixteen texels: with a fine cascade (a millimetre or two a texel at a character) that is a hand's width less than the sun
// throws, and the render lab measured an edge 60% as wide as Blender's. The spiral is turned point by point (diskTapSpun) so the wider
// disc grains instead of banding. It bounds
// the search too — a blocker outside it cannot widen an edge that cannot be drawn wider.
const kShadowDisc = 24.0;
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
        // Hair: layers of strand cards a few millimetres apart are not a wall. The light left after a depth of them falls off with that depth, from the
        // nearest card (what the map holds) to this one, the way a deep shadow map reads it. A blocker within a couple of texels toward the light is
        // this card's own surface and does not count.
        if (g_hairShadow > 0.0) {
            let reachHair = shadowDepth(m, worldPos + L * stepFor(texel, slope, 2.0));
            var sumHair = 0.0;
            var hitsHair = 0.0;
            for (var i = 0; i < 8; i++) {
                let at = clamp(at0 + diskTap(i, 8, 2.0) * lc.u_shadowParams.y, lo, hi);
                let d = unpackDepth(textureSampleLevel(t2, s2, at, 0.0).rgb);
                if (d < reachHair) { sumHair += d; hitsHair += 1.0; }
            }
            if (hitsHair < 0.5) { return 1.0; }
            let Ah = length(vec3f(m[0].z, m[1].z, m[2].z));
            let zbh = 2.0 * (sumHair / hitsHair) - 1.0;
            var spanHair = (proj.z - zbh) / max(Ah, 1e-9);
            if (hasEye) { spanHair = lcp.w - lcp.w * (Ah - proj.z) / max(Ah - zbh, 1e-6); }
            return mix(1.0, exp(-g_hairShadow * max(spanHair, 0.0)), hitsHair * 0.125);
        }
        // A source with no size throws one edge: a tent over the 3x3 texels around the
        // point, weighted by where it falls among them. Equal weights step at every
        // texel and the map's grid shows along the edge; a 2x2 still stair-steps it.
        if (src <= 0.0 || g_shadowHard > 0.5) {
            let texelUv = lc.u_shadowParams.y;
            let f = at0 / texelUv - 1.0;
            let c = (floor(f) + 0.5) * texelUv;
            let t = fract(f);
            let wx = array<f32, 3>((1.0 - t.x) * 0.5, 0.5, t.x * 0.5);
            let wy = array<f32, 3>((1.0 - t.y) * 0.5, 0.5, t.y * 0.5);
            var lit = 0.0;
            for (var y = 0; y < 3; y++) {
                for (var x = 0; x < 3; x++) {
                    lit += wx[x] * wy[y] * shadowTap(c + vec2f(f32(x), f32(y)) * texelUv, lo, hi, here);
                }
            }
            return lit;
        }
        // What blocks this fragment, over the whole disc an edge can reach across — and
        // against a depth that forgives that reach, since a tap r texels away lands r
        // texels along the surface and a one-texel bias would call the slope a blocker.
        // Each tap forgives as far as it stands from the point: a disc this wide forgiven as a whole would let a blocker touching the
        // surface (a box on a floor) through as lit for a hand's width round its foot.
        let spin = shadowSpin(worldPos);
        let turn = vec2f(cos(spin), sin(spin));
        // See the GLSL twin: the matrix is applied to the direction once, and each tap moves the clip position along it.
        let toLight = m * vec4f(L, 0.0);
        let stepBase = texel * 1.5 * (1.0 + slope);
        let stepPer = texel * slope;
        var sum = 0.0;
        var hits = 0.0;
        // See the GLSL twin: the fragment's own texel and the four a step and a half round it, before the sparse wide disc.
        for (var i = 0; i < 5; i++) {
            let p = kInner5[i];
            let off = vec2f(p.x * turn.x - p.y * turn.y, -(p.x * turn.y + p.y * turn.x));
            let at = clamp(at0 + off * lc.u_shadowParams.y, lo, hi);
            let d = unpackDepth(textureSampleLevel(t2, s2, at, 0.0).rgb);
            let cr = lcp + toLight * (stepBase + max(length(off), 1.0) * stepPer);
            let reach = clamp(cr.z / max(cr.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);
            if (d < reach) { sum += d; hits += 1.0; }
        }
        for (var i = 0; i < 16; i++) {
            let p = kSpiral16[i];
            let off = kShadowDisc * vec2f(p.x * turn.x - p.y * turn.y, -(p.x * turn.y + p.y * turn.x));
            let at = clamp(at0 + off * lc.u_shadowParams.y, lo, hi);
            let d = unpackDepth(textureSampleLevel(t2, s2, at, 0.0).rgb);
            let cr = lcp + toLight * (stepBase + max(length(off), 1.0) * stepPer);
            let reach = clamp(cr.z / max(cr.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);
            if (d < reach) { sum += d; hits += 1.0; }
        }
        if (hits < 0.5) { return 1.0; }
        // See the GLSL twin: a blocker on every tap is the inside of a shadow.
        if (hits > 20.5) { return 0.0; }
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
        // See the GLSL twin: a narrow penumbra is as well averaged over fewer points.
        if (radius < 1.5) {
            for (var i = 0; i < 8; i++) {
                let p = kSpiral8[i];
                let off = radius * vec2f(p.x * turn.x - p.y * turn.y, -(p.x * turn.y + p.y * turn.x));
                soft += shadowTap(at0 + off * lc.u_shadowParams.y, lo, hi, wide);
            }
            return soft * (1.0 / 8.0);
        }
        if (radius < 4.0) {
            for (var i = 0; i < 16; i++) {
                let p = kSpiral16[i];
                let off = radius * vec2f(p.x * turn.x - p.y * turn.y, -(p.x * turn.y + p.y * turn.x));
                soft += shadowTap(at0 + off * lc.u_shadowParams.y, lo, hi, wide);
            }
            return soft * (1.0 / 16.0);
        }
        for (var i = 0; i < 32; i++) {
            let p = kSpiral32[i];
            let off = radius * vec2f(p.x * turn.x - p.y * turn.y, -(p.x * turn.y + p.y * turn.x));
            soft += shadowTap(at0 + off * lc.u_shadowParams.y, lo, hi, wide);
        }
        return soft * (1.0 / 32.0);
    }
    return 1.0;
#endif
}
)"
// Split again for the same cap; the WGSL is unchanged.
R"(// The coverage a cut-out's alpha gives this pixel: glTF's MASK, kept where alpha reaches the cutoff and gone where it does not, at every
// distance. The cut is sharpened to about a pixel (`edge` is fwidth of the alpha), so under multisampling alpha-to-coverage feathers the
// edge instead of stair-stepping it, and without it the cut is the hard one. Seen small, the cut-out holds its area because its mips do:
// the cook rescales each level's alpha to the share the full image keeps at the cutoff (preserveAlphaCoverage).
fn cutoutCoverage(a : f32, cutoff : f32, edge : f32) -> f32 {
    return (a - cutoff) / max(edge, 1e-4) + 0.5;
}
fn sampleNormal(map : texture_2d<f32>, samp : sampler, uv : vec2f) -> vec3f {
    let xy = textureSampleLevel(map, samp, uv, 0.0).xy * 2.0 - 1.0;
    return vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
// Through the mip chain, with gradients the caller took before any branch.
fn sampleNormalGrad(map : texture_2d<f32>, samp : sampler, uv : vec2f,
                    ddx : vec2f, ddy : vec2f) -> vec3f {
    let xy = textureSampleGrad(map, samp, uv, ddx, ddy).xy * 2.0 - 1.0;
    return vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
fn perturbNormal(N : vec3f, worldPos : vec3f, uv : vec2f, tangentNormal : vec3f) -> vec3f {
    // The derivatives first: they are only valid in uniform control flow, and the choice below depends on a variable.
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
    let m = max(dot(T, T), dot(B, B));
    let scale = max(dot(dp1, dp1), dot(dp2, dp2)) * max(dot(duv1, duv1), dot(duv2, duv2));
    // Each axis to unit length on its own: a texture stretched more along one axis than the other (a face unwrapped into an atlas) has
    // a short T beside a long B, and scaling both by the longer one would leave the normal map flat along the short one.
    let derived = select(N, normalize(mat3x3f(T * inverseSqrt(max(dot(T, T), 1e-20)), B * inverseSqrt(max(dot(B, B), 1e-20)), N) * tangentNormal),
                         m > scale * 1e-6);
    // The frame the normal map was baked in, when the geometry carries it: the tangent made square to the interpolated normal.
    // Chosen by select, not by returning early: behind a branch Metal sinks the derivatives above into it, where a quad the
    // triangle only partly covers has lost its helpers, and every pixel along an edge lost its normal map (skin-detail).
    let Tg = normalize(g_worldTangent.xyz - N * dot(N, g_worldTangent.xyz));
    let Bg = cross(N, Tg) * g_worldTangent.w;
    let baked = normalize(mat3x3f(Tg, Bg, N) * tangentNormal);
    return select(derived, baked, dot(g_worldTangent.xyz, g_worldTangent.xyz) > 1e-8);
}
// Where a world point lands in this camera's part of a screen-space mask: on the Z = 0
// plane, which is the plane a 2D occluder hides things in, and through this same camera
// so the landing agrees. Negative x = nothing to read.
fn mask2DUv(worldPos : vec2f) -> vec2f {
    let clip = frame.projection * vec4f(worldPos, 0.0, 1.0);
    if (clip.w <= 0.0) { return vec2f(-1.0, -1.0); }
    // A negative height is the backend saying its texture rows run the other way.
    let ndc = clip.xy / clip.w * 0.5 + 0.5;
    let v = select(ndc.y, 1.0 - ndc.y, lc.u_mask2DRect.w < 0.0);
    return lc.u_mask2DRect.xy
        + vec2f(ndc.x * lc.u_mask2DRect.z, v * abs(lc.u_mask2DRect.w));
}
fn mask2DChannel(m : vec4f, channel : f32) -> f32 {
    if (channel < 0.5) { return m.r; }
    if (channel < 1.5) { return m.g; }
    if (channel < 2.5) { return m.b; }
    return m.a;
}
fn shadowFactor2D(channel : f32, worldPos : vec2f) -> f32 {
    if (channel < 0.0 || lc.u_mask2DRect.z <= 0.0) { return 1.0; }
    let uv = mask2DUv(worldPos);
    if (uv.x < 0.0) { return 1.0; }
    let hidden = mask2DChannel(textureSampleLevel(t7, s7, uv, 0.0), channel);
    return 1.0 - min(hidden, 1.0);
}
// What the light's own SHAPE covers here — its cookie, drawn into the shape mask at the
// light's place. A light with no shape keeps the whole circle it always had.
fn shapeFactor2D(channel : f32, worldPos : vec2f) -> f32 {
    if (channel < 0.0 || lc.u_mask2DRect.z <= 0.0) { return 1.0; }
    let uv = mask2DUv(worldPos);
    if (uv.x < 0.0) { return 1.0; }
    return min(mask2DChannel(textureSampleLevel(t6, s6, uv, 0.0), channel), 1.0);
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
// Smith's masking-shadowing for GGX, height-correlated, folded with the 1 / (4 NdotV NdotL) of the microfacet BRDF (the visibility term),
// at alpha = roughness^2: what the environment term above integrates and what Blender's GGX uses. The Schlick-GGX k = (r + 1)^2 / 8 it
// replaces shadows too much at a grazing view and a high roughness, which left the rim of a rough metal a quarter darker under a lamp.
fn visibilitySmithGGX(NdotV : f32, NdotL : f32, a : f32) -> f32 {
    let a2 = a * a;
    let gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    let gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
}
fn fresnelSchlick(VdotH : f32, F0 : vec3f) -> vec3f {
    return F0 + (vec3f(1.0) - F0) * pow(1.0 - VdotH, 5.0);
}
// The split-sum environment term of GGX (height-correlated Smith, alpha = roughness^2): the scale and bias of F0 over the hemisphere,
// fitted to the integral by tools/gen-dfg-fit.py (worst 3%, mean under 0.6%; Karis' fit before it was 21% low for a metal at roughness 0.5).
fn envBRDFApprox(NdotV : f32, roughness : f32) -> vec2f {
    let tx = (2.0 * (clamp(NdotV, 0.02, 1.0) - 0.02) / 0.98 - 1.0);
    let ty = 2.0 * clamp(roughness, 0.0, 1.0) - 1.0;
    let px0 = 1.0;
    let px1 = tx;
    let px2 = (3.0 * tx * px1 - 1.0 * px0) / 2.0;
    let px3 = (5.0 * tx * px2 - 2.0 * px1) / 3.0;
    let px4 = (7.0 * tx * px3 - 3.0 * px2) / 4.0;
    let px5 = (9.0 * tx * px4 - 4.0 * px3) / 5.0;
    let px6 = (11.0 * tx * px5 - 5.0 * px4) / 6.0;
    let py0 = 1.0;
    let py1 = ty;
    let py2 = (3.0 * ty * py1 - 1.0 * py0) / 2.0;
    let py3 = (5.0 * ty * py2 - 2.0 * py1) / 3.0;
    let py4 = (7.0 * ty * py3 - 3.0 * py2) / 4.0;
    let py5 = (9.0 * ty * py4 - 4.0 * py3) / 5.0;
    let py6 = (11.0 * ty * py5 - 5.0 * py4) / 6.0;
    let g = 1.0 / (clamp(NdotV, 0.02, 1.0) + 0.1);
    let sumMetal = 0.7771111 * px0 * py0 - 0.2780760 * px0 * py1 - 0.0654304 * px0 * py2 - 0.0705640 * px0 * py3 + 0.0859185 * px0 * py4 + 0.0016314 * px0 * py5 - 0.0014479 * px0 * py6 + 0.0048182 * px1 * py0 - 0.1346961 * px1 * py1 - 0.1342442 * px1 * py2 + 0.1115811 * px1 * py3 - 0.0497620 * px1 * py4 - 0.0098451 * px1 * py5 - 0.0004214 * px1 * py6 + 0.0004797 * px2 * py0 + 0.0654544 * px2 * py1 + 0.0215100 * px2 * py2 - 0.0948616 * px2 * py3 + 0.0774489 * px2 * py4 + 0.0139819 * px2 * py5 - 0.0151021 * px2 * py6 + 0.0022918 * px3 * py0 - 0.0244567 * px3 * py1 + 0.0056279 * px3 * py2 + 0.0393924 * px3 * py3 - 0.0613759 * px3 * py4 + 0.0099383 * px3 * py5 + 0.0092971 * px3 * py6 - 0.0025728 * px4 * py0 + 0.0085869 * px4 * py1 - 0.0069877 * px4 * py2 - 0.0115072 * px4 * py3 + 0.0327063 * px4 * py4 - 0.0167796 * px4 * py5 + 0.0019107 * px4 * py6 + 0.0018089 * px5 * py0 - 0.0031015 * px5 * py1 + 0.0047701 * px5 * py2 + 0.0018675 * px5 * py3 - 0.0134691 * px5 * py4 + 0.0139776 * px5 * py5 - 0.0087024 * px5 * py6 - 0.0008609 * px6 * py0 + 0.0010956 * px6 * py1 - 0.0024048 * px6 * py2 + 0.0005262 * px6 * py3 + 0.0035639 * px6 * py4 - 0.0080487 * px6 * py5 + 0.0080563 * px6 * py6 + 0.0220605 * py0 * g + 0.0049886 * py1 * g - 0.0108884 * py2 * g + 0.0359254 * py3 * g - 0.0336876 * py4 * g;
    let sumDielectric = 0.1105178 * px0 * py0 - 0.1470108 * px0 * py1 + 0.0706290 * px0 * py2 - 0.0048613 * px0 * py3 - 0.0190413 * px0 * py4 + 0.0038142 * px0 * py5 - 0.0002643 * px0 * py6 - 0.1400053 * px1 * py0 + 0.2220226 * px1 * py1 - 0.1204309 * px1 * py2 + 0.0033027 * px1 * py3 + 0.0348652 * px1 * py4 - 0.0115348 * px1 * py5 + 0.0015711 * px1 * py6 + 0.0993738 * px2 * py0 - 0.1696809 * px2 * py1 + 0.1055418 * px2 * py2 - 0.0166890 * px2 * py3 - 0.0245166 * px2 * py4 + 0.0153020 * px2 * py5 - 0.0048468 * px2 * py6 - 0.0363361 * px3 * py0 + 0.0724203 * px3 * py1 - 0.0631513 * px3 * py2 + 0.0261354 * px3 * py3 + 0.0041759 * px3 * py4 - 0.0092203 * px3 * py5 + 0.0054510 * px3 * py6 + 0.0046882 * px4 * py0 - 0.0144579 * px4 * py1 + 0.0238812 * px4 * py2 - 0.0200861 * px4 * py3 + 0.0078934 * px4 * py4 - 0.0001779 * px4 * py5 - 0.0024009 * px4 * py6 + 0.0013258 * px5 * py0 - 0.0006506 * px5 * py1 - 0.0049831 * px5 * py2 + 0.0084229 * px5 * py3 - 0.0075026 * px5 * py4 + 0.0046720 * px5 * py5 - 0.0007627 * px5 * py6 - 0.0005364 * px6 * py0 + 0.0008141 * px6 * py1 + 0.0002790 * px6 * py2 - 0.0016584 * px6 * py3 + 0.0027280 * px6 * py4 - 0.0028646 * px6 * py5 + 0.0010557 * px6 * py6 - 0.0075790 * py0 * g + 0.0243928 * py1 * g - 0.0212081 * py2 * g + 0.0063496 * py3 * g + 0.0036408 * py4 * g;
    let scale = (sumMetal - sumDielectric) / 0.96;
    return vec2f(scale, sumMetal - scale);
}
// One authority for the environment's orientation: every direction that asks the
// environment anything comes through here, so a turned sky cannot disagree with a
// turned reflection. The query turns the other way, the world under it.
fn envDirection(d : vec3f) -> vec3f {
    let a = -lc.u_envTint.a;
    let s = sin(a);
    let c = cos(a);
    return vec3f(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}
fn shIrradiance(sh : array<vec4f, 9>, N : vec3f) -> vec3f {
    return sh[0].rgb * 0.282095
        + sh[1].rgb * (0.488603 * N.y)
        + sh[2].rgb * (0.488603 * N.z)
        + sh[3].rgb * (0.488603 * N.x)
        + sh[4].rgb * (1.092548 * N.x * N.y)
        + sh[5].rgb * (1.092548 * N.y * N.z)
        + sh[6].rgb * (0.315392 * (3.0 * N.z * N.z - 1.0))
        + sh[7].rgb * (1.092548 * N.x * N.z)
        + sh[8].rgb * (0.546274 * (N.x * N.x - N.y * N.y));
}
fn envIrradiance(Nw : vec3f) -> vec3f {
    let sh = shIrradiance(lc.u_envIrradiance, envDirection(Nw));
    return lc.u_ambient.rgb + max(sh, vec3f(0.0)) * lc.u_envTint.rgb;
}
// The GLSL twin's indirectIrradiance: a volume replaces the environment, because a
// surface has one indirect term and a volume already holds every light and bounce
// that reached the point.
#ifdef MESH_LIGHTMAP
fn bakedIrradiance() -> vec3f {
    let c = textureSampleLevel(t5, s5, g_lightmap.xy, 0.0).rgb;
    return c * c * 8.0;
}
#endif
fn indirectIrradiance(N : vec3f) -> vec3f {
#ifdef MESH_LIGHTMAP
    if (g_lightmap.z > 0.5) { return bakedIrradiance() * lc.u_bakedTint.rgb; }
#endif
    let base = clamp(i32(g_probeSlot), 0, 99) * 10;
    if (pc.u_probeIrradiance[base].w > 0.5) {
        var sh : array<vec4f, 9>;
        for (var i = 0; i < 9; i = i + 1) { sh[i] = pc.u_probeIrradiance[base + i]; }
        return max(shIrradiance(sh, N), vec3f(0.0)) * lc.u_bakedTint.rgb;
    }
    return envIrradiance(N);
}
// Which column of the atlas this instance reflects, from the run its own index
// names. Zero — an instance inside no probe, or a draw that carries no run at all
// — is the environment, which is what every surface reflected before probes.
fn reflectionColumn() -> f32 {
    let base = clamp(i32(g_probeSlot), 0, 99) * 10;
    return pc.u_probeIrradiance[base + 9].x;
}
fn octEncode(d : vec3f) -> vec2f {
    var p = d.xz / max(abs(d.x) + abs(d.y) + abs(d.z), 1e-6);
    if (d.y < 0.0) {
        p = (1.0 - abs(vec2f(p.y, p.x)))
          * vec2f(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
    }
    return p * 0.5 + 0.5;
}
fn envSampleColumn(R : vec3f, mip : f32, column : f32) -> vec3f {
#ifndef ES_ENV_MAP
    return vec3f(0.0);
#else
    let face = lc.u_envParams.w;
    let size = face * exp2(-mip);
    let yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;
    let col = face + 2.0;
    let atlasW = col * lc.u_reflParams.x;
    let atlasH = 2.0 * face * (1.0 - exp2(-(lc.u_envParams.z + 1.0)))
               + 2.0 * (lc.u_envParams.z + 1.0);
    // The sky turns with the environment; a baked column does not — it was solved
    // in world space, and turning it would spin a room about its own middle.
    let uv = octEncode(select(R, envDirection(R), column < 0.5));
    // Kept inside this column's own face, border ring included: a tap that leaves
    // it reads whatever the sampler's wrap mode says, and the two backends do not
    // answer that alike — one repeats to the far edge, the other clamps.
    let lo2 = vec2f(column * col + 0.5, yOff + 0.5);
    let hi2 = vec2f(column * col + size + 1.5, yOff + size + 1.5);
    let px = clamp(vec2f(column * col + 1.0 + uv.x * size, yOff + 1.0 + uv.y * size), lo2, hi2);
    let t = textureSampleLevel(t3, s3, px / vec2f(atlasW, atlasH), 0.0);
    return t.rgb * t.rgb * (t.a * t.a * lc.u_envParams.y);
#endif
}
fn envSampleMip(R : vec3f, mip : f32) -> vec3f { return envSampleColumn(R, mip, 0.0); }
// Where the reflected ray LEAVES this column's box, aimed from there rather than
// from infinitely far: what makes a reflection slide across a wall as the eye moves
// instead of being painted onto it.
fn reflectionDirection(R : vec3f, P : vec3f, column : f32) -> vec3f {
    if (column < 0.5) { return R; }
    let i = i32(column) * 2 - 2;
    let lo = lc.u_reflBox[i].xyz;
    let hi = lc.u_reflBox[i + 1].xyz;
    // Never zero, so a ray parallel to a face divides to an infinity the min
    // discards rather than to the NaN that would blacken the pixel.
    let d = max(abs(R), vec3f(1e-6)) * (step(vec3f(0.0), R) * 2.0 - vec3f(1.0));
    let t = min(min(max((hi.x - P.x) / d.x, (lo.x - P.x) / d.x),
                    max((hi.y - P.y) / d.y, (lo.y - P.y) / d.y)),
                    max((hi.z - P.z) / d.z, (lo.z - P.z) / d.z));
    if (!(t > 0.0)) { return R; }
    return (P + R * t) - (lo + hi) * 0.5;
}
fn envRadiance(R : vec3f, roughness : f32, column : f32, P : vec3f) -> vec3f {
#ifdef ES_ENV_MAP
    if (planar.planarParams.x > 0.5) {
        let clip = planar.planarProjection * vec4f(P, 1.0);
        if (clip.w <= 0.0) { return vec3f(0.0); }
        let uv = clip.xy / clip.w * vec2f(0.5, 0.5 * planar.planarParams.y) + vec2f(0.5);
        if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec3f(0.0); }
        // A small spatial filter, not prefiltered GGX: preserves material roughness
        // without allocating a second blur chain or claiming an exact BRDF convolution.
        let r = max(planar.planarParams.zw, vec2f(roughness * roughness * 0.015));
        return (textureSampleLevel(t3, s3, uv, 0.0).rgb * 4.0
            + textureSampleLevel(t3, s3, clamp(uv + vec2f(r.x, 0.0), vec2f(0.0), vec2f(1.0)), 0.0).rgb
            + textureSampleLevel(t3, s3, clamp(uv - vec2f(r.x, 0.0), vec2f(0.0), vec2f(1.0)), 0.0).rgb
            + textureSampleLevel(t3, s3, clamp(uv + vec2f(0.0, r.y), vec2f(0.0), vec2f(1.0)), 0.0).rgb
            + textureSampleLevel(t3, s3, clamp(uv - vec2f(0.0, r.y), vec2f(0.0), vec2f(1.0)), 0.0).rgb) * 0.125;
    }
#endif
    if (lc.u_envParams.x < 0.5) { return lc.u_ambient.rgb; }
    let dir = reflectionDirection(R, P, column);
    let lod = clamp(roughness, 0.0, 1.0) * lc.u_envParams.z;
    let lo = floor(lod);
    let a = envSampleColumn(dir, lo, column);
    let b = envSampleColumn(dir, min(lo + 1.0, lc.u_envParams.z), column);
    // A baked column is the WHOLE radiance that reached its probe — the sky, the
    // ambient and every bounce. Adding the flat term or the sky's tint on top
    // would count the light the capture already saw a second time.
    if (column >= 0.5) {
        let baked = mix(a, b, lod - lo);
        // What the bake saw, as the weather now says it looks: dimmer, and with less of its colour.
        let grey = dot(baked, vec3f(0.2126, 0.7152, 0.0722));
        return mix(vec3f(grey), baked, lc.u_reflParams.z) * lc.u_reflParams.y;
    }
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
// The ramp from a light's reach down to nothing. fo.x holds it at full out to its own
// radius; fo.y shapes what is left. The exponent is floored because pow(0, 0) is 1 —
// a light that reaches nowhere would light everything.
fn distanceFalloff(dist : f32, reach : f32, fo : vec4f) -> f32 {
    let ramp = clamp((reach - dist) / max(reach - fo.x, 1e-4), 0.0, 1.0);
    return pow(ramp, max(fo.y, 1e-3));
}
)"
// Split again for the same reason: the surface layers and the lighting that reads them.
R"(struct SurfaceExt { coat : vec4f, coatN : vec4f, sheen : vec4f, aniso : vec4f, scatter : vec4f, trans : vec4f, film : vec4f, misc : vec4f, strand : vec4f };
fn surfaceExtNone(N : vec3f) -> SurfaceExt {
    return SurfaceExt(vec4f(0.0), vec4f(N, 0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0),
                      vec4f(0.04, 0.0, 0.0, 0.0), vec4f(0.6, 0.0, 0.0, 0.0));
}
fn distributionCharlie(NdotH : f32, a : f32) -> f32 {
    let invA = 1.0 / max(a, 1e-3);
    let sin2 = max(1.0 - NdotH * NdotH, 0.0078125);
    return (2.0 + invA) * pow(sin2, invA * 0.5) / 6.28318531;
}
fn visibilityNeubelt(NdotV : f32, NdotL : f32) -> f32 {
    return 1.0 / max(4.0 * (NdotL + NdotV - NdotL * NdotV), 1e-4);
}
fn distributionGGXAniso(at : f32, ab : f32, ToH : f32, BoH : f32, NoH : f32) -> f32 {
    let a2 = at * ab;
    let d = vec3f(ab * ToH, at * BoH, a2 * NoH);
    let b2 = a2 / max(dot(d, d), 1e-7);
    return a2 * b2 * b2 / 3.14159265;
}
fn visibilityGGXAniso(at : f32, ab : f32, ToV : f32, BoV : f32, ToL : f32, BoL : f32, NoV : f32, NoL : f32) -> f32 {
    let lambdaV = NoL * length(vec3f(at * ToV, ab * BoV, NoV));
    let lambdaL = NoV * length(vec3f(at * ToL, ab * BoL, NoL));
    return 0.5 / max(lambdaV + lambdaL, 1e-5);
}
fn filmFresnel(F : vec3f, cosTheta : f32, film : vec4f) -> vec3f {
    let sinT2 = (1.0 - cosTheta * cosTheta) / (film.y * film.y);
    let cosT = sqrt(max(1.0 - sinT2, 0.0));
    let opd = 2.0 * film.y * film.z * cosT;
    let tint = vec3f(0.5) + vec3f(0.5) * cos(vec3f(6.28318531 * opd) / vec3f(650.0, 510.0, 475.0));
    return clamp(F * mix(vec3f(1.0), tint * 2.0, vec3f(film.x)), vec3f(0.0), vec3f(1.0));
}
fn applyLightingSurface(albedo : vec3f, N : vec3f, worldPos : vec3f, V : vec3f, metallic : f32,
                        roughness : f32, specular : f32, ao : f32, ext : SurfaceExt) -> vec3f {
    let F0 = mix(vec3f(ext.misc.x), albedo, vec3f(metallic));
    let a = max(roughness * roughness, 1e-3);
    let NdotV = max(dot(N, V), 1e-4);
    var lit = indirectIrradiance(N) * ao;
    var gloss = vec3f(0.0);
    var extra = vec3f(0.0);
    for (var i = 0; i < 16; i++) {
        let term = shadeLight(lc.u_lights[i].posDir, lc.u_lights[i].color, lc.u_lights[i].spot, lc.u_lights[i].shadow,
                              lc.u_lights[i].shadowMap, lc.u_lights[i].falloff, N, V, worldPos, a, F0, NdotV, specular, roughness, ext, true);
        lit += term.lit;
        gloss += term.gloss;
        extra += term.extra;
    }
    // The lights past the sixteen: this pixel's tile is found from where the fragment lands through the camera it was drawn by
    // (normalized device coordinates, the same on every backend), and only the lights whose bit is set in its mask are shaded.
    let tiledCount = i32(lc.tileInfo.x);
    if (tiledCount > 0) {
        let tileClip = frame.projection * vec4f(worldPos, 1.0);
        let tileNdc = tileClip.xy / max(tileClip.w, 1e-4);
        let tileCount = vec2i(i32(lc.tileInfo.y), i32(lc.tileInfo.z));
        let tile = clamp(vec2i(floor((tileNdc * 0.5 + 0.5) * vec2f(tileCount))), vec2i(0), tileCount - vec2i(1));
        let mask = lc.tileMask[tile.y * tileCount.x + tile.x];
        for (var w = 0; w < 3; w++) {
            var bits = mask.x;
            if (w == 1) { bits = mask.y; } else if (w == 2) { bits = mask.z; }
            if (bits == 0u) { continue; }
            for (var b = 0; b < 32; b++) {
                if ((bits & (1u << u32(b))) == 0u) { continue; }
                let k = w * 32 + b;
                if (k >= tiledCount) { break; }
                let term = shadeLight(lc.tiledLights[k].posDir, lc.tiledLights[k].color, lc.tiledLights[k].spot,
                                      lc.tiledLights[k].shadow, lc.tiledLights[k].shadowMap, lc.tiledLights[k].falloff,
                                      N, V, worldPos, a, F0, NdotV, specular, roughness, ext, false);
                lit += term.lit;
                gloss += term.gloss;
                extra += term.extra;
            }
        }
    }
    let ab = envBRDFApprox(NdotV, roughness);
    // The light a rough microfacet surface loses to bounces between its facets, which single-scattering GGX leaves out (a metal at roughness
    // 0.9 came out at half of Blender's brightness): Fdez-Aguera's term for the environment, and the same ratio on the lamps' highlight. What
    // the specular reflects is light the diffuse under it does not get, as in the Principled shader. Hair keeps its own lobes as authored.
    let Ess = ab.x + ab.y;
    let FssEss = F0 * ab.x + vec3f(ab.y);
    var FmsEms = vec3f(0.0);
    var kd = vec3f(1.0);
    if (ext.misc.y <= 0.0 || ext.strand.y > 0.0) {
        let Ems = 1.0 - Ess;
        let Favg = F0 + (vec3f(1.0) - F0) / 21.0;
        FmsEms = FssEss * Favg * Ems / (vec3f(1.0) - Ems * Favg);
        gloss *= vec3f(1.0) + F0 * (1.0 / max(Ess, 0.05) - 1.0);
        kd = max(vec3f(1.0) - (FssEss + FmsEms) * specular, vec3f(0.0));
    }
    var envR = reflect(-V, N);
    if (ext.aniso.w != 0.0 || ext.misc.y > 0.0) {
        let T = ext.aniso.xyz;
        var grain = T;
        if (ext.aniso.w >= 0.0 && ext.misc.y <= 0.0) { grain = cross(N, T); }
        let bent = normalize(cross(cross(grain, V), grain));
        var bendBy = abs(ext.aniso.w);
        if (ext.misc.y > 0.0) { bendBy = 0.55; }
        envR = reflect(-V, normalize(mix(N, bent, vec3f(bendBy))));
    }
    var envF = FssEss + FmsEms;
    if (ext.film.x > 0.0) { envF = filmFresnel(envF, NdotV, ext.film); }
    gloss += envRadiance(envR, roughness, reflectionColumn(), worldPos) * (ao * specular)
           * envF;
    let base = albedo * (1.0 - metallic) * lit * kd + gloss;
    var baseScale = 1.0;
    if (ext.coat.x > 0.0) {
        let coatNdotV = max(dot(ext.coatN.xyz, V), 1e-4);
        let cab = envBRDFApprox(coatNdotV, ext.coat.y);
        let Fc = (0.04 * cab.x + cab.y) * ext.coat.x;
        baseScale *= 1.0 - Fc;
        extra += envRadiance(reflect(-V, ext.coatN.xyz), ext.coat.y, reflectionColumn(), worldPos) * (ao * Fc);
    }
    if (dot(ext.sheen.rgb, vec3f(1.0)) > 0.0) {
        let sheenAlbedo = 0.2 + 0.3 * ext.sheen.a;
        baseScale *= 1.0 - max(max(ext.sheen.r, ext.sheen.g), ext.sheen.b) * sheenAlbedo;
        extra += ext.sheen.rgb * (indirectIrradiance(N) * ao * sheenAlbedo);
    }
    return base * baseScale + extra;
}
fn applyLightingPBR(albedo : vec3f, N : vec3f, worldPos : vec3f, V : vec3f, metallic : f32,
                    roughness : f32, specular : f32, ao : f32) -> vec3f {
    return applyLightingSurface(albedo, N, worldPos, V, metallic, roughness, specular, ao, surfaceExtNone(N));
}
struct LightTerm { lit : vec3f, gloss : vec3f, extra : vec3f };
// The layer of the sprite being lit, as its vertex wrote it (the layer plus 129; 0 when the surface has none to test), and whether a light's
// range of layers, which rides in shadowMap.y above the tile count, takes it in. See packLightLayerRange.
var<private> g_surfaceLayer : f32 = 0.0;
fn lightReachesLayer(rangeLane : f32) -> bool {
    if (rangeLane < 8.0 || g_surfaceLayer < 0.5) { return true; }
    let range = floor(rangeLane / 8.0);
    let lo = range % 256.0 - 128.0;
    let hi = 127.0 - floor(range / 256.0);
    let layer = g_surfaceLayer - 129.0;
    return layer >= lo && layer <= hi;
}
fn shadeLight(pd : vec4f, col : vec4f, sp : vec4f, sh : vec4f, sm : vec4f, fo : vec4f, N : vec3f, V : vec3f,
              worldPos : vec3f, a : f32, F0 : vec3f, NdotV : f32, specular : f32, roughness : f32,
              ext : SurfaceExt, shadow3D : bool) -> LightTerm {
    var lit = vec3f(0.0);
    var gloss = vec3f(0.0);
    var extra = vec3f(0.0);
    // A slot nothing lights from adds exactly nothing (see the GLSL twin).
    if (col.a == 0.0 || !lightReachesLayer(sm.y)) { return LightTerm(lit, gloss, extra); }
    {
        var L : vec3f;
        var atten : f32;
        var aim = pd.xy;
        var castShadow = true;
        if (pd.z < 0.5) {
            let toL = lightVector(pd, sh, worldPos);
            let dist = lightDistance(toL);
            atten = distanceFalloff(dist, max(pd.w, 0.0001), fo);
            L = towardLight(toL, N);
        } else if (pd.z < 1.5) {
            atten = 1.0;
            L = normalize(-vec3f(pd.xy, pd.w));
            var toLight = vec2f(0.0, 0.0);
            if (dot(pd.xy, pd.xy) > 1e-8) { toLight = normalize(-pd.xy); }
            castShadow = sh.y > 0.0 && dot(toLight, toLight) > 0.5;
            aim = worldPos.xy + toLight * sh.y;
        } else {
            let toL = lightVector(pd, sh, worldPos);
            let dist = lightDistance(toL);
            atten = distanceFalloff(dist, max(pd.w, 0.0001), fo);
            L = towardLight(toL, N);
            atten *= spotCone(sp, sh, toL, dist);
        }
        if (col.a > 0.0 && atten > 0.0) {
            atten *= shapeFactor2D(fo.w, worldPos.xy);
        }
        if (castShadow && col.a > 0.0 && atten > 0.0) {
            atten *= mix(1.0, shadowFactor2D(sm.w, worldPos.xy), fo.z);
        }
        // See the GLSL twin: a light the tiles carry has no shadow map, and says so.
        if (shadow3D && sm.y % 8.0 > 0.0 && atten > 0.0) {
            atten *= mix(1.0,
                         shadowFactor3D(worldPos, N, L, vec2f(sh.x, sm.z), i32(sm.x), i32(sm.y % 8.0)),
                         fo.z);
        }
        var ndotl = max(dot(N, L), 0.0);
        // Hair (misc.y above zero; aniso.xyz is the strand): Kajiya-Kay diffuse, which lights a strand by how far light is from along it.
        if (ext.misc.y > 0.0) {
            let along = dot(ext.aniso.xyz, L);
            ndotl = mix(ndotl, sqrt(max(1.0 - along * along, 0.0)) * clamp(dot(N, L) * 0.5 + 0.65, 0.0, 1.0), ext.strand.x);
        }
        let radiance = col.rgb * (col.a * ndotl * atten);
        lit += radiance;
        if (specular > 0.0 && ext.misc.y > 0.0 && ext.strand.y <= 0.0) {
            // Two shifted, narrow lobes along the strand: a white one near the surface and a coloured one under it (scatter.rgb).
            let H = normalize(L + V);
            let primaryExp = clamp(2.0 / (a * a), 8.0, 900.0);
            let strandA = normalize(ext.aniso.xyz + N * ext.misc.z);
            let strandB = normalize(ext.aniso.xyz + N * ext.misc.w);
            let h1 = dot(strandA, H);
            let h2 = dot(strandB, H);
            let lobe1 = smoothstep(-1.0, 0.0, h1) * pow(sqrt(max(1.0 - h1 * h1, 0.0)), primaryExp);
            let lobe2 = smoothstep(-1.0, 0.0, h2) * pow(sqrt(max(1.0 - h2 * h2, 0.0)), primaryExp * 0.3);
            let lightOn = col.rgb * (col.a * atten * clamp(dot(N, L) + 0.35, 0.0, 1.0));
            gloss += lightOn * (lobe1 * 0.55 + lobe2 * ext.scatter.rgb * 1.6) * (ext.misc.y * specular);
        } else if (specular > 0.0) {
            let H = normalize(L + V);
            var brdf : f32;
            if (ext.misc.y > 0.0) {
                // Hair shaded as the Principled shader shades a card with an anisotropy (strand.y): GGX stretched along the strand, as Blender
                // stretches it (aspect sqrt(1 - 0.9 anisotropy)). The highlight runs across the strands as a band, the sheen a lock of hair has.
                let T = ext.aniso.xyz;
                let B = cross(N, T);
                let aspect = sqrt(max(1.0 - 0.9 * ext.strand.y, 0.01));
                let at = max(a / aspect, 0.002);
                let ab = max(a * aspect, 0.002);
                brdf = distributionGGXAniso(at, ab, dot(T, H), dot(B, H), max(dot(N, H), 0.0))
                     * visibilityGGXAniso(at, ab, dot(T, V), dot(B, V), dot(T, L), dot(B, L), NdotV, ndotl);
            } else if (ext.aniso.w != 0.0) {
                let T = ext.aniso.xyz;
                let B = cross(N, T);
                let at = max(a * (1.0 + ext.aniso.w), 0.002);
                let ab = max(a * (1.0 - ext.aniso.w), 0.002);
                brdf = distributionGGXAniso(at, ab, dot(T, H), dot(B, H), max(dot(N, H), 0.0))
                     * visibilityGGXAniso(at, ab, dot(T, V), dot(B, V), dot(T, L), dot(B, L), NdotV, ndotl);
            } else {
                brdf = distributionGGX(max(dot(N, H), 0.0), a) * visibilitySmithGGX(NdotV, ndotl, a);
            }
            var F = fresnelSchlick(max(dot(V, H), 0.0), F0);
            if (ext.film.x > 0.0) { F = filmFresnel(F, max(dot(V, H), 0.0), ext.film); }
            gloss += radiance * F
                   * (brdf * 3.14159265 * specular);
        }
        if (col.a > 0.0 && atten > 0.0
            && (ext.coat.x > 0.0 || ext.scatter.a > 0.0 || dot(ext.sheen.rgb, vec3f(1.0)) > 0.0)) {
            let irr = col.rgb * (col.a * atten);
            let Hx = normalize(L + V);
            let VdotH = max(dot(V, Hx), 0.0);
            if (ext.coat.x > 0.0) {
                let coatNdotL = max(dot(ext.coatN.xyz, L), 0.0);
                let coatA = max(ext.coat.y * ext.coat.y, 1e-3);
                let Fc = (0.04 + 0.96 * pow(1.0 - VdotH, 5.0)) * ext.coat.x;
                extra += irr * coatNdotL
                       * (distributionGGX(max(dot(ext.coatN.xyz, Hx), 0.0), coatA) * (0.25 / max(VdotH * VdotH, 1e-4))
                          * Fc * 3.14159265);
            }
            if (dot(ext.sheen.rgb, vec3f(1.0)) > 0.0) {
                let sheenA = max(ext.sheen.a * ext.sheen.a, 1e-3);
                extra += irr * ndotl * ext.sheen.rgb
                       * (distributionCharlie(max(dot(N, Hx), 0.0), sheenA) * visibilityNeubelt(NdotV, ndotl) * 3.14159265);
            }
            if (ext.scatter.a > 0.0) {
                // The wrap is per channel once trans.w asks for it: red travels furthest, and every channel further where the
                // surface turns sharply (trans.z, a curvature 0..1), as a pre-integrated skin ramp would give.
                let wrapWidth = vec3f(ext.scatter.a) * mix(vec3f(1.0), vec3f(1.0, 0.45, 0.25) * (0.3 + 1.7 * ext.trans.z), ext.trans.w);
                let wrapped = clamp((vec3f(dot(N, L)) + wrapWidth) / (vec3f(1.0) + wrapWidth), vec3f(0.0), vec3f(1.0));
                extra += irr * ext.scatter.rgb * max(wrapped - vec3f(ndotl), vec3f(0.0));
                let Hb = normalize(L + N * 0.3);
                extra += irr * ext.scatter.rgb
                       * (pow(clamp(dot(V, -Hb), 0.0, 1.0), 4.0) * ext.trans.x * (1.0 - ext.trans.y));
            }
        }
    }
    return LightTerm(lit, gloss, extra);
}
fn applyLighting2DAO(albedo : vec3f, N : vec3f, worldPos : vec2f, ao : f32) -> vec3f {
    let P = vec3f(worldPos, 0.0);
    return applyLightingPBR(albedo, N, P, viewDirection(P), 0.0, 1.0, 0.0, ao);
}
fn applyLighting2D(albedo : vec3f, N : vec3f, worldPos : vec2f) -> vec3f {
    return applyLighting2DAO(albedo, N, worldPos, 1.0);
}
// The same, for a sprite that knows its layer: layerLane is the varying the vertex stage wrote (v_lightLayer).
fn applyLighting2DLayer(albedo : vec3f, N : vec3f, worldPos : vec2f, layerLane : f32) -> vec3f {
    g_surfaceLayer = layerLane;
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
std::string preprocessConditionals(const std::string& source, const std::vector<std::string>& features) {
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
    LineReader in(source);
    std::string line;
    while (in.next(line)) {
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
        result.source = preprocessConditionals(bodyIt->second, features);
        result.headerLineCount = 0;
        return result;
    }

    TextBuilder assembled;
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
        inject(wgslBatchTextureDecls(parsed.domain == "PostProcess"));
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
    std::string bodyText = bodyIt->second;
    if (stage == ShaderStage::Vertex && !parsed.wgslVertexHook.empty()) {
        fillHook(bodyText, "@@ES_VERTEX_HOOK@@", parsed.wgslVertexHook);
        // A material's vertex hook may read its textures too (a height field the surface is lifted by): the ones it names are declared
        // for this stage as well, and the device then makes their bindings visible to it.
        inject(wgslMaterialTextureDecls(parsed, bodyText, &parsed.wgslVertexHook));
    }
    if (stage == ShaderStage::Fragment) {
        inject(wgslMaterialTextureDecls(parsed, bodyIt->second));
        if (lit) inject(kLitHeaderWGSL);
        if (parsed.domain == "PostProcess" && parsed.usesLights) inject(kPostLightHeaderWGSL);
        inject(kColorHelpersWGSL);
    }
    // The records, for a stage that names them — the same question, and the same
    // answer, as the GLSL side. Before the texture completion below, so the unit
    // this reaches for is one of the ones it sees.
    if (stage == ShaderStage::Vertex && bodyIt->second.find("esInstance") != std::string::npos) {
        inject(instanceRecordWGSL());
    }
    // Last, so it sees every declaration made above as well as the body's own.
    inject(wgslReachedTextureDecls(assembled.str() + bodyIt->second,
                                   parsed.domain == "PostProcess"));

    assembled << bodyText;

    result.source = preprocessConditionals(assembled.str(), features);
    result.headerLineCount = headerLines;
    return result;
}

}  // namespace

bool ShaderParser::s_linearColor = false;

std::string ShaderParser::canonicalVaryingsWGSL(const ParsedShader& parsed) {
    if (!parsed.valid || !parsed.vertexIsCanonical) return {};
    return wgslCanonicalVSOut(parsed.domain == "Lit");
}

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
    // A tangent frame arrives through a varying only a vertex stage that knows about it writes: the engine's own canonical one,
    // or a shader that declares the feature. Any other keeps reading its frame from derivatives, as it always did.
    if (!parsed.vertexIsCanonical
        && std::find(parsed.features.begin(), parsed.features.end(), "MESH_TANGENTS") == parsed.features.end()) {
        features.erase(std::remove(features.begin(), features.end(), std::string("MESH_TANGENTS")), features.end());
    }
    if (target == ShaderTargetLanguage::WGSL) {
        return assembleWGSLStage(parsed, stage, features);
    }
    AssembledStage result;

    if (!parsed.valid) return result;

    auto stageIt = parsed.stages.find(stage);
    if (stageIt == parsed.stages.end()) return result;

    TextBuilder assembled;
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
            "}\n"
            // The display curve, one definition for every stage that needs it:
            // Narkowicz ACES. A tonemap is the OUTPUT transform, so a chain that
            // carries one applies it once, in the pass that also encodes.
            "highp vec3 acesFilmic(highp vec3 x) {\n"
            "    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);\n"
            "}\n"
            // Khronos PBR Neutral (Apache-2.0, KhronosGroup/ToneMapping): hue and saturation
            // survive the curve, so a lit red stays red where ACES walks it to cream.
            "highp vec3 pbrNeutral(highp vec3 c) {\n"
            "    const highp float startCompression = 0.8 - 0.04;\n"
            "    const highp float desaturation = 0.15;\n"
            "    highp float x = min(c.r, min(c.g, c.b));\n"
            "    highp float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;\n"
            "    c -= offset;\n"
            "    highp float peak = max(c.r, max(c.g, c.b));\n"
            "    if (peak < startCompression) return c;\n"
            "    const highp float d = 1.0 - startCompression;\n"
            "    highp float newPeak = 1.0 - d * d / (peak + d - startCompression);\n"
            "    c *= newPeak / peak;\n"
            "    highp float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);\n"
            "    return mix(c, newPeak * vec3(1.0, 1.0, 1.0), g);\n"
            "}\n";
        assembled << kColorHelpers;
        headerLines += countNewlines(kColorHelpers);
    }

    // The per-frame view-projection, injected identically into every stage (a block
    // declared two ways does not link) and engine-owned, so it cannot drift from the
    // std140 mirror in FrameConstants.hpp. highp: fragment has no default this early.
    // worldFromDepth takes the fullscreen pass's v_texCoord and a raw sample.
    // `depth * 2 - 1` is the ONE thing its WGSL twin spells differently: GL clips
    // z to [-1, 1], WebGPU to [0, 1]. The xy is shared — one screen triangle.
    static const char* kFrameHeader =
        "layout(std140) uniform FrameConstants {\n"
        "    highp mat4 u_projection;\n"
        "    highp vec4 u_camera;\n"  // xyz = eye (w=1) or direction toward it (w=0)
        "    highp mat4 u_inverseViewProjection;\n"
        "    highp vec4 u_renderOrigin;\n"  // xyz: what a position here is taken from, to be the world's own
        "};\n"
        "highp vec3 viewDirection(in highp vec3 worldPos) {\n"
        "    return u_camera.w > 0.5 ? normalize(u_camera.xyz - worldPos) : u_camera.xyz;\n"
        "}\n"
        "highp vec3 worldFromDepth(in highp vec2 uv, in highp float depth) {\n"
        "    highp vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);\n"
        "    highp vec4 world = u_inverseViewProjection * clip;\n"
        "    return world.xyz / world.w;\n"
        "}\n";
    assembled << kFrameHeader;
    headerLines += countNewlines(kFrameHeader);

    // Engine-owned frame block, injected into every stage (identical in both, so the
    // program links). u_time = (elapsed s, delta s, view exposure EV, 0); u_viewport = canvas
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
            assembled << (p.layered ? "uniform highp sampler2DArray " : "uniform highp sampler2D ") << p.name << ";\n";
            ++headerLines;
        }
    }

    // Lit domain: inject the shared LightConstants block (std140) + the applyLighting2D()
    // helper into the fragment stage. Authors write the surface (albedo) and a world-position
    // varying, then call the helper — the engine owns the std140 layout so a hand-written struct
    // can't silently mismatch renderer/LightConstants.hpp and corrupt lighting. Members + locals
    // carry explicit highp for the same reason MaterialConstants does: a fragment shader has no
    // default float precision until its `precision` line, which follows this injected header.

    if (stage == ShaderStage::Vertex) {
        // Every vertex stage, not only the Lit ones: an unlit mesh reads the same
        // record. Spelled twice because the twin generator compiles this under
        // Vulkan semantics, where gl_InstanceID does not exist.
        assembled << "#ifdef VULKAN\n"
                     "#define ES_INSTANCE_ID gl_InstanceIndex\n"
                     "#else\n"
                     "#define ES_INSTANCE_ID gl_InstanceID\n"
                     "#endif\n";
        headerLines += 5;
        // The records themselves, for a stage that names them. Reached-not-declared
        // is how wgslReachedTextureDecls decides the same question: one author for
        // the declaration, rather than a copy in every shader that reads a record.
        if (stageIt->second.find("esInstance") != std::string::npos) {
            const std::string decl = instanceRecordGLSLDecls();
            assembled << decl;
            headerLines += static_cast<u32>(std::count(decl.begin(), decl.end(), '\n'));
        }
    }
    // Declared by every Lit vertex because every Lit fragment takes it in. One
    // that never fills it reads slot 0 (the fragment clamps), not garbage.
    if (stage == ShaderStage::Vertex && parsed.domain == "Lit") {
        assembled << "flat out highp float v_probeSlot;\n";
        headerLines += 1;
    }

    // The light-array size and packing here MUST match renderer/LightConstants.hpp (MAX_LIGHTS,
    // GpuLight = four vec4s).
    if (stage == ShaderStage::Fragment && parsed.domain == "Lit") {
        static const char* kLitHeader =
            "struct Light { highp vec4 posDir; highp vec4 color; highp vec4 spot; highp vec4 shadow;"
            " highp vec4 shadowMap; highp vec4 falloff; };\n"
            "layout(std140) uniform LightConstants {\n"
            "    highp vec4 u_ambient;\n"
            "    Light u_lights[16];\n"
            "    highp vec4 u_mask2DRect;\n"      // xy = this camera's corner of a mask, zw its size
            "    highp mat4 u_shadowMatrix[16];\n"  // world -> each atlas tile's clip
            "    highp vec4 u_shadowTile[16];\n"  // xy = origin, z = side, w = bias
            "    highp vec4 u_shadowParams;\n"    // x = has map, y = one atlas texel
            "    highp vec4 u_envIrradiance[9];\n"  // SH9, rgb in xyz; zero = no environment
            "    highp vec4 u_envParams;\n"       // x = has map, y = range, z = maxLod, w = face
            "    highp vec4 u_envTint;\n"         // the ambient light's colour, scaling both halves
            "    highp vec4 u_reflParams;\n"      // x = columns in the bound atlas (1 = sky only)
            "    highp vec4 u_reflBox[30];\n"     // [2i] = column i+1's world min, [2i+1] its max
            "    highp vec4 u_bakedTint;\n"      // what baked indirect light is multiplied by
            "    Light u_tiledLights[96];\n"
            "    highp uvec4 u_tileMask[192];\n"
            "    highp vec4 u_tileInfo;\n"
            "};\n"
            // One run of nine per INSTANCE, not one for the draw: a merged draw
            // holds objects standing in many places. The flag in w tells "no
            // volume" from "a probe in the dark".
            "layout(std140) uniform ProbeConstants {\n"
            "    highp vec4 u_probeIrradiance[10 * 100];\n"
            "    highp vec4 u_probeTail;\n"      // see PROBE_BLOCK_BYTES
            "};\n"
            "layout(std140) uniform PlanarConstants {\n"
            "    highp mat4 u_planarProjection; highp vec4 u_planarParams;\n"
            "};\n"
            "flat in highp float v_probeSlot;\n"
            // The shadow map rides the draw's third texture slot, behind the feature the
            // MESH vertex sources set: the batch stream owns 0..7 as a per-vertex merge
            // product, so a sampler pinned to slot 2 there would read someone's sprite.
            "#ifdef ES_RECEIVE_SHADOW\n"
            "uniform highp sampler2D u_shadowMap;\n"
            "#endif\n"
            "#ifdef ES_ENV_MAP\n"
            "uniform highp sampler2D u_envMap;\n"
            "#endif\n"
            // The 2D shadow mask, on the top slot of the batch stream's eight, and the
            // light-shape mask one below it. Declared for every Lit shader: a sprite
            // receives 2D shadows, and a mesh standing in the same scene receives them.
            "uniform highp sampler2D u_shadow2D;\n"
            "uniform highp sampler2D u_lightShape2D;\n"
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
            "const highp float kShadowDisc = 24.0;\n"
            // Set by a hair shader before it lights: how much of the light a layer of strands takes, per world unit along it.
            "highp float g_hairShadow = 0.0;\n"
            // See the WGSL twin: a shader sets it before it lights to take the shadow as one hard edge.
            "highp float g_shadowHard = 0.0;\n"
            // A spiral, not a table: the golden angle spreads any number of taps evenly
            // over a disc, so the pattern follows the count instead of sitting beside it.
            "highp vec2 diskTap(in int i, in int n, in highp float radius) {\n"
            "    highp float a = float(i) * 2.3999632;\n"
            "    return radius * sqrt((float(i) + 0.5) / float(n)) * vec2(cos(a), sin(a));\n"
            "}\n"
            // The spiral turned point by point, so a wide penumbra grains instead of banding: see the WGSL twin.
            "highp vec2 diskTapSpun(in int i, in int n, in highp float radius, in highp float spin) {\n"
            "    highp float a = float(i) * 2.3999632 + spin;\n"
            "    return radius * sqrt((float(i) + 0.5) / float(n)) * vec2(cos(a), sin(a));\n"
            "}\n"
            "highp float shadowSpin(in highp vec3 worldPos) {\n"
            "    return 6.2831853 * fract(sin(dot(worldPos, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\n"
            "}\n"
            "// The spiral taps for 16 and 32 points, as numbers: the cos, the sin and the root of each tap do not change from one pixel to the next, so they are\n"
            "// not worked out in the pixel (a sin, a cos and a sqrt a tap, forty-eight taps). Each is turned by the pixel's own spin where it is used.\n"
            "const highp vec2 kInner5[5] = vec2[5](vec2(0.0), vec2(1.5, 0.0), vec2(-1.5, 0.0), vec2(0.0, 1.5), vec2(0.0, -1.5));\n"
            "const highp vec2 kSpiral8[8] = vec2[8](\n"
            "    vec2(0.2500000, 0.0000000),\n"
            "    vec2(-0.3192901, 0.2924959),\n"
            "    vec2(0.0488724, -0.5568765),\n"
            "    vec2(0.4024445, 0.5249175),\n"
            "    vec2(-0.7385351, -0.1306364),\n"
            "    vec2(0.6996049, -0.4450315),\n"
            "    vec2(-0.2340040, 0.8704838),\n"
            "    vec2(-0.4462715, -0.8592682));\n"
            "const highp vec2 kSpiral16[16] = vec2[16](\n"
            "    vec2(0.1767767, 0.0000000),\n"
            "    vec2(-0.2257722, 0.2068258),\n"
            "    vec2(0.0345580, -0.3937712),\n"
            "    vec2(0.2845713, 0.3711727),\n"
            "    vec2(-0.5222232, -0.0923739),\n"
            "    vec2(0.4946953, -0.3146848),\n"
            "    vec2(-0.1654658, 0.6155250),\n"
            "    vec2(-0.3155616, -0.6075943),\n"
            "    vec2(0.6846422, 0.2500301),\n"
            "    vec2(-0.7122560, 0.2940091),\n"
            "    vec2(0.3433543, -0.7337287),\n"
            "    vec2(0.2537305, 0.8089319),\n"
            "    vec2(-0.7647461, -0.4431856),\n"
            "    vec2(0.8971339, -0.1972327),\n"
            "    vec2(-0.5475066, 0.7787725),\n"
            "    vec2(-0.1264872, -0.9760896));\n"
            "const highp vec2 kSpiral32[32] = vec2[32](\n"
            "    vec2(0.1250000, 0.0000000),\n"
            "    vec2(-0.1596450, 0.1462479),\n"
            "    vec2(0.0244362, -0.2784383),\n"
            "    vec2(0.2012223, 0.2624588),\n"
            "    vec2(-0.3692676, -0.0653182),\n"
            "    vec2(0.3498024, -0.2225157),\n"
            "    vec2(-0.1170020, 0.4352419),\n"
            "    vec2(-0.2231357, -0.4296341),\n"
            "    vec2(0.4841152, 0.1767979),\n"
            "    vec2(-0.5036411, 0.2078959),\n"
            "    vec2(0.2427881, -0.5188246),\n"
            "    vec2(0.1794146, 0.5720012),\n"
            "    vec2(-0.5407571, -0.3133795),\n"
            "    vec2(0.6343695, -0.1394646),\n"
            "    vec2(-0.3871456, 0.5506753),\n"
            "    vec2(-0.0894400, -0.6901996),\n"
            "    vec2(0.5490720, 0.4627580),\n"
            "    vec2(-0.7388785, 0.0305553),\n"
            "    vec2(0.5389548, -0.5363326),\n"
            "    vec2(-0.0360577, 0.7797915),\n"
            "    vec2(-0.5128179, -0.6145265),\n"
            "    vec2(0.8123597, 0.1093013),\n"
            "    vec2(-0.6883103, 0.4789091),\n"
            "    vec2(0.1880855, -0.8360615),\n"
            "    vec2(0.4350338, 0.7591907),\n"
            "    vec2(-0.8504486, -0.2713156),\n"
            "    vec2(0.8261021, -0.3816809),\n"
            "    vec2(-0.3578875, 0.8551558),\n"
            "    vec2(-0.3194081, -0.8880335),\n"
            "    vec2(0.8499090, 0.4466874),\n"
            "    vec2(-0.9440344, 0.2488453),\n"
            "    vec2(0.5365950, -0.8345303));\n"
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
            // Hair: the light left after a depth of strand layers falls off with that depth, from the nearest card (what the map holds) to this one.
            // A blocker within a couple of texels toward the light is this card's own surface and does not count.
            "        if (g_hairShadow > 0.0) {\n"
            "            highp float reachHair = shadowDepth(m, worldPos + L * stepFor(texel, slope, 2.0));\n"
            "            highp float sumHair = 0.0;\n"
            "            highp float hitsHair = 0.0;\n"
            "            for (int i = 0; i < 8; ++i) {\n"
            "                highp vec2 at = clamp(at0 + diskTap(i, 8, 2.0) * u_shadowParams.y, lo, hi);\n"
            "                highp float d = unpackDepth(texture(u_shadowMap, at).rgb);\n"
            "                if (d < reachHair) { sumHair += d; hitsHair += 1.0; }\n"
            "            }\n"
            "            if (hitsHair < 0.5) return 1.0;\n"
            "            highp float Ah = length(vec3(m[0][2], m[1][2], m[2][2]));\n"
            "            highp float zbh = 2.0 * (sumHair / hitsHair) - 1.0;\n"
            "            highp float spanHair = (proj.z - zbh) / max(Ah, 1e-9);\n"
            "            if (hasEye) spanHair = lc.w - lc.w * (Ah - proj.z) / max(Ah - zbh, 1e-6);\n"
            "            return mix(1.0, exp(-g_hairShadow * max(spanHair, 0.0)), hitsHair * 0.125);\n"
            "        }\n"
            // A source with no size throws one edge: a tent over the 3x3 texels around the
            // point, weighted by where it falls among them. Equal weights step at every
            // texel and the map's grid shows along the edge; a 2x2 still stair-steps it.
            "        if (src <= 0.0 || g_shadowHard > 0.5) {\n"
            "            highp float texelUv = u_shadowParams.y;\n"
            "            highp vec2 f = at0 / texelUv - 1.0;\n"
            "            highp vec2 c = (floor(f) + 0.5) * texelUv;\n"
            "            highp vec2 t = fract(f);\n"
            "            highp vec3 wx = vec3((1.0 - t.x) * 0.5, 0.5, t.x * 0.5);\n"
            "            highp vec3 wy = vec3((1.0 - t.y) * 0.5, 0.5, t.y * 0.5);\n"
            "            highp float lit = 0.0;\n"
            "            for (int y = 0; y < 3; ++y) {\n"
            "                for (int x = 0; x < 3; ++x) {\n"
            "                    lit += wx[x] * wy[y] * shadowTap(c + vec2(float(x), float(y)) * texelUv,\n"
            "                                                     lo, hi, here);\n"
            "                }\n"
            "            }\n"
            "            return lit;\n"
            "        }\n"
            // What blocks this fragment, over the whole disc an edge can reach across —
            // against a depth that forgives that reach, since a tap r texels out lands r
            // texels along the surface and a one-texel bias would call the slope one.
            // Each tap forgives as far as it stands from the point: see the WGSL twin.
            "        highp float spin = shadowSpin(worldPos);\n"
            "        highp vec2 turn = vec2(cos(spin), sin(spin));\n"
            "        // The depth a tap forgives to is that of the point a step toward the light, and the step is linear in how far the tap stands: so the\n"
            "        // matrix is applied to the direction once, and a tap moves the clip position along it instead of going through the matrix again.\n"
            "        highp vec4 toLight = m * vec4(L, 0.0);\n"
            "        highp float stepBase = texel * 1.5 * (1.0 + slope);\n"
            "        highp float stepPer = texel * slope;\n"
            "        highp float sum = 0.0;\n"
            "        highp float hits = 0.0;\n"
            // The search disc is wide (kShadowDisc texels) and its sixteen taps are sparse: a caster narrower than the gap between them can stand
            // right over this fragment and be missed. The fragment's own texel and the four a step and a half round it are asked first, so a thin
            // or small caster is found where it is, and what they find is part of the blocker average like any other tap.
            "        for (int i = 0; i < 5; ++i) {\n"
            "            highp vec2 p = kInner5[i];\n"
            "            highp vec2 off = vec2(p.x * turn.x - p.y * turn.y, p.x * turn.y + p.y * turn.x);\n"
            "            highp vec2 at = clamp(at0 + off * u_shadowParams.y, lo, hi);\n"
            "            highp float d = unpackDepth(texture(u_shadowMap, at).rgb);\n"
            "            highp vec4 cr = lc + toLight * (stepBase + max(length(off), 1.0) * stepPer);\n"
            "            highp float reach = clamp(cr.z / max(cr.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);\n"
            "            if (d < reach) { sum += d; hits += 1.0; }\n"
            "        }\n"
            "        for (int i = 0; i < 16; ++i) {\n"
            "            highp vec2 p = kSpiral16[i];\n"
            "            highp vec2 off = kShadowDisc * vec2(p.x * turn.x - p.y * turn.y, p.x * turn.y + p.y * turn.x);\n"
            "            highp vec2 at = clamp(at0 + off * u_shadowParams.y, lo, hi);\n"
            "            highp float d = unpackDepth(texture(u_shadowMap, at).rgb);\n"
            "            highp vec4 cr = lc + toLight * (stepBase + max(length(off), 1.0) * stepPer);\n"
            "            highp float reach = clamp(cr.z / max(cr.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);\n"
            "            if (d < reach) { sum += d; hits += 1.0; }\n"
            "        }\n"
            "        if (hits < 0.5) return 1.0;\n"
            "        // A blocker on every tap of the disc an edge can reach across is the inside of a shadow, not an edge of one: nothing in the filter below would\n"
            "        // find light there, and its thirty-two taps are spent on a result of zero.\n"
            "        if (hits > 20.5) return 0.0;\n"

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
            "        // A penumbra of a texel or two is as well averaged over eight points as thirty-two: the taps are as dense in it either way, and the\n"
            "        // spiral is turned point by point, so what is left over is grain, not bands.\n"
            "        if (radius < 1.5) {\n"
            "            for (int i = 0; i < 8; ++i) {\n"
            "                highp vec2 p = kSpiral8[i];\n"
            "                highp vec2 off = radius * vec2(p.x * turn.x - p.y * turn.y, p.x * turn.y + p.y * turn.x);\n"
            "                soft += shadowTap(at0 + off * u_shadowParams.y, lo, hi, wide);\n"
            "            }\n"
            "            return soft * (1.0 / 8.0);\n"
            "        }\n"
            "        if (radius < 4.0) {\n"
            "            for (int i = 0; i < 16; ++i) {\n"
            "                highp vec2 p = kSpiral16[i];\n"
            "                highp vec2 off = radius * vec2(p.x * turn.x - p.y * turn.y, p.x * turn.y + p.y * turn.x);\n"
            "                soft += shadowTap(at0 + off * u_shadowParams.y, lo, hi, wide);\n"
            "            }\n"
            "            return soft * (1.0 / 16.0);\n"
            "        }\n"
            "        for (int i = 0; i < 32; ++i) {\n"
            "            highp vec2 p = kSpiral32[i];\n"
            "            highp vec2 off = radius * vec2(p.x * turn.x - p.y * turn.y, p.x * turn.y + p.y * turn.x);\n"
            "            soft += shadowTap(at0 + off * u_shadowParams.y, lo, hi, wide);\n"
            "        }\n"
            "        return soft * (1.0 / 32.0);\n"

            "    }\n"
            "    return 1.0;\n"
            "#endif\n"
            "}\n"
            // The coverage a cut-out's alpha gives this pixel: glTF's MASK, sharpened to about a pixel for alpha-to-coverage. See the WGSL twin.
            "highp float cutoutCoverage(in highp float a, in highp float cutoff, in highp float edge) {\n"
            "    return (a - cutoff) / max(edge, 1e-4) + 0.5;\n"
            "}\n"
            // The one normal-map unpack: X and Y from RG, Z rebuilt to unit length, so a
            // two-channel map (BC5, or B left at 0) lights like the three-channel one. 2D
            // applies it screen-space; a flat surface uses vec3(0,0,1).
            "highp vec3 sampleNormal(in highp sampler2D map, in highp vec2 uv) {\n"
            "    highp vec2 xy = texture(map, uv).xy * 2.0 - 1.0;\n"
            "    return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));\n"
            "}\n"
            "highp vec3 sampleNormalGrad(in highp sampler2D map, in highp vec2 uv,\n"
            "                            in highp vec2 ddx, in highp vec2 ddy) {\n"
            "    highp vec2 xy = textureGrad(map, uv, ddx, ddy).xy * 2.0 - 1.0;\n"
            "    return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));\n"
            "}\n"
            // Tangent frame from screen-space derivatives, so a tangent-space normal
            // lands in world space without the geometry carrying a tangent channel —
            // which most exported models do not. Degenerate UVs return N unchanged.
            "#ifdef MESH_TANGENTS\n"
            "in highp vec4 v_worldTangent;\n"
            "#endif\n"
            "highp vec3 perturbNormal(in highp vec3 N, in highp vec3 worldPos,\n"
            "                         in highp vec2 uv, in highp vec3 tangentNormal) {\n"
            "#ifdef MESH_TANGENTS\n"
            // The frame the normal map was baked in: the tangent made square to the interpolated normal.
            "    highp vec3 Tg = normalize(v_worldTangent.xyz - N * dot(N, v_worldTangent.xyz));\n"
            "    highp vec3 Bg = cross(N, Tg) * v_worldTangent.w;\n"
            "    return normalize(mat3(Tg, Bg, N) * tangentNormal);\n"
            "#else\n"
            "    highp vec3 dp1 = dFdx(worldPos);\n"
            "    highp vec3 dp2 = dFdy(worldPos);\n"
            "    highp vec2 duv1 = dFdx(uv);\n"
            "    highp vec2 duv2 = dFdy(uv);\n"
            "    highp vec3 dp2perp = cross(dp2, N);\n"
            "    highp vec3 dp1perp = cross(N, dp1);\n"
            "    highp vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;\n"
            "    highp vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;\n"
            // Degenerate against the surface's own scale: m falls with the fourth power
            // of distance, so a fixed floor turned normal maps off up close.
            "    highp float m = max(dot(T, T), dot(B, B));\n"
            "    highp float scale = max(dot(dp1, dp1), dot(dp2, dp2)) * max(dot(duv1, duv1), dot(duv2, duv2));\n"
            "    if (!(m > scale * 1e-6)) return N;\n"
            "    return normalize(mat3(T * inversesqrt(max(dot(T, T), 1e-20)), B * inversesqrt(max(dot(B, B), 1e-20)), N) * tangentNormal);\n"
            "#endif\n"
            "}\n"
            // Where a world point lands in this camera's part of a screen-space mask.
            // Measured on the Z = 0 plane, which is the plane a 2D occluder hides things
            // in, and drawn through this same camera so the landing agrees.
            "highp vec2 mask2DUv(in highp vec2 worldPos) {\n"
            "    highp vec4 clip = u_projection * vec4(worldPos, 0.0, 1.0);\n"
            "    if (clip.w <= 0.0) return vec2(-1.0);\n"
            // A negative height is the backend saying its texture rows run the other way.
            "    highp vec2 ndc = clip.xy / clip.w * 0.5 + 0.5;\n"
            "    highp float v = u_mask2DRect.w < 0.0 ? 1.0 - ndc.y : ndc.y;\n"
            "    return u_mask2DRect.xy + vec2(ndc.x * u_mask2DRect.z, v * abs(u_mask2DRect.w));\n"
            "}\n"
            "highp float mask2DChannel(in highp vec4 m, in highp float channel) {\n"
            "    return (channel < 0.5) ? m.r : (channel < 1.5) ? m.g\n"
            "        : (channel < 2.5) ? m.b : m.a;\n"
            "}\n"
            // What the shadow mask says here, for the light holding `channel` (negative
            // = one that casts none). An explicit LOD because this is read inside the
            // light loop, where a twin's WGSL forbids a sampled derivative.
            "highp float shadowFactor2D(in highp float channel, in highp vec2 worldPos) {\n"
            "    if (channel < 0.0 || u_mask2DRect.z <= 0.0) return 1.0;\n"
            "    highp vec2 uv = mask2DUv(worldPos);\n"
            "    if (uv.x < 0.0) return 1.0;\n"
            // Clamped, because two walls over one pixel add past one and a light cannot
            // be hidden more than entirely.
            "    highp float hidden = mask2DChannel(textureLod(u_shadow2D, uv, 0.0), channel);\n"
            "    return 1.0 - min(hidden, 1.0);\n"
            "}\n"
            // What the light's own SHAPE covers here — its cookie, drawn into the shape
            // mask at the light's place. A light with no shape keeps its whole circle.
            "highp float shapeFactor2D(in highp float channel, in highp vec2 worldPos) {\n"
            "    if (channel < 0.0 || u_mask2DRect.z <= 0.0) return 1.0;\n"
            "    highp vec2 uv = mask2DUv(worldPos);\n"
            "    if (uv.x < 0.0) return 1.0;\n"
            "    return min(mask2DChannel(textureLod(u_lightShape2D, uv, 0.0), channel), 1.0);\n"
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
            // Height-correlated Smith visibility for GGX: see the WGSL twin.
            "highp float visibilitySmithGGX(in highp float NdotV, in highp float NdotL, in highp float a) {\n"
            "    highp float a2 = a * a;\n"
            "    highp float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);\n"
            "    highp float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);\n"
            "    return 0.5 / max(gv + gl, 1e-5);\n"
            "}\n"
            "highp vec3 fresnelSchlick(in highp float VdotH, in highp vec3 F0) {\n"
            "    return F0 + (vec3(1.0) - F0) * pow(1.0 - VdotH, 5.0);\n"
            "}\n"
            // The split-sum environment term of GGX, fitted to the integral by tools/gen-dfg-fit.py. See the WGSL twin.
            "highp vec2 envBRDFApprox(in highp float NdotV, in highp float roughness) {\n"
            "    highp float tx = (2.0 * (clamp(NdotV, 0.02, 1.0) - 0.02) / 0.98 - 1.0);\n"
            "    highp float ty = 2.0 * clamp(roughness, 0.0, 1.0) - 1.0;\n"
            "    highp float px0 = 1.0;\n"
            "    highp float px1 = tx;\n"
            "    highp float px2 = (3.0 * tx * px1 - 1.0 * px0) / 2.0;\n"
            "    highp float px3 = (5.0 * tx * px2 - 2.0 * px1) / 3.0;\n"
            "    highp float px4 = (7.0 * tx * px3 - 3.0 * px2) / 4.0;\n"
            "    highp float px5 = (9.0 * tx * px4 - 4.0 * px3) / 5.0;\n"
            "    highp float px6 = (11.0 * tx * px5 - 5.0 * px4) / 6.0;\n"
            "    highp float py0 = 1.0;\n"
            "    highp float py1 = ty;\n"
            "    highp float py2 = (3.0 * ty * py1 - 1.0 * py0) / 2.0;\n"
            "    highp float py3 = (5.0 * ty * py2 - 2.0 * py1) / 3.0;\n"
            "    highp float py4 = (7.0 * ty * py3 - 3.0 * py2) / 4.0;\n"
            "    highp float py5 = (9.0 * ty * py4 - 4.0 * py3) / 5.0;\n"
            "    highp float py6 = (11.0 * ty * py5 - 5.0 * py4) / 6.0;\n"
            "    highp float g = 1.0 / (clamp(NdotV, 0.02, 1.0) + 0.1);\n"
            "    highp float sumMetal = 0.7771111 * px0 * py0 - 0.2780760 * px0 * py1 - 0.0654304 * px0 * py2 - 0.0705640 * px0 * py3 + 0.0859185 * px0 * py4 + 0.0016314 * px0 * py5 - 0.0014479 * px0 * py6 + 0.0048182 * px1 * py0 - 0.1346961 * px1 * py1 - 0.1342442 * px1 * py2 + 0.1115811 * px1 * py3 - 0.0497620 * px1 * py4 - 0.0098451 * px1 * py5 - 0.0004214 * px1 * py6 + 0.0004797 * px2 * py0 + 0.0654544 * px2 * py1 + 0.0215100 * px2 * py2 - 0.0948616 * px2 * py3 + 0.0774489 * px2 * py4 + 0.0139819 * px2 * py5 - 0.0151021 * px2 * py6 + 0.0022918 * px3 * py0 - 0.0244567 * px3 * py1 + 0.0056279 * px3 * py2 + 0.0393924 * px3 * py3 - 0.0613759 * px3 * py4 + 0.0099383 * px3 * py5 + 0.0092971 * px3 * py6 - 0.0025728 * px4 * py0 + 0.0085869 * px4 * py1 - 0.0069877 * px4 * py2 - 0.0115072 * px4 * py3 + 0.0327063 * px4 * py4 - 0.0167796 * px4 * py5 + 0.0019107 * px4 * py6 + 0.0018089 * px5 * py0 - 0.0031015 * px5 * py1 + 0.0047701 * px5 * py2 + 0.0018675 * px5 * py3 - 0.0134691 * px5 * py4 + 0.0139776 * px5 * py5 - 0.0087024 * px5 * py6 - 0.0008609 * px6 * py0 + 0.0010956 * px6 * py1 - 0.0024048 * px6 * py2 + 0.0005262 * px6 * py3 + 0.0035639 * px6 * py4 - 0.0080487 * px6 * py5 + 0.0080563 * px6 * py6 + 0.0220605 * py0 * g + 0.0049886 * py1 * g - 0.0108884 * py2 * g + 0.0359254 * py3 * g - 0.0336876 * py4 * g;\n"
            "    highp float sumDielectric = 0.1105178 * px0 * py0 - 0.1470108 * px0 * py1 + 0.0706290 * px0 * py2 - 0.0048613 * px0 * py3 - 0.0190413 * px0 * py4 + 0.0038142 * px0 * py5 - 0.0002643 * px0 * py6 - 0.1400053 * px1 * py0 + 0.2220226 * px1 * py1 - 0.1204309 * px1 * py2 + 0.0033027 * px1 * py3 + 0.0348652 * px1 * py4 - 0.0115348 * px1 * py5 + 0.0015711 * px1 * py6 + 0.0993738 * px2 * py0 - 0.1696809 * px2 * py1 + 0.1055418 * px2 * py2 - 0.0166890 * px2 * py3 - 0.0245166 * px2 * py4 + 0.0153020 * px2 * py5 - 0.0048468 * px2 * py6 - 0.0363361 * px3 * py0 + 0.0724203 * px3 * py1 - 0.0631513 * px3 * py2 + 0.0261354 * px3 * py3 + 0.0041759 * px3 * py4 - 0.0092203 * px3 * py5 + 0.0054510 * px3 * py6 + 0.0046882 * px4 * py0 - 0.0144579 * px4 * py1 + 0.0238812 * px4 * py2 - 0.0200861 * px4 * py3 + 0.0078934 * px4 * py4 - 0.0001779 * px4 * py5 - 0.0024009 * px4 * py6 + 0.0013258 * px5 * py0 - 0.0006506 * px5 * py1 - 0.0049831 * px5 * py2 + 0.0084229 * px5 * py3 - 0.0075026 * px5 * py4 + 0.0046720 * px5 * py5 - 0.0007627 * px5 * py6 - 0.0005364 * px6 * py0 + 0.0008141 * px6 * py1 + 0.0002790 * px6 * py2 - 0.0016584 * px6 * py3 + 0.0027280 * px6 * py4 - 0.0028646 * px6 * py5 + 0.0010557 * px6 * py6 - 0.0075790 * py0 * g + 0.0243928 * py1 * g - 0.0212081 * py2 * g + 0.0063496 * py3 * g + 0.0036408 * py4 * g;\n"
            "    highp float scale = (sumMetal - sumDielectric) / 0.96;\n"
            "    return vec2(scale, sumMetal - scale);\n"
            "}\n"
            // The WGSL twin's envDirection, for the same reason.
            "highp vec3 envDirection(in highp vec3 d) {\n"
            "    highp float a = -u_envTint.a;\n"
            "    highp float s = sin(a);\n"
            "    highp float c = cos(a);\n"
            "    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);\n"
            "}\n"
            // Nine coefficients at a normal. One expression: an environment and a
            // probe volume differ in where the nine came from, not in what they mean.
            "highp vec3 shIrradiance(in highp vec4 sh[9], in highp vec3 N) {\n"
            "    return sh[0].rgb * 0.282095\n"
            "        + sh[1].rgb * (0.488603 * N.y)\n"
            "        + sh[2].rgb * (0.488603 * N.z)\n"
            "        + sh[3].rgb * (0.488603 * N.x)\n"
            "        + sh[4].rgb * (1.092548 * N.x * N.y)\n"
            "        + sh[5].rgb * (1.092548 * N.y * N.z)\n"
            "        + sh[6].rgb * (0.315392 * (3.0 * N.z * N.z - 1.0))\n"
            "        + sh[7].rgb * (1.092548 * N.x * N.z)\n"
            "        + sh[8].rgb * (0.546274 * (N.x * N.x - N.y * N.y));\n"
            "}\n"
            // The environment's diffuse half. With no environment the coefficients
            // are zero and this IS the flat ambient term, which keeps every existing
            // scene pixel-identical rather than merely close.
            "highp vec3 envIrradiance(in highp vec3 Nw) {\n"
            "    highp vec3 sh = shIrradiance(u_envIrradiance, envDirection(Nw));\n"
            "    return u_ambient.rgb + max(sh, vec3(0.0)) * u_envTint.rgb;\n"
            "}\n"
            // The indirect term every lit surface starts from. A volume REPLACES the
            // environment rather than adding to it — a surface has one indirect term
            // — and its nine are world-space, so neither rotation nor tint applies.
            "highp int probeRun() { return clamp(int(v_probeSlot), 0, 99) * 10; }\n"
            // Which column of the atlas this instance reflects. Zero — inside no probe,
            // or a draw carrying no run at all — is the environment, which is what every
            // surface reflected before there were probes.
            "highp float reflectionColumn() { return u_probeIrradiance[probeRun() + 9].x; }\n"
            // A bake outranks a volume for the same reason a volume outranks the sky:
            // it holds every light and bounce that reached this very point.
            "highp vec3 indirectIrradiance(in highp vec3 N) {\n"
            "#ifdef MESH_LIGHTMAP\n"
            "    if (v_lightmap.z > 0.5) return bakedIrradiance() * u_bakedTint.rgb;\n"
            "#endif\n"
            "    highp int base = probeRun();\n"
            "    if (u_probeIrradiance[base].w > 0.5) {\n"
            "        highp vec4 sh[9];\n"
            "        for (int i = 0; i < 9; i++) sh[i] = u_probeIrradiance[base + i];\n"
            "        return max(shIrradiance(sh, N), vec3(0.0)) * u_bakedTint.rgb;\n"
            "    }\n"
            "    return envIrradiance(N);\n"
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
            "highp vec3 envSampleColumn(in highp vec3 R, in highp float mip,\n"
            "                           in highp float column) {\n"
            "#ifndef ES_ENV_MAP\n"
            "    return vec3(0.0);\n"
            "#else\n"
            "    highp float face = u_envParams.w;\n"
            "    highp float size = face * exp2(-mip);\n"
            "    highp float yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;\n"
            "    highp float col = face + 2.0;\n"
            "    highp float atlasW = col * u_reflParams.x;\n"
            "    highp float atlasH = 2.0 * face * (1.0 - exp2(-(u_envParams.z + 1.0)))\n"
            "                       + 2.0 * (u_envParams.z + 1.0);\n"
            // The sky turns with the environment; a baked column does not — it was
            // solved in world space, and turning it would spin a room about its middle.
            "    highp vec2 uv = octEncode(column < 0.5 ? envDirection(R) : R);\n"
            // Kept inside this column's own face, border ring included: a tap that
            // leaves it reads whatever the sampler's wrap mode says, and the two
            // backends do not answer that alike.
            "    highp vec2 lo = vec2(column * col + 0.5, yOff + 0.5);\n"
            "    highp vec2 hi = vec2(column * col + size + 1.5, yOff + size + 1.5);\n"
            "    highp vec2 px = clamp(vec2(column * col + 1.0 + uv.x * size,\n"
            "                              yOff + 1.0 + uv.y * size), lo, hi);\n"
            // Level 0 by name, like the WGSL twin: the atlas stacks its own mips, and
            // one the hardware picks mixes neighbouring columns wherever the fold
            // makes the derivatives jump.
            "    highp vec4 t = textureLod(u_envMap, px / vec2(atlasW, atlasH), 0.0);\n"
            "    return t.rgb * t.rgb * (t.a * t.a * u_envParams.y);\n"
            "#endif\n"
            "}\n"
            "highp vec3 envSampleMip(in highp vec3 R, in highp float mip) {\n"
            "    return envSampleColumn(R, mip, 0.0);\n"
            "}\n"
            // Where the reflected ray LEAVES this column's box, aimed from there rather
            // than from infinitely far: what makes a reflection slide across a wall as
            // the eye moves instead of being painted onto it.
            "highp vec3 reflectionDirection(in highp vec3 R, in highp vec3 P,\n"
            "                               in highp float column) {\n"
            "    if (column < 0.5) return R;\n"
            "    highp int i = int(column) * 2 - 2;\n"
            "    highp vec3 lo = u_reflBox[i].xyz;\n"
            "    highp vec3 hi = u_reflBox[i + 1].xyz;\n"
            // Never zero, so a ray parallel to a face divides to an infinity the min
            // discards rather than to the NaN that would blacken the pixel.
            "    highp vec3 d = max(abs(R), vec3(1e-6)) * (step(vec3(0.0), R) * 2.0 - 1.0);\n"
            "    highp vec3 far = max((hi - P) / d, (lo - P) / d);\n"
            "    highp float t = min(min(far.x, far.y), far.z);\n"
            "    if (!(t > 0.0)) return R;\n"
            "    return (P + R * t) - (lo + hi) * 0.5;\n"
            "}\n"
            // The environment's specular half, at the roughness asked for. Without a map
            // this is the flat ambient term, the same way the diffuse half is.
            "highp vec3 envRadiance(in highp vec3 R, in highp float roughness,\n"
            "                       in highp float column, in highp vec3 P) {\n"
            "#ifdef ES_ENV_MAP\n"
            "    if (u_planarParams.x > 0.5) {\n"
            "        highp vec4 clip = u_planarProjection * vec4(P, 1.0);\n"
            "        if (clip.w <= 0.0) return vec3(0.0);\n"
            "        highp vec2 uv = clip.xy / clip.w * vec2(0.5, 0.5 * u_planarParams.y) + 0.5;\n"
            "        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec3(0.0);\n"
            "        highp vec2 r = max(u_planarParams.zw, vec2(roughness * roughness * 0.015));\n"
            "        return (textureLod(u_envMap, uv, 0.0).rgb * 4.0\n"
            "            + textureLod(u_envMap, clamp(uv + vec2(r.x, 0.0), 0.0, 1.0), 0.0).rgb\n"
            "            + textureLod(u_envMap, clamp(uv - vec2(r.x, 0.0), 0.0, 1.0), 0.0).rgb\n"
            "            + textureLod(u_envMap, clamp(uv + vec2(0.0, r.y), 0.0, 1.0), 0.0).rgb\n"
            "            + textureLod(u_envMap, clamp(uv - vec2(0.0, r.y), 0.0, 1.0), 0.0).rgb) * 0.125;\n"
            "    }\n"
            "#endif\n"
            "    if (u_envParams.x < 0.5) return u_ambient.rgb;\n"
            "    highp vec3 dir = reflectionDirection(R, P, column);\n"
            "    highp float lod = clamp(roughness, 0.0, 1.0) * u_envParams.z;\n"
            "    highp float lo = floor(lod);\n"
            "    highp vec3 a = envSampleColumn(dir, lo, column);\n"
            "    highp vec3 b = envSampleColumn(dir, min(lo + 1.0, u_envParams.z), column);\n"
            // A baked column is the WHOLE radiance that reached its probe — the sky,
            // the ambient and every bounce. Adding the flat term or the sky's tint on
            // top would count the light the capture already saw a second time.
            "    if (column >= 0.5) {\n"
            "        highp vec3 baked = mix(a, b, lod - lo);\n"
            // What the bake saw, as the weather now says it looks: dimmer, and with less of its colour.
            "        highp float grey = dot(baked, vec3(0.2126, 0.7152, 0.0722));\n"
            "        return mix(vec3(grey), baked, u_reflParams.z) * u_reflParams.y;\n"
            "    }\n"
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
            // The ramp from a light's reach down to nothing: fo.x holds it at full out to
            // its own radius, fo.y shapes what is left. The exponent is floored because
            // pow(0, 0) is 1 — a light that reaches nowhere would light everything.
            "highp float distanceFalloff(in highp float dist, in highp float reach,\n"
            "                            in highp vec4 fo) {\n"
            "    highp float ramp = clamp((reach - dist) / max(reach - fo.x, 1e-4), 0.0, 1.0);\n"
            "    return pow(ramp, max(fo.y, 1e-3));\n"
            "}\n"
            // What a surface has beyond a base colour and a metal/rough pair: a clear coat over it, a sheen on it, grooves that stretch
            // its highlight, light that scatters into it or passes through it, a thin film that tints its reflection. All zero is the
            // plain surface (surfaceExtNone), and every term below sits behind a branch on it, so the plain surface pays nothing.
            //   coat    x strength, y perceptual roughness      coatN  the coat's own normal (the geometric one, not the bump map's)
            //   sheen   rgb colour, a perceptual roughness      aniso  xyz tangent (unit, across N), w strength -1..1
            //   scatter rgb colour scattered light takes, a wrap 0..1
            //   trans   x light passing through, y thickness 0..1, z curvature 0..1, w how far the wrap is per channel and curvature-shaped
            //   film    x strength, y film index, z thickness in nm
            //   misc    x dielectric reflectance at normal incidence (0.04 for an index of 1.5)
            "struct SurfaceExt {\n"
            "    highp vec4 coat;\n"
            "    highp vec4 coatN;\n"
            "    highp vec4 sheen;\n"
            "    highp vec4 aniso;\n"
            "    highp vec4 scatter;\n"
            "    highp vec4 trans;\n"
            "    highp vec4 film;\n"
            "    highp vec4 misc;\n"
            "    highp vec4 strand;\n"
            "};\n"
            "SurfaceExt surfaceExtNone(in highp vec3 N) {\n"
            "    return SurfaceExt(vec4(0.0), vec4(N, 0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0),\n"
            "                      vec4(0.04, 0.0, 0.0, 0.0), vec4(0.6, 0.0, 0.0, 0.0));\n"
            "}\n"
            "highp float distributionCharlie(in highp float NdotH, in highp float a) {\n"
            "    highp float invA = 1.0 / max(a, 1e-3);\n"
            "    highp float sin2 = max(1.0 - NdotH * NdotH, 0.0078125);\n"
            "    return (2.0 + invA) * pow(sin2, invA * 0.5) / 6.28318531;\n"
            "}\n"
            "highp float visibilityNeubelt(in highp float NdotV, in highp float NdotL) {\n"
            "    return 1.0 / max(4.0 * (NdotL + NdotV - NdotL * NdotV), 1e-4);\n"
            "}\n"
            "highp float distributionGGXAniso(in highp float at, in highp float ab, in highp float ToH,\n"
            "                                 in highp float BoH, in highp float NoH) {\n"
            "    highp float a2 = at * ab;\n"
            "    highp vec3 d = vec3(ab * ToH, at * BoH, a2 * NoH);\n"
            "    highp float b2 = a2 / max(dot(d, d), 1e-7);\n"
            "    return a2 * b2 * b2 / 3.14159265;\n"
            "}\n"
            "highp float visibilityGGXAniso(in highp float at, in highp float ab, in highp float ToV, in highp float BoV,\n"
            "                               in highp float ToL, in highp float BoL, in highp float NoV, in highp float NoL) {\n"
            "    highp float lambdaV = NoL * length(vec3(at * ToV, ab * BoV, NoV));\n"
            "    highp float lambdaL = NoV * length(vec3(at * ToL, ab * BoL, NoL));\n"
            "    return 0.5 / max(lambdaV + lambdaL, 1e-5);\n"
            "}\n"
            "highp vec3 filmFresnel(in highp vec3 F, in highp float cosTheta, in highp vec4 film) {\n"
            "    highp float sinT2 = (1.0 - cosTheta * cosTheta) / (film.y * film.y);\n"
            "    highp float cosT = sqrt(max(1.0 - sinT2, 0.0));\n"
            "    highp float opd = 2.0 * film.y * film.z * cosT;\n"
            "    highp vec3 tint = vec3(0.5) + 0.5 * cos(6.28318531 * opd / vec3(650.0, 510.0, 475.0));\n"
            "    return clamp(F * mix(vec3(1.0), tint * 2.0, film.x), vec3(0.0), vec3(1.0));\n"
            "}\n"
            // The body of the per-light loop, a function so that the lights the tiles carry are shaded by the same code as the sixteen.
            // The layer of the sprite being lit, as its vertex wrote it (the layer plus 129; 0 when the surface has none to test), and
            // whether a light's range of layers, which rides in shadowMap.y above the tile count, takes it in. See packLightLayerRange.
            "highp float g_surfaceLayer = 0.0;\n"
            "bool lightReachesLayer(in highp float rangeLane) {\n"
            "    if (rangeLane < 8.0 || g_surfaceLayer < 0.5) return true;\n"
            "    highp float range = floor(rangeLane / 8.0);\n"
            "    highp float lo = mod(range, 256.0) - 128.0;\n"
            "    highp float hi = 127.0 - floor(range / 256.0);\n"
            "    highp float layer = g_surfaceLayer - 129.0;\n"
            "    return layer >= lo && layer <= hi;\n"
            "}\n"
            "void shadeLight(in highp vec4 pd, in highp vec4 col, in highp vec4 sp, in highp vec4 sh, in highp vec4 sm,\n"
            "                in highp vec4 fo, in highp vec3 N, in highp vec3 V, in highp vec3 worldPos,\n"
            "                in highp float a, in highp vec3 F0, in highp float NdotV, in highp float specular,\n"
            "                in highp float roughness, in SurfaceExt ext, inout highp vec3 lit, inout highp vec3 gloss,\n"
            "                inout highp vec3 extra, in bool shadow3D);\n"
            // The lighting model in its general form; a lit 2D surface is its zero
            // (metallic 0, roughness 1, specular 0 leaves albedo * NdotL, pixel for pixel
            // what this engine has always drawn), so there is one model and not two.
            "highp vec3 applyLightingSurface(in highp vec3 albedo, in highp vec3 N, in highp vec3 worldPos,\n"
            "                                 in highp vec3 V, in highp float metallic,\n"
            "                                 in highp float roughness, in highp float specular,\n"
            "                                 in highp float ao, in SurfaceExt ext) {\n"
            // glTF's specularFactor scales the whole lobe, so 0 removes it rather than
            // leaving Schlick's grazing-angle rim behind.
            "    highp vec3 F0 = mix(vec3(ext.misc.x), albedo, metallic);\n"
            "    highp float a = max(roughness * roughness, 1e-3);\n"
            "    highp float NdotV = max(dot(N, V), 1e-4);\n"
            // Occlusion darkens the light that arrives from everywhere, which is the
            // environment; a surface's own lights are unobstructed by it.
            "    highp vec3 lit = indirectIrradiance(N) * ao;\n"
            "    highp vec3 gloss = vec3(0.0);\n"
            "    highp vec3 extra = vec3(0.0);\n"
            // A Light has no third coordinate, so distance stays in the plane and a
            // point light's height is its radius. Normal and view are the 3D part.
            "    for (int i = 0; i < 16; ++i) {\n"
            "        shadeLight(u_lights[i].posDir, u_lights[i].color, u_lights[i].spot, u_lights[i].shadow,\n"
            "                   u_lights[i].shadowMap, u_lights[i].falloff, N, V, worldPos, a, F0, NdotV,\n"
            "                   specular, roughness, ext, lit, gloss, extra, true);\n"
            "    }\n"
            // The lights past the sixteen: this pixel's tile is found from where the fragment lands through the camera it was drawn by
            // (normalized device coordinates, the same on every backend), and only the lights whose bit is set in its mask are shaded.
            "    int tiledCount = int(u_tileInfo.x);\n"
            "    if (tiledCount > 0) {\n"
            "        highp vec4 tileClip = u_projection * vec4(worldPos, 1.0);\n"
            "        highp vec2 tileNdc = tileClip.xy / max(tileClip.w, 1e-4);\n"
            "        ivec2 tileCount = ivec2(int(u_tileInfo.y), int(u_tileInfo.z));\n"
            "        ivec2 tile = clamp(ivec2(floor((tileNdc * 0.5 + 0.5) * vec2(tileCount))), ivec2(0), tileCount - ivec2(1));\n"
            "        highp uvec4 mask = u_tileMask[tile.y * tileCount.x + tile.x];\n"
            "        for (int w = 0; w < 3; ++w) {\n"
            "            highp uint bits = w == 0 ? mask.x : (w == 1 ? mask.y : mask.z);\n"
            "            if (bits == 0u) continue;\n"
            "            for (int b = 0; b < 32; ++b) {\n"
            "                if ((bits & (1u << uint(b))) == 0u) continue;\n"
            "                int k = w * 32 + b;\n"
            "                if (k >= tiledCount) break;\n"
            "                shadeLight(u_tiledLights[k].posDir, u_tiledLights[k].color, u_tiledLights[k].spot,\n"
            "                           u_tiledLights[k].shadow, u_tiledLights[k].shadowMap, u_tiledLights[k].falloff,\n"
            "                           N, V, worldPos, a, F0, NdotV, specular, roughness, ext, lit, gloss, extra, false);\n"
            "            }\n"
            "        }\n"
            "    }\n"
            // The environment, which for this engine is the ambient term: the same
            // radiance from every direction. A metal has no diffuse, so without a
            // reflection of it a metal is black wherever no light happens to point.
            "    highp vec2 ab = envBRDFApprox(NdotV, roughness);\n"
            // Multiple scattering, and the diffuse under the specular: see the WGSL twin.
            "    highp float Ess = ab.x + ab.y;\n"
            "    highp vec3 FssEss = F0 * ab.x + ab.y;\n"
            "    highp vec3 FmsEms = vec3(0.0);\n"
            "    highp vec3 kd = vec3(1.0);\n"
            "    if (ext.misc.y <= 0.0 || ext.strand.y > 0.0) {\n"
            "        highp float Ems = 1.0 - Ess;\n"
            "        highp vec3 Favg = F0 + (vec3(1.0) - F0) / 21.0;\n"
            "        FmsEms = FssEss * Favg * Ems / (vec3(1.0) - Ems * Favg);\n"
            "        gloss *= vec3(1.0) + F0 * (1.0 / max(Ess, 0.05) - 1.0);\n"
            "        kd = max(vec3(1.0) - (FssEss + FmsEms) * specular, vec3(0.0));\n"
            "    }\n"
            "    highp vec3 envR = reflect(-V, N);\n"
            "    if (ext.aniso.w != 0.0 || ext.misc.y > 0.0) {\n"
            "        highp vec3 T = ext.aniso.xyz;\n"
            "        highp vec3 grain = (ext.aniso.w >= 0.0 && ext.misc.y <= 0.0) ? cross(N, T) : T;\n"
            "        highp vec3 bent = normalize(cross(cross(grain, V), grain));\n"
            "        envR = reflect(-V, normalize(mix(N, bent, ext.misc.y > 0.0 ? 0.55 : abs(ext.aniso.w))));\n"
            "    }\n"
            "    highp vec3 envF = FssEss + FmsEms;\n"
            "    if (ext.film.x > 0.0) envF = filmFresnel(envF, NdotV, ext.film);\n"
            "    gloss += envRadiance(envR, roughness, reflectionColumn(), worldPos)\n"
            "           * (ao * specular)\n"
            "           * envF;\n"
            "    highp vec3 base = albedo * (1.0 - metallic) * lit * kd + gloss;\n"
            "    highp float baseScale = 1.0;\n"
            "    if (ext.coat.x > 0.0) {\n"
            "        highp float coatNdotV = max(dot(ext.coatN.xyz, V), 1e-4);\n"
            "        highp vec2 cab = envBRDFApprox(coatNdotV, ext.coat.y);\n"
            "        highp float Fc = (0.04 * cab.x + cab.y) * ext.coat.x;\n"
            "        baseScale *= 1.0 - Fc;\n"
            "        extra += envRadiance(reflect(-V, ext.coatN.xyz), ext.coat.y, reflectionColumn(), worldPos) * (ao * Fc);\n"
            "    }\n"
            "    if (dot(ext.sheen.rgb, vec3(1.0)) > 0.0) {\n"
            "        highp float sheenAlbedo = 0.2 + 0.3 * ext.sheen.a;\n"
            "        baseScale *= 1.0 - max(max(ext.sheen.r, ext.sheen.g), ext.sheen.b) * sheenAlbedo;\n"
            "        extra += ext.sheen.rgb * (indirectIrradiance(N) * ao * sheenAlbedo);\n"
            "    }\n"
            "    return base * baseScale + extra;\n"
            "}\n"
            "highp vec3 applyLightingPBR(in highp vec3 albedo, in highp vec3 N, in highp vec3 worldPos,\n"
            "                            in highp vec3 V, in highp float metallic,\n"
            "                            in highp float roughness, in highp float specular,\n"
            "                            in highp float ao) {\n"
            "    return applyLightingSurface(albedo, N, worldPos, V, metallic, roughness, specular, ao, surfaceExtNone(N));\n"
            "}\n"
            "void shadeLight(in highp vec4 pd, in highp vec4 col, in highp vec4 sp, in highp vec4 sh, in highp vec4 sm,\n"
            "                in highp vec4 fo, in highp vec3 N, in highp vec3 V, in highp vec3 worldPos,\n"
            "                in highp float a, in highp vec3 F0, in highp float NdotV, in highp float specular,\n"
            "                in highp float roughness, in SurfaceExt ext, inout highp vec3 lit, inout highp vec3 gloss,\n"
            "                inout highp vec3 extra, in bool shadow3D) {\n"
            // A slot nothing lights from (the block holds sixteen and a scene has one or two): every term below is its colour times
            // its intensity, so it adds exactly nothing, but the lobe is worked out for it all the same without this.
            "        if (col.a == 0.0 || !lightReachesLayer(sm.y)) return;\n"
            "        highp vec3 L;\n"
            "        highp float atten;\n"
            "        highp vec2 target = pd.xy;\n"           // shadow-ray aim point (light position by default)
            "        bool castShadow = true;\n"
            "        if (pd.z < 0.5) {\n"
            "            highp vec3 toL = lightVector(pd, sh, worldPos);\n"
            "            highp float dist = lightDistance(toL);\n"
            "            atten = distanceFalloff(dist, max(pd.w, 0.0001), fo);\n"
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
            "            highp vec3 toL = lightVector(pd, sh, worldPos);\n"
            "            highp float dist = lightDistance(toL);\n"
            "            atten = distanceFalloff(dist, max(pd.w, 0.0001), fo);\n"
            "            L = towardLight(toL, N);\n"
            "            atten *= spotCone(sp, sh, toL, dist);\n"
            "        }\n"
            // Only pay for the mask read when the light actually reaches this fragment (skips
            // the zeroed/inactive slots and unlit fragments).
            "        if (col.a > 0.0 && atten > 0.0) {\n"
            "            atten *= shapeFactor2D(fo.w, worldPos.xy);\n"
            "        }\n"
            "        if (castShadow && col.a > 0.0 && atten > 0.0) {\n"
            "            atten *= mix(1.0, shadowFactor2D(sm.w, worldPos.xy), fo.z);\n"
            "        }\n"
            // The tiles this light rendered into, which are its own: a fragment
            // tested against every map in the atlas would be darkened by geometry
            // seen from somewhere no light reaching it is standing.
            // A light the tiles carry has no shadow map (the sixteen are where the lights that cast are), so its call says so and the compiler
            // drops the lookup from that copy of this function: a program holds the whole shadow filter once, not twice.
            "        if (shadow3D && mod(sm.y, 8.0) > 0.0 && atten > 0.0) {\n"
            "            atten *= mix(1.0, shadowFactor3D(worldPos, N, L, vec2(sh.x, sm.z),\n"
            "                                             int(sm.x), int(mod(sm.y, 8.0))), fo.z);\n"
            "        }\n"
            "        highp float ndotl = max(dot(N, L), 0.0);\n"
            // Hair (misc.y above zero; aniso.xyz is the strand): Kajiya-Kay diffuse, which lights a strand by how far light is from along it.
            "        if (ext.misc.y > 0.0) {\n"
            "            highp float along = dot(ext.aniso.xyz, L);\n"
            "            ndotl = mix(ndotl, sqrt(max(1.0 - along * along, 0.0)) * clamp(dot(N, L) * 0.5 + 0.65, 0.0, 1.0), ext.strand.x);\n"
            "        }\n"
            "        highp vec3 radiance = col.rgb * (col.a * ndotl * atten);\n"
            "        lit += radiance;\n"
            // A uniform branch: a surface that reflects nothing does not pay for the lobe. The pi turns the engine's light intensity
            // into the irradiance the BRDF wants (the diffuse side cancels it against albedo/pi). Hair has two narrow lobes of its own.
            "        if (specular > 0.0 && ext.misc.y > 0.0 && ext.strand.y <= 0.0) {\n"
            "            highp vec3 H = normalize(L + V);\n"
            "            highp float primaryExp = clamp(2.0 / (a * a), 8.0, 900.0);\n"
            "            highp vec3 t1 = normalize(ext.aniso.xyz + N * ext.misc.z);\n"
            "            highp vec3 t2 = normalize(ext.aniso.xyz + N * ext.misc.w);\n"
            "            highp float h1 = dot(t1, H);\n"
            "            highp float h2 = dot(t2, H);\n"
            "            highp float lobe1 = smoothstep(-1.0, 0.0, h1) * pow(sqrt(max(1.0 - h1 * h1, 0.0)), primaryExp);\n"
            "            highp float lobe2 = smoothstep(-1.0, 0.0, h2) * pow(sqrt(max(1.0 - h2 * h2, 0.0)), primaryExp * 0.3);\n"
            "            highp vec3 lightOn = col.rgb * (col.a * atten * clamp(dot(N, L) + 0.35, 0.0, 1.0));\n"
            "            gloss += lightOn * (lobe1 * 0.55 + lobe2 * ext.scatter.rgb * 1.6) * (ext.misc.y * specular);\n"
            "        } else if (specular > 0.0) {\n"
            "            highp vec3 H = normalize(L + V);\n"
            // Hair with an anisotropy: Principled's anisotropic GGX along the strand. See the WGSL twin.
            "            highp float brdf;\n"
            "            if (ext.misc.y > 0.0) {\n"
            "                highp vec3 T = ext.aniso.xyz;\n"
            "                highp vec3 B = cross(N, T);\n"
            "                highp float aspect = sqrt(max(1.0 - 0.9 * ext.strand.y, 0.01));\n"
            "                highp float at = max(a / aspect, 0.002);\n"
            "                highp float ab = max(a * aspect, 0.002);\n"
            "                brdf = distributionGGXAniso(at, ab, dot(T, H), dot(B, H), max(dot(N, H), 0.0))\n"
            "                     * visibilityGGXAniso(at, ab, dot(T, V), dot(B, V), dot(T, L), dot(B, L), NdotV, ndotl);\n"
            "            } else if (ext.aniso.w != 0.0) {\n"
            "                highp vec3 T = ext.aniso.xyz;\n"
            "                highp vec3 B = cross(N, T);\n"
            "                highp float at = max(a * (1.0 + ext.aniso.w), 0.002);\n"
            "                highp float ab = max(a * (1.0 - ext.aniso.w), 0.002);\n"
            "                brdf = distributionGGXAniso(at, ab, dot(T, H), dot(B, H), max(dot(N, H), 0.0))\n"
            "                     * visibilityGGXAniso(at, ab, dot(T, V), dot(B, V), dot(T, L), dot(B, L), NdotV, ndotl);\n"
            "            } else {\n"
            "                brdf = distributionGGX(max(dot(N, H), 0.0), a) * visibilitySmithGGX(NdotV, ndotl, a);\n"
            "            }\n"
            "            highp vec3 F = fresnelSchlick(max(dot(V, H), 0.0), F0);\n"
            "            if (ext.film.x > 0.0) F = filmFresnel(F, max(dot(V, H), 0.0), ext.film);\n"
            "            gloss += radiance * F\n"
            "                   * (brdf * 3.14159265 * specular);\n"
            "        }\n"
            "        if (col.a > 0.0 && atten > 0.0\n"
            "            && (ext.coat.x > 0.0 || ext.scatter.a > 0.0 || dot(ext.sheen.rgb, vec3(1.0)) > 0.0)) {\n"
            "            highp vec3 irr = col.rgb * (col.a * atten);\n"
            "            highp vec3 Hx = normalize(L + V);\n"
            "            highp float VdotH = max(dot(V, Hx), 0.0);\n"
            "            if (ext.coat.x > 0.0) {\n"
            "                highp float coatNdotL = max(dot(ext.coatN.xyz, L), 0.0);\n"
            "                highp float coatA = max(ext.coat.y * ext.coat.y, 1e-3);\n"
            "                highp float Fc = (0.04 + 0.96 * pow(1.0 - VdotH, 5.0)) * ext.coat.x;\n"
            "                extra += irr * coatNdotL\n"
            "                       * (distributionGGX(max(dot(ext.coatN.xyz, Hx), 0.0), coatA) * (0.25 / max(VdotH * VdotH, 1e-4))\n"
            "                          * Fc * 3.14159265);\n"
            "            }\n"
            "            if (dot(ext.sheen.rgb, vec3(1.0)) > 0.0) {\n"
            "                highp float sheenA = max(ext.sheen.a * ext.sheen.a, 1e-3);\n"
            "                extra += irr * ndotl * ext.sheen.rgb\n"
            "                       * (distributionCharlie(max(dot(N, Hx), 0.0), sheenA) * visibilityNeubelt(NdotV, ndotl) * 3.14159265);\n"
            "            }\n"
            "            if (ext.scatter.a > 0.0) {\n"
            "                highp vec3 wrapWidth = vec3(ext.scatter.a) * mix(vec3(1.0), vec3(1.0, 0.45, 0.25) * (0.3 + 1.7 * ext.trans.z), ext.trans.w);\n"
            "                highp vec3 wrapped = clamp((vec3(dot(N, L)) + wrapWidth) / (vec3(1.0) + wrapWidth), vec3(0.0), vec3(1.0));\n"
            "                extra += irr * ext.scatter.rgb * max(wrapped - vec3(ndotl), vec3(0.0));\n"
            "                highp vec3 Hb = normalize(L + N * 0.3);\n"
            "                extra += irr * ext.scatter.rgb\n"
            "                       * (pow(clamp(dot(V, -Hb), 0.0, 1.0), 4.0) * ext.trans.x * (1.0 - ext.trans.y));\n"
            "            }\n"
            "        }\n"
            "}\n"
            "highp vec3 applyLighting2DAO(highp vec3 albedo, highp vec3 N, highp vec2 worldPos,\n"
            "                             highp float ao) {\n"
            "    highp vec3 P = vec3(worldPos, 0.0);\n"
            "    return applyLightingPBR(albedo, N, P, viewDirection(P), 0.0, 1.0, 0.0, ao);\n"
            "}\n"
            "highp vec3 applyLighting2D(highp vec3 albedo, highp vec3 N, highp vec2 worldPos) {\n"
            "    return applyLighting2DAO(albedo, N, worldPos, 1.0);\n"
            "}\n"
            // The same, for a sprite that knows its layer: layerLane is the varying the vertex stage wrote (v_lightLayer).
            "highp vec3 applyLighting2DLayer(highp vec3 albedo, highp vec3 N, highp vec2 worldPos, highp float layerLane) {\n"
            "    g_surfaceLayer = layerLane;\n"
            "    return applyLighting2DAO(albedo, N, worldPos, 1.0);\n"
            "}\n";
        // Emitted only for a variant that has the feature, not behind an #ifdef:
        // a varying declared in dead text still reads as one to a tool that
        // pairs the stages by name, and this one has no vertex output without it.
        if (std::find(features.begin(), features.end(), "MESH_LIGHTMAP") != features.end()) {
            // The bake's atlas and where this fragment sits in it; z says whether this
            // object has a patch at all. Square-law over LIGHTMAP_RANGE, which the
            // baker encodes with.
            static const char* kLightmapHeader =
                "in highp vec3 v_lightmap;\n"
                "uniform highp sampler2D u_lightmap;\n"
                "highp vec3 bakedIrradiance() {\n"
                "    highp vec3 c = textureLod(u_lightmap, v_lightmap.xy, 0.0).rgb;\n"
                "    return c * c * 8.0;\n"
                "}\n";
            assembled << kLightmapHeader;
            headerLines += countNewlines(kLightmapHeader);
        }
        assembled << kLitHeader;
        headerLines += countNewlines(kLitHeader);
    }

    // The same block for a fullscreen pass that asks for it, with the two questions an effect puts to it.
    if (stage == ShaderStage::Fragment && parsed.domain == "PostProcess" && parsed.usesLights) {
        static const char* kPostLightHeader =
            "struct Light { highp vec4 posDir; highp vec4 color; highp vec4 spot; highp vec4 shadow;"
            " highp vec4 shadowMap; highp vec4 falloff; };\n"
            "layout(std140) uniform LightConstants {\n"
            "    highp vec4 u_ambient;\n"
            "    Light u_lights[16];\n"
            "    highp vec4 u_mask2DRect;\n"
            "    highp mat4 u_shadowMatrix[16];\n"
            "    highp vec4 u_shadowTile[16];\n"
            "    highp vec4 u_shadowParams;\n"
            "    highp vec4 u_envIrradiance[9];\n"
            "    highp vec4 u_envParams;\n"
            "    highp vec4 u_envTint;\n"
            "    highp vec4 u_reflParams;\n"
            "    highp vec4 u_reflBox[30];\n"
            "    highp vec4 u_bakedTint;\n"
            "    Light u_tiledLights[96];\n"
            "    highp uvec4 u_tileMask[192];\n"
            "    highp vec4 u_tileInfo;\n"
            "};\n"
            "uniform highp sampler2D u_shadowMap;\n"
            "highp float unpackDepth(in highp vec3 c) {\n"
            "    return dot(c, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));\n"
            "}\n"
            // The first directional light that shines: dir.xyz = where it stands in the sky, dir.w = 1 (0 = none).
            "void findSun(out highp vec4 dir, out highp vec4 color, out ivec2 tiles) {\n"
            "    dir = vec4(0.0);\n"
            "    color = vec4(0.0);\n"
            "    tiles = ivec2(0);\n"
            "    for (int i = 0; i < 16; ++i) {\n"
            "        Light l = u_lights[i];\n"
            "        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {\n"
            "            dir = vec4(-normalize(vec3(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);\n"
            "            color = l.color;\n"
            "            tiles = ivec2(int(l.shadowMap.x), int(mod(l.shadowMap.y, 8.0)));\n"
            "            return;\n"
            "        }\n"
            "    }\n"
            "}\n"
            // One tap, no filtering: a sample of air is not a surface.
            "highp float sunVisibility(in highp vec3 worldPos, in int first, in int count) {\n"
            "    if (u_shadowParams.x < 0.5 || count <= 0) return 1.0;\n"
            "    for (int k = 0; k < 16; ++k) {\n"
            "        if (k >= count) break;\n"
            "        int t = first + k;\n"
            "        highp mat4 m = u_shadowMatrix[t];\n"
            "        highp vec4 c = m * vec4(worldPos, 1.0);\n"
            "        if (c.w <= 0.0) continue;\n"
            "        highp vec3 proj = c.xyz / c.w;\n"
            "        highp vec2 uv = proj.xy * 0.5 + 0.5;\n"
            "        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) continue;\n"
            "        highp vec4 rect = u_shadowTile[t];\n"
            "        highp vec2 at = rect.xy + uv * rect.z;\n"
            "        highp vec2 lo = rect.xy + u_shadowParams.y * 0.5;\n"
            "        highp vec2 hi = rect.xy + rect.z - u_shadowParams.y * 0.5;\n"
            "        highp float d = unpackDepth(texture(u_shadowMap, clamp(at, lo, hi)).rgb);\n"
            "        return d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025 ? 0.0 : 1.0;\n"
            "    }\n"
            "    return 1.0;\n"
            "}\n";
        assembled << kPostLightHeader;
        headerLines += countNewlines(kPostLightHeader);
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

    // A shader that writes its own vertex stage can take a material's hook too: it says where with a marker,
    // and the material that borrows the stage supplies the text (see MaterialStore::shadowProgram).
    std::string bodyText = stageIt->second;
    if (stage == ShaderStage::Vertex && !parsed.vertexHook.empty()) {
        fillHook(bodyText, "@@ES_VERTEX_HOOK@@", parsed.vertexHook);
    }
    assembled << blankUniformBlock(bodyText, "FrameConstants");
    if (stage == ShaderStage::Vertex && stageIt->second.find("esInstance") != std::string::npos) {
        assembled << instanceRecordGLSLBodies();
    }

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

    usize ssPos = 0;
    std::string typeStr;
    prop.name = nextToken(argument, ssPos);
    typeStr = nextToken(argument, ssPos);
    if (prop.name.empty() || typeStr.empty()) {
        prop.name.clear();  // signal invalid → caller drops it
        return prop;
    }
    prop.layered = typeStr == "textureArray";
    prop.type = prop.layered ? ShaderPropertyType::Texture : stringToPropertyType(typeStr);

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
            // The top unit is the frame's per-object record, on every mesh shader
            // there is. Handing it out here would bind a material's texture over
            // the records and draw every object at the origin.
            if (textureUnit >= MESH_INSTANCE_TEXTURE_UNIT) {
                ES_LOG_ERROR("shader {}: texture param \"{}\" would take unit {}, which is the"
                             " per-object record; a material reads at most {} textures",
                             shader.name, p.name, textureUnit,
                             MESH_INSTANCE_TEXTURE_UNIT - MATERIAL_TEXTURE_UNIT_BASE);
                p.textureUnit = -1;
                p.std140Offset = -1;
                continue;
            }
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
