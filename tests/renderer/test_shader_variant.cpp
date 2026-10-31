// Native harness for the shader variant (feature-permutation) system (RC7-6).
//
// Compiles ShaderParser.cpp directly — no GL/engine link, so it runs on any C++20
// toolchain — and asserts the compile-time variant mechanism: #pragma feature is
// captured, requested features are injected as #define right after #version (so the
// shader body can #ifdef them), and variantKey is an order-independent cache key.

#include "esengine/resource/ShaderParser.hpp"
#include "esengine/renderer/rhi/ShaderEmbeds.generated.hpp"

#include <algorithm>
#include <cstdio>
#include <sstream>
#include <string>
#include <vector>

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

using namespace esengine::resource;

static const char* SRC = R"(#pragma shader "VariantTest"
#pragma version 300 es
#pragma feature TINT

#pragma vertex
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
#pragma end

#pragma fragment
precision mediump float;
out vec4 fragColor;
void main() {
#ifdef TINT
    fragColor = vec4(1.0, 0.0, 0.0, 1.0);
#else
    fragColor = vec4(1.0);
#endif
}
#pragma end
)";

// Fragment-only authoring: `#pragma vertex` is optional for 2D domains.
static const char* FRAG_ONLY_UNLIT = R"(#pragma shader "FragOnly"
#pragma version 300 es
#pragma domain Unlit

#pragma fragment
precision mediump float;
in vec4 v_color;
in vec2 v_texCoord;
out vec4 fragColor;
void main() { fragColor = v_color; }
#pragma end
)";

static const char* FRAG_ONLY_LIT = R"(#pragma shader "FragOnlyLit"
#pragma version 300 es
#pragma domain Lit

#pragma fragment
precision mediump float;
in vec4 v_color;
in highp vec2 v_worldPos;
out vec4 fragColor;
void main() { fragColor = vec4(applyLighting2D(v_color.rgb, vec3(0.0, 0.0, 1.0), v_worldPos), v_color.a); }
#pragma end
)";

static const char* FRAG_ONLY_POSTPROCESS = R"(#pragma shader "PPCanonical"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1)

#pragma fragment
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() { fragColor = texture(u_texture, v_texCoord) * u_intensity * u_viewport.z; }
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * mc.u_intensity * tc.u_viewport.z;
}
#pragma end
)";

static const char* FRAG_ONLY_UNKNOWN_DOMAIN = R"(#pragma shader "NoCanonical"
#pragma version 300 es
#pragma domain Compute3D

#pragma fragment
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
#pragma end
)";

// A fragment-only material with a WGSL twin: params (block + texture), a
// feature permutation, and the batch texture contract.
static const char* WGSL_TWIN_UNLIT = R"(#pragma shader "WgslTwin"
#pragma version 300 es
#pragma domain Unlit
#pragma feature GLOW
#pragma param u_progress float default(0)
#pragma param u_edgeColor color default(1,0.5,0,1)
#pragma param u_mask texture default(white)

#pragma fragment
precision mediump float;
in vec4 v_color;
in vec2 v_texCoord;
uniform sampler2D u_textures[8];
out vec4 fragColor;
void main() { fragColor = texture(u_textures[0], v_texCoord) * v_color * u_progress; }
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    var c = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_progress;
    let m = textureSampleLevel(u_mask, u_mask_s, v.v_texCoord, 0.0);
#ifdef GLOW
    c = c + mc.u_edgeColor * tc.u_time.x;
#else
    c = c * m;
#endif
    return c;
}
#pragma end
)";

static const char* WGSL_TWIN_LIT = R"(#pragma shader "WgslLit"
#pragma version 300 es
#pragma domain Lit

#pragma fragment
precision mediump float;
in vec4 v_color;
in highp vec2 v_worldPos;
out vec4 fragColor;
void main() { fragColor = vec4(applyLighting2D(v_color.rgb, vec3(0.0, 0.0, 1.0), v_worldPos), v_color.a); }
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return vec4f(applyLighting2D(v.v_color.rgb, vec3f(0.0, 0.0, 1.0), v.v_worldPos), v.v_color.a);
}
#pragma end
)";

// An authored twin pair (engine-embed shape): no canonical injection, so the
// fragment carries no VSOut/batch-texture prelude; variants resolve at
// assembly via the WGSL feature preprocessor.
static const char* WGSL_TWIN_AUTHORED = R"(#pragma shader "WgslPair"
#pragma version 300 es

#pragma vertex
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
#pragma end

#pragma fragment
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
#pragma end

#pragma vertex wgsl
@vertex fn vs_main(@location(0) pos : vec2f) -> @builtin(position) vec4f {
#ifdef LIT
    return frame.projection * vec4f(pos, 1.0, 1.0);
#else
    return frame.projection * vec4f(pos, 0.0, 1.0);
#endif
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main() -> @location(0) vec4f {
#if defined(A) && (defined(B) || !defined(C))
    let k = 0.25;
#elif defined(C) || D
    let k = 0.75;
#else
    let k = 0.125;
#endif
#ifndef LIT
    return vec4f(1.0);
#else
    return vec4f(0.5);
#endif
}
#pragma end
)";

// A `textureArray` param is a texture param in every respect but its declared type.
static const char* TEXTURE_ARRAY_PARAM = R"(#pragma shader "Layers"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_mask texture default(white)
#pragma param u_layers textureArray

#pragma fragment
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
void main() { fragColor = texture(u_layers, vec3(v_texCoord, 1.0)) * texture(u_mask, v_texCoord); }
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return textureSample(u_layers, u_layers_s, v.v_texCoord, 1) * textureSample(u_mask, u_mask_s, v.v_texCoord);
}
#pragma end
)";

static void testTextureArrayParam() {
    ParsedShader p = ShaderParser::parse(TEXTURE_ARRAY_PARAM);
    CHECK(p.valid, "textureArray shader parses");
    const ShaderProperty* layers = nullptr;
    for (const auto& prop : p.properties) if (prop.name == "u_layers") layers = &prop;
    CHECK(layers && layers->type == ShaderPropertyType::Texture && layers->layered && layers->textureUnit == 9,
          "textureArray is a layered texture param on the next material unit");

    const std::string frag = ShaderParser::assembleStage(p, ShaderStage::Fragment);
    CHECK(frag.find("uniform highp sampler2DArray u_layers;") != std::string::npos &&
          frag.find("uniform highp sampler2D u_mask;") != std::string::npos,
          "GLSL declares the array param as sampler2DArray and the plain one as sampler2D");

    const std::string wgsl = ShaderParser::assembleStage(p, ShaderStage::Fragment, "", {}, ShaderTargetLanguage::WGSL);
    CHECK(wgsl.find("@group(1) @binding(17) var u_layers : texture_2d_array<f32>;") != std::string::npos &&
          wgsl.find("@group(1) @binding(25) var u_layers_s : sampler;") != std::string::npos &&
          wgsl.find("@group(1) @binding(16) var u_mask : texture_2d<f32>;") != std::string::npos,
          "WGSL declares the array param as texture_2d_array at its unit's bindings");
}

static void testWGSLEmission() {
    const auto wgsl = [](const ParsedShader& p, ShaderStage s,
                         const std::vector<std::string>& features = {}) {
        return ShaderParser::assembleStage(p, s, "", features, ShaderTargetLanguage::WGSL);
    };

    ParsedShader p = ShaderParser::parse(WGSL_TWIN_UNLIT);
    CHECK(p.valid, "dual-language shader parses");
    CHECK(p.wgslVertexIsCanonical, "fragment-only twin gets the canonical WGSL vertex");

    const std::string vs = wgsl(p, ShaderStage::Vertex);
    CHECK(vs.find("@vertex fn vs_main") != std::string::npos, "canonical WGSL vertex emitted");
    CHECK(vs.find("@group(0) @binding(0) var<uniform> frame") != std::string::npos,
          "canonical WGSL vertex reads FrameConstants at binding 0");
    CHECK(vs.find("v_worldPos") == std::string::npos, "Unlit WGSL vertex has no world-pos varying");
    // See testFragmentOnly: the colour pass behind a material's depth prepass.
    CHECK(vs.find("@builtin(position) @invariant pos") != std::string::npos, "canonical WGSL vertex declares its position invariant");

    const std::string fs = wgsl(p, ShaderStage::Fragment);
    CHECK(fs.find("struct VSOut") != std::string::npos, "canonical varying interface injected");
    CHECK(fs.find("@group(1) @binding(0) var t0 : texture_2d<f32>;") != std::string::npos &&
          fs.find("@group(1) @binding(15) var s7 : sampler;") != std::string::npos,
          "batch texture contract (t0..t7 / s0..s7) injected");
    CHECK(fs.find("@group(0) @binding(3) var<uniform> tc : TimeConstants;") != std::string::npos,
          "TimeConstants twin injected at binding 3");
    CHECK(fs.find("u_progress : f32,") != std::string::npos &&
          fs.find("u_edgeColor : vec4f,") != std::string::npos &&
          fs.find("@group(0) @binding(1) var<uniform> mc : MaterialConstants;") != std::string::npos,
          "MaterialConstants twin carries the params at binding 1");
    CHECK(fs.find("@group(1) @binding(16) var u_mask : texture_2d<f32>;") != std::string::npos &&
          fs.find("@group(1) @binding(24) var u_mask_s : sampler;") != std::string::npos,
          "texture param lands at the material unit's group-1 bindings (unit 8 -> 16/24)");
    CHECK(fs.find("#ifdef") == std::string::npos && fs.find("#endif") == std::string::npos,
          "feature directives are resolved, not emitted");
    CHECK(fs.find("c = c * m;") != std::string::npos &&
          fs.find("tc.u_time.x") == std::string::npos,
          "feature off: the #else branch survives");
    CHECK(fs.find("LightConstants") == std::string::npos, "Unlit gets no lighting injection");

    const std::string fsGlow = wgsl(p, ShaderStage::Fragment, {"GLOW"});
    CHECK(fsGlow.find("mc.u_edgeColor * tc.u_time.x") != std::string::npos &&
          fsGlow.find("c = c * m;") == std::string::npos,
          "feature on: the #ifdef branch survives");

    const std::string glslFrag = ShaderParser::assembleStage(p, ShaderStage::Fragment);
    CHECK(glslFrag.find("u_textures[0]") != std::string::npos &&
          glslFrag.find("fs_main") == std::string::npos,
          "GLSL assembly is untouched by the twin section");

    ParsedShader lit = ShaderParser::parse(WGSL_TWIN_LIT);
    const std::string litVs = wgsl(lit, ShaderStage::Vertex);
    // From `world`, not from the attribute: the same stage serves two vertex
    // sources, and under MESH the position is local until the model matrix has
    // been applied. .xy because 2D lighting works in that plane.
    CHECK(litVs.find("out.v_worldPos = world.xy;") != std::string::npos,
          "Lit canonical WGSL vertex forwards world position");
    for (const auto& features : std::vector<std::vector<std::string>>{{}, {"MESH"}, {"SKINNED"}, {"MESH", "MESH_TANGENTS"}}) {
        const std::string vs = wgsl(lit, ShaderStage::Vertex, features);
        CHECK(vs.find('#') == std::string::npos, "Lit canonical WGSL vertex leaves no directive behind");
    }
    CHECK(wgsl(lit, ShaderStage::Vertex).find("a_lightLayer") != std::string::npos &&
          wgsl(lit, ShaderStage::Vertex, {"MESH"}).find("a_lightLayer") == std::string::npos,
          "#if !defined(MESH) && !defined(SKINNED) keeps the sprite-only attribute off a mesh");
    const std::string litFs = wgsl(lit, ShaderStage::Fragment);
    CHECK(litFs.find("@location(2) v_worldPos : vec2f,") != std::string::npos,
          "Lit VSOut carries the world-pos varying");
    CHECK(litFs.find("fn applyLighting2D") != std::string::npos &&
          litFs.find("@group(0) @binding(2) var<uniform> lc : LightConstants;") != std::string::npos &&
          litFs.find("array<Light, 16>") != std::string::npos,
          "Lit WGSL injection: LightConstants at binding 2 + lighting helpers");

    ParsedShader pair = ShaderParser::parse(WGSL_TWIN_AUTHORED);
    CHECK(pair.valid && !pair.wgslVertexIsCanonical, "authored twin pair skips canonical injection");
    const std::string pairFs = wgsl(pair, ShaderStage::Fragment);
    CHECK(pairFs.find("struct VSOut") == std::string::npos &&
          pairFs.find("var t0") == std::string::npos,
          "authored fragment twin gets no canonical prelude");
    CHECK(pairFs.find("var<uniform> tc") != std::string::npos,
          "TimeConstants still injected for authored twins");
    CHECK(pairFs.find("vec4f(1.0)") != std::string::npos && pairFs.find("vec4f(0.5)") == std::string::npos,
          "#ifndef keeps its branch when the feature is off");
    const auto kOf = [&](const std::vector<std::string>& features) {
        const std::string fs = wgsl(pair, ShaderStage::Fragment, features);
        const size_t at = fs.find("let k = ");
        return fs.find('#') == std::string::npos && at != std::string::npos && fs.find("let k = ", at + 1) == std::string::npos
            ? fs.substr(at + 8, fs.find(';', at) - at - 8) : std::string("?");
    };
    CHECK(kOf({}) == "0.125" && kOf({"A"}) == "0.25" && kOf({"A", "B", "C"}) == "0.25"
          && kOf({"A", "C"}) == "0.75" && kOf({"D"}) == "0.75",
          "#if / #elif expressions resolve at assembly");
    const std::string pairVsLit = wgsl(pair, ShaderStage::Vertex, {"LIT"});
    CHECK(pairVsLit.find("vec4f(pos, 1.0, 1.0)") != std::string::npos &&
          pairVsLit.find("vec4f(pos, 0.0, 1.0)") == std::string::npos,
          "authored WGSL vertex resolves its feature branch at assembly");

    // A GLSL-only shader has no twin: the WGSL target reports and returns empty.
    ParsedShader noTwin = ShaderParser::parse(FRAG_ONLY_UNLIT);
    CHECK(wgsl(noTwin, ShaderStage::Fragment).empty(), "missing twin yields an empty assembly");

    // PostProcess twins get the fullscreen canonical vertex + the PP-shaped
    // VSOut (uv only), with the same tc/mc/texture injections.
    ParsedShader pp = ShaderParser::parse(FRAG_ONLY_POSTPROCESS);
    CHECK(pp.valid && pp.wgslVertexIsCanonical, "fragment-only PP twin gets the canonical WGSL vertex");
    const std::string ppVs = wgsl(pp, ShaderStage::Vertex);
    CHECK(ppVs.find("out.pos = vec4f(v.a_position, 0.0, 1.0);") != std::string::npos &&
          ppVs.find("frame.projection") == std::string::npos,
          "PP canonical WGSL vertex is the clip-space pass-through");
    const std::string ppFs = wgsl(pp, ShaderStage::Fragment);
    CHECK(ppFs.find("@location(0) v_texCoord : vec2f,") != std::string::npos &&
          ppFs.find("v_color") == std::string::npos,
          "PP VSOut carries only the uv varying");
    CHECK(ppFs.find("var<uniform> tc") != std::string::npos &&
          ppFs.find("var<uniform> mc") != std::string::npos &&
          ppFs.find("var t0 : texture_2d<f32>;") != std::string::npos,
          "PP fragment twin gets the tc/mc blocks + engine texture contract");

    // Unknown stage language tags fail the parse with a pointed message.
    ParsedShader badTag = ShaderParser::parse(
        "#pragma shader \"Bad\"\n#pragma fragment glsl450\nvoid main() {}\n#pragma end\n");
    CHECK(!badTag.valid && badTag.errorMessage.find("Unknown stage language") != std::string::npos,
          "unknown stage language tag is a parse error");

    // `wgsl full` twins are self-contained programs (the cook-generated shape):
    // assembly skips every injected header — no tc/mc/canonical prelude — and
    // returns the body as-is, features resolved.
    ParsedShader full = ShaderParser::parse(
        "#pragma shader \"Full\"\n#pragma domain Unlit\n"
        "#pragma param u_a float default(0)\n"
        "#pragma vertex\nvoid main() { gl_Position = vec4(0.0); }\n#pragma end\n"
        "#pragma fragment\nvoid main() {}\n#pragma end\n"
        "#pragma vertex wgsl full\n"
        "@group(0) @binding(0) var<uniform> f : mat4x4<f32>;\n"
        "@vertex fn vs_main() -> @builtin(position) vec4<f32> { return f[0]; }\n#pragma end\n"
        "#pragma fragment wgsl full\n"
        "struct MC { u_a: f32 }\n@group(0) @binding(1) var<uniform> m : MC;\n"
        "@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(m.u_a); }\n#pragma end\n");
    CHECK(full.valid && !full.wgslVertexIsCanonical, "wgsl full twin pair parses");
    const std::string fullVs = wgsl(full, ShaderStage::Vertex);
    const std::string fullFs = wgsl(full, ShaderStage::Fragment);
    CHECK(fullVs.find("var<uniform> f :") != std::string::npos &&
          fullVs.find("TimeConstants") == std::string::npos,
          "full vertex twin skips the injected headers");
    CHECK(fullFs.find("var<uniform> m :") != std::string::npos &&
          fullFs.find("var<uniform> mc") == std::string::npos &&
          fullFs.find("var t0") == std::string::npos,
          "full fragment twin carries its own declarations, no tc/mc/texture injection");

    // A full twin on one stage composes with a normal twin on the other.
    ParsedShader mixed = ShaderParser::parse(
        "#pragma shader \"Mixed\"\n#pragma domain Unlit\n"
        "#pragma fragment\nvoid main() {}\n#pragma end\n"
        "#pragma fragment wgsl full\n"
        "@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }\n#pragma end\n");
    CHECK(mixed.valid && mixed.wgslVertexIsCanonical,
          "fragment-only full twin still gets the canonical WGSL vertex");
    const std::string mixedFs = wgsl(mixed, ShaderStage::Fragment);
    CHECK(mixedFs.find("struct VSOut") == std::string::npos &&
          mixedFs.find("fn fs_main") != std::string::npos,
          "full fragment twin skips the canonical prelude even beside a canonical vertex");

    // std140 offsets == WGSL uniform layout for the param type set: the two
    // backends read one buffer. float, vec3 (align 16), float (packs at 28).
    ParsedShader layout = ShaderParser::parse(
        "#pragma shader \"L\"\n#pragma domain Unlit\n"
        "#pragma param u_a float default(0)\n"
        "#pragma param u_b vec3 default(0,0,0)\n"
        "#pragma param u_c float default(0)\n"
        "#pragma fragment\nvoid main() {}\n#pragma end\n"
        "#pragma fragment wgsl\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(mc.u_a); }\n#pragma end\n");
    CHECK(layout.valid &&
          layout.properties[0].std140Offset == 0 &&
          layout.properties[1].std140Offset == 16 &&
          layout.properties[2].std140Offset == 28 &&
          layout.materialBlockSize == 32,
          "std140 layout matches WGSL uniform rules member-for-member");
}

static void testFragmentOnly() {
    ParsedShader unlit = ShaderParser::parse(FRAG_ONLY_UNLIT);
    CHECK(unlit.valid, "fragment-only Unlit shader parses");
    const std::string uv = ShaderParser::assembleStage(unlit, ShaderStage::Vertex);
    CHECK(uv.find("a_position") != std::string::npos, "canonical vertex stage injected");
    CHECK(uv.find("FrameConstants") != std::string::npos, "canonical vertex reads the FrameConstants UBO");
    CHECK(uv.find("v_worldPos") == std::string::npos, "Unlit canonical vertex has no world-pos varying");

    ParsedShader lit = ShaderParser::parse(FRAG_ONLY_LIT);
    CHECK(lit.valid, "fragment-only Lit shader parses");
    const std::string lv = ShaderParser::assembleStage(lit, ShaderStage::Vertex);
    CHECK(lv.find("v_worldPos = world.xy;") != std::string::npos,
          "Lit canonical vertex forwards world position");
    const std::string lf = ShaderParser::assembleStage(lit, ShaderStage::Fragment);
    CHECK(lf.find("applyLighting2D") != std::string::npos, "Lit fragment gets the lighting helper injected");
    // A material's depth prepass draws with mesh.esshader's vertex stage, which declares its position invariant; the colour pass lands on that
    // depth by an equal test from this stage, so it must declare it too. The drivers the pixel gates run on happen to agree without it; Metal does not.
    for (const ParsedShader* s : {&unlit, &lit}) {
        CHECK(ShaderParser::assembleStage(*s, ShaderStage::Vertex, "", {"MESH"}).find("invariant gl_Position;") != std::string::npos,
              "canonical GLSL vertex declares its position invariant");
    }

    ParsedShader pp = ShaderParser::parse(FRAG_ONLY_POSTPROCESS);
    CHECK(pp.valid, "fragment-only PostProcess shader parses");
    const std::string ppv = ShaderParser::assembleStage(pp, ShaderStage::Vertex);
    CHECK(ppv.find("gl_Position = vec4(a_position, 0.0, 1.0);") != std::string::npos &&
          ppv.find("u_projection *") == std::string::npos,
          "PostProcess canonical vertex is the clip-space pass-through (no projection)");

    // The tone curve has ONE definition, injected here, so this is the only
    // place its identity can be pinned. Nothing else in the repo asserts it.
    for (auto lang : {ShaderTargetLanguage::GLSL_ES300, ShaderTargetLanguage::WGSL}) {
        const std::string ppf = ShaderParser::assembleStage(pp, ShaderStage::Fragment, "", {}, lang);
        const bool glsl = lang == ShaderTargetLanguage::GLSL_ES300;
        CHECK(ppf.find("acesFilmic") != std::string::npos
                  && ppf.find("2.51") != std::string::npos
                  && ppf.find("2.43") != std::string::npos
                  && ppf.find("0.59") != std::string::npos,
              glsl ? "the ACES Narkowicz curve reaches a GLSL fragment stage, constants and all"
                   : "and the WGSL twin carries the same curve");
    }

    // A particle is drawn from an instanced vertex source, so the canonical stage
    // has a third shape. Both dialects: a twin that will not build is a pipeline
    // the device refuses with no mention of a shader.
    ParsedShader particle = ShaderParser::parse(
        "#pragma shader \"P\"\n#pragma version 300 es\n#pragma domain Unlit\n"
        "#pragma fragment\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n"
        "#pragma fragment wgsl\n@fragment fn fs_main(v : VSOut) -> @location(0) vec4f "
        "{ return vec4f(1.0); }\n#pragma end\n");
    const std::string pVs = ShaderParser::assembleStage(particle, ShaderStage::Vertex, "", {"PARTICLE"});
    CHECK(pVs.find("#define PARTICLE") != std::string::npos &&
          pVs.find("in vec3 a_inst_position;") != std::string::npos,
          "PARTICLE reaches the GLSL driver as a define, with the instance attributes");
    CHECK(pVs.find("viewDirection(a_inst_position)") != std::string::npos,
          "and billboards the quad from the instance's world position");
    const std::string pVsW = ShaderParser::assembleStage(
        particle, ShaderStage::Vertex, "", {"PARTICLE"}, ShaderTargetLanguage::WGSL);
    CHECK(pVsW.find("a_inst_position : vec3f") != std::string::npos &&
          pVsW.find("a_color : vec4f") == std::string::npos,
          "the WGSL twin takes the same attributes");
    CHECK(pVsW.find("fn viewDirection") != std::string::npos &&
          pVsW.find("fn viewDirection") < pVsW.find("viewDirection(v.a_inst_position)"),
          "and the helper it billboards with is declared before it is called");

    ParsedShader unknownDomain = ShaderParser::parse(FRAG_ONLY_UNKNOWN_DOMAIN);
    CHECK(!unknownDomain.valid, "a domain with no canonical vertex still errors");

    // A .esshader carries no format version, so a shader written before the lit
    // domains were renamed is answered at the parser or nowhere. It must arrive
    // as the domain it means, canonical vertex and all — not merely parse.
    ParsedShader legacyLit = ShaderParser::parse(
        "#pragma shader \"Old\"\n#pragma version 300 es\n#pragma domain Lit2D\n"
        "#pragma fragment\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n");
    CHECK(legacyLit.valid && legacyLit.domain == "Lit",
          "a shader authored as Lit2D arrives in the Lit domain");
    CHECK(ShaderParser::assembleStage(legacyLit, ShaderStage::Fragment)
              .find("applyLighting2D") != std::string::npos,
          "and gets that domain's injection, not just its name");
    ParsedShader legacyUnlit = ShaderParser::parse(
        "#pragma shader \"OldU\"\n#pragma version 300 es\n#pragma domain Unlit2D\n"
        "#pragma fragment\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n");
    CHECK(legacyUnlit.valid && legacyUnlit.domain == "Unlit",
          "a shader authored as Unlit2D arrives in the Unlit domain");

    ParsedShader authored = ShaderParser::parse(SRC);
    const std::string av = ShaderParser::assembleStage(authored, ShaderStage::Vertex);
    CHECK(av.find("a_pos") != std::string::npos, "an authored vertex stage is untouched");

    const std::string af = ShaderParser::assembleStage(authored, ShaderStage::Fragment);
    CHECK(av.find("uniform TimeConstants") != std::string::npos &&
          af.find("uniform TimeConstants") != std::string::npos,
          "u_time clock block injected into both stages");
    CHECK(af.find("vec4 u_viewport") != std::string::npos, "u_viewport rides the injected block");

    ParsedShader reserved = ShaderParser::parse(
        "#pragma shader \"R\"\n#pragma version 300 es\n#pragma domain Unlit\n"
        "#pragma param u_time float default(0)\n"
        "#pragma fragment\nvoid main() {}\n#pragma end\n");
    CHECK(!reserved.valid && reserved.errorMessage.find("reserved") != std::string::npos,
          "a param named after an injected uniform is rejected with a clear error");

    CHECK(av.find("uniform FrameConstants") != std::string::npos &&
          af.find("uniform FrameConstants") != std::string::npos,
          "the view-projection block is injected into both stages");
}

// A shader written before the engine injected FrameConstants declares its own.
// Two declarations of one block name never link, so the authored copy is blanked
// out — with its line count kept, or every compile-log line number after it moves.
static void testHandWrittenFrameBlock() {
    ParsedShader p = ShaderParser::parse(
        "#pragma shader \"Legacy\"\n#pragma version 300 es\n"
        "#pragma vertex\n"
        "layout(location = 0) in vec2 a_pos;\n"
        "layout(std140) uniform FrameConstants {\n"
        "    mat4 u_projection;\n"
        "};\n"
        "// uniform FrameConstants named in a comment stays put\n"
        "void main() { gl_Position = u_projection * vec4(a_pos, 0.0, 1.0); }\n"
        "#pragma end\n"
        "#pragma fragment\nvoid main() {}\n#pragma end\n");
    CHECK(p.valid, "a shader carrying its own frame block still parses");
    if (!p.valid) return;

    const std::string vs = ShaderParser::assembleStage(p, ShaderStage::Vertex);
    CHECK(vs.find("    mat4 u_projection;") == std::string::npos,
          "the authored member is blanked, so only the injected block declares the layout");
    CHECK(vs.find("// uniform FrameConstants named in a comment stays put") != std::string::npos,
          "a comment naming the block is not a declaration and survives");

    const std::string::size_type decl = vs.find("layout(location = 0) in vec2 a_pos;");
    const std::string::size_type note = vs.find("// uniform FrameConstants named");
    CHECK(decl != std::string::npos && note != std::string::npos && decl < note,
          "the authored body survives around the blanked block");
    if (decl == std::string::npos || note == std::string::npos || decl >= note) return;
    CHECK(std::count(vs.begin() + static_cast<long>(decl), vs.begin() + static_cast<long>(note),
                     '\n') == 4,
          "blanking keeps the line count, so compile-log remapping still lands");
}

/**
 * True when no line before the last vertex attribute uses a system value. ANGLE on
 * D3D11 places SV_InstanceID / SV_VertexID in the input signature where the stage first
 * names them and caches input layouts without the signature, so one stage naming one
 * early breaks every program sharing its layout. Textual, so every variant is covered.
 */
static bool systemValuesTrailAttributes(const std::string& src) {
    int line = 0, lastAttribute = -1, firstSystemValue = -1;
    std::istringstream in(src);
    for (std::string text; std::getline(in, text); ++line) {
        const std::size_t lead = text.find_first_not_of(" \t");
        if (lead == std::string::npos || text[lead] == '#' || text.compare(lead, 2, "//") == 0) continue;
        const std::string t = text.substr(lead);
        if (t.rfind("in ", 0) == 0 || (t.rfind("layout", 0) == 0 && t.find(") in ") != std::string::npos)) {
            lastAttribute = line;
        }
        const bool names = t.find("gl_InstanceID") != std::string::npos ||
                           t.find("gl_VertexID") != std::string::npos ||
                           t.find("ES_INSTANCE_ID") != std::string::npos;
        if (names && firstSystemValue < 0) firstSystemValue = line;
    }
    return firstSystemValue < 0 || firstSystemValue > lastAttribute;
}

static void testSystemValuesTrailAttributes() {
    ParsedShader early = ShaderParser::parse(
        "#pragma shader \"Early\"\n#pragma version 300 es\n"
        "#pragma vertex\nint id() { return gl_InstanceID; }\n"
        "layout(location = 0) in vec3 a_position;\n"
        "void main() { gl_Position = vec4(a_position, float(id())); }\n#pragma end\n"
        "#pragma fragment\nout vec4 o;\nvoid main() { o = vec4(1.0); }\n#pragma end\n");
    CHECK(!systemValuesTrailAttributes(ShaderParser::assembleStage(early, ShaderStage::Vertex)),
          "a stage naming gl_InstanceID before its attributes is caught");

    ParsedShader mesh = ShaderParser::parse(esengine::ShaderEmbeds::MESH);
    ParsedShader lit = ShaderParser::parse(FRAG_ONLY_LIT);
    const std::vector<std::vector<std::string>> variants = {
        {}, {"MESH_NORMALS", "LIT"}, {"MESH_NORMALS", "LIT", "SKINNED"}, {"SHADOW_DEPTH"},
        {"MESH_NORMALS", "LIT", "MESH_LIGHTMAP", "ES_RECEIVE_SHADOW", "ES_ENV_MAP"}};
    bool meshTrails = true;
    for (const auto& features : variants) {
        meshTrails = meshTrails && systemValuesTrailAttributes(
            ShaderParser::assembleStage(mesh, ShaderStage::Vertex, "", features));
    }
    CHECK(meshTrails, "mesh.esshader names no system value before its attributes");

    bool canonicalTrails = true;
    for (const auto& features : std::vector<std::vector<std::string>>{
             {"MESH"}, {"MESH", "MESH_NORMALS", "SKINNED"}, {"MESH", "MESH_LIGHTMAP"}, {"PARTICLE"}}) {
        canonicalTrails = canonicalTrails && systemValuesTrailAttributes(
            ShaderParser::assembleStage(lit, ShaderStage::Vertex, "", features));
    }
    CHECK(canonicalTrails, "the canonical material vertex names no system value before its attributes");
}

// A material's own vertex hook: the canonical MESH vertex stage calls it on the local-space
// vertex (after the morph, before the pose); a material without one assembles as it always has.
static const char* HOOKED_LIT = R"(#pragma shader "Hooked"
#pragma version 300 es
#pragma domain Lit
#pragma param u_bend float default(0.5)
#pragma vertexbounds 12.5

#pragma vertexoffset
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    local.x += sin(u_time.x) * u_bend;
}
#pragma end

#pragma vertexoffset wgsl
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    (*local).x = (*local).x + sin(tc.u_time.x) * mc.u_bend;
}
#pragma end

#pragma fragment
precision mediump float;
in vec4 v_color;
in highp vec2 v_worldPos;
out vec4 fragColor;
void main() { fragColor = v_color; }
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f { return v.v_color; }
#pragma end
)";

static void testVertexHook() {
    ParsedShader p = ShaderParser::parse(HOOKED_LIT);
    CHECK(p.valid, "a shader with a vertex hook parses");
    CHECK(p.vertexHook.find("esMaterialVertex") != std::string::npos, "the GLSL hook is captured");
    CHECK(p.wgslVertexHook.find("esMaterialVertex") != std::string::npos, "the WGSL hook is captured");
    CHECK(p.vertexBounds > 12.4f && p.vertexBounds < 12.6f, "#pragma vertexbounds is captured");
    CHECK(p.vertexIsCanonical, "a hooked shader still takes the engine's vertex stage");

    const std::string vs = ShaderParser::assembleStage(p, ShaderStage::Vertex, "", {"MESH", "MESH_NORMALS"});
    CHECK(vs.find("void esMaterialVertex(") != std::string::npos, "GLSL: the hook is defined in the vertex stage");
    CHECK(vs.find("esMaterialVertex(local, localNormal, a_texCoord);") != std::string::npos, "GLSL: the hook is called");
    CHECK(vs.find("applyMorph(local, localNormal);") < vs.find("esMaterialVertex(local, localNormal, a_texCoord);"),
          "GLSL: the hook runs after the morph target");
    CHECK(vs.find("esMaterialVertex(local, localNormal, a_texCoord);") < vs.find("vec4 world = esInstanceModel()"),
          "GLSL: the hook runs before the vertex is placed in the world");
    CHECK(vs.find("uniform MaterialConstants") != std::string::npos, "GLSL: the hook can read the material's params");

    const std::string ws = ShaderParser::assembleStage(p, ShaderStage::Vertex, "", {"MESH", "MESH_NORMALS"}, ShaderTargetLanguage::WGSL);
    CHECK(ws.find("fn esMaterialVertex(") != std::string::npos, "WGSL: the hook is defined in the vertex stage");
    CHECK(ws.find("esMaterialVertex(&local, &localNormal, v.a_texCoord);") != std::string::npos, "WGSL: the hook is called");
    CHECK(ws.find("var<uniform> mc : MaterialConstants") != std::string::npos, "WGSL: the hook can read the material's params");

    // The hook is for resident meshes. Without MESH the call is compiled out, 2D batches draw as before.
    const std::string batch = ShaderParser::assembleStage(p, ShaderStage::Vertex, "", {});
    CHECK(batch.find("#define MESH") == std::string::npos
              && batch.find("#ifdef MESH\nhighp vec4 es_vertexColor;\nvoid esMaterialVertex(") != std::string::npos
              && batch.find("#ifdef MESH\n    vec3 local = a_position;") != std::string::npos,
          "GLSL: the hook and its call sit under MESH, so a 2D batch variant compiles them out");

    // A shader with no hook assembles with no trace of one.
    ParsedShader plain = ShaderParser::parse(FRAG_ONLY_LIT);
    const std::string pv = ShaderParser::assembleStage(plain, ShaderStage::Vertex, "", {"MESH"});
    CHECK(pv.find("esMaterialVertex") == std::string::npos && pv.find("@@") == std::string::npos,
          "a shader without a hook has no hook, and no leftover placeholder");
    CHECK(plain.vertexBounds == 0.0f, "no bounds expansion without a hook");
}

// The shadow program a bent material gets: the engine's mesh depth shader with the material's hook and
// params grafted on, so the caster bends where the lit surface does.
static void testShadowGraft() {
    ParsedShader material = ShaderParser::parse(HOOKED_LIT);
    ParsedShader depth = ShaderParser::parse(esengine::ShaderEmbeds::MESH);
    CHECK(material.valid && depth.valid, "the material and the mesh depth shader both parse");
    depth.properties = material.properties;
    depth.materialBlockSize = material.materialBlockSize;
    depth.vertexHook = material.vertexHook;
    depth.wgslVertexHook = material.wgslVertexHook;
    const std::vector<std::string> features{"MESH_NORMALS", "SHADOW_DEPTH", "ES_MATERIAL_VERTEX"};

    const std::string vs = ShaderParser::assembleStage(depth, ShaderStage::Vertex, "", features);
    CHECK(vs.find("void esMaterialVertex(") != std::string::npos, "depth GLSL: the material's hook is defined");
    CHECK(vs.find("esMaterialVertex(local, localNormal, a_texCoord);") != std::string::npos, "depth GLSL: the hook is called");
    CHECK(vs.find("@@ES_VERTEX_HOOK@@") == std::string::npos, "depth GLSL: the marker is replaced");
    CHECK(vs.find("uniform MaterialConstants") != std::string::npos, "depth GLSL: the material's block is declared for the hook");

    const std::string ws = ShaderParser::assembleStage(depth, ShaderStage::Vertex, "", features, ShaderTargetLanguage::WGSL);
    CHECK(ws.find("fn esMaterialVertex(") != std::string::npos, "depth WGSL: the material's hook is defined");
    CHECK(ws.find("esMaterialVertex(&local, &localNormal, v.a_texCoord);") != std::string::npos, "depth WGSL: the hook is called");
    CHECK(ws.find("var<uniform> mc : MaterialConstants") != std::string::npos, "depth WGSL: the material's block is declared");

    // Without the feature the stock depth shader is untouched, hook or no hook.
    ParsedShader stock = ShaderParser::parse(esengine::ShaderEmbeds::MESH);
    const std::string plain = ShaderParser::assembleStage(stock, ShaderStage::Vertex, "", {"SHADOW_DEPTH"});
    CHECK(plain.find("esMaterialVertex(local") == std::string::npos || plain.find("#ifdef ES_MATERIAL_VERTEX") != std::string::npos,
          "the stock depth shader's call sits under ES_MATERIAL_VERTEX");
}

int main() {
    ParsedShader p = ShaderParser::parse(SRC);
    CHECK(p.valid, "shader parses");
    CHECK(p.features.size() == 1 && p.features[0] == "TINT", "#pragma feature TINT captured");

    const std::string withTint = ShaderParser::assembleStage(p, ShaderStage::Fragment, "", {"TINT"});
    CHECK(withTint.find("#version 300 es") != std::string::npos, "version emitted");
    CHECK(withTint.find("#define TINT 1") != std::string::npos, "feature define injected when enabled");
    CHECK(withTint.find("#version") < withTint.find("#define TINT"), "#version precedes the feature #define");

    const std::string noTint = ShaderParser::assembleStage(p, ShaderStage::Fragment, "", {});
    CHECK(noTint.find("#define TINT") == std::string::npos, "no feature define when disabled");

    CHECK(ShaderParser::variantKey({"B", "A"}) == "A|B", "variantKey is sorted/joined");
    CHECK(ShaderParser::variantKey({"A", "B"}) == ShaderParser::variantKey({"B", "A"}),
          "variantKey is order-independent");
    CHECK(ShaderParser::variantKey({}).empty(), "variantKey of no features is empty");

    testFragmentOnly();
    testHandWrittenFrameBlock();
    testWGSLEmission();
    testTextureArrayParam();
    testSystemValuesTrailAttributes();
    testVertexHook();
    testShadowGraft();

    if (g_failures == 0) {
        std::printf("\nALL SHADER-VARIANT TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
