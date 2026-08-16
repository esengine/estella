// Native harness for the shader variant (feature-permutation) system (RC7-6).
//
// Compiles ShaderParser.cpp directly — no GL/engine link, so it runs on any C++20
// toolchain — and asserts the compile-time variant mechanism: #pragma feature is
// captured, requested features are injected as #define right after #version (so the
// shader body can #ifdef them), and variantKey is an order-independent cache key.

#include "esengine/resource/ShaderParser.hpp"

#include <algorithm>
#include <cstdio>
#include <string>

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
#pragma domain Unlit2D

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
#pragma domain Lit2D

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
#pragma domain Unlit2D
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
#pragma domain Lit2D

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
#ifndef LIT
    return vec4f(1.0);
#else
    return vec4f(0.5);
#endif
}
#pragma end
)";

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
    CHECK(vs.find("v_worldPos") == std::string::npos, "Unlit2D WGSL vertex has no world-pos varying");

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
    CHECK(fs.find("LightConstants") == std::string::npos, "Unlit2D gets no lighting injection");

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
          "Lit2D canonical WGSL vertex forwards world position");
    const std::string litFs = wgsl(lit, ShaderStage::Fragment);
    CHECK(litFs.find("@location(2) v_worldPos : vec2f,") != std::string::npos,
          "Lit2D VSOut carries the world-pos varying");
    CHECK(litFs.find("fn applyLighting2D") != std::string::npos &&
          litFs.find("@group(0) @binding(2) var<uniform> lc : LightConstants;") != std::string::npos &&
          litFs.find("array<Light2D, 16>") != std::string::npos,
          "Lit2D WGSL injection: LightConstants at binding 2 + lighting helpers");

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
        "#pragma shader \"Full\"\n#pragma domain Unlit2D\n"
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
        "#pragma shader \"Mixed\"\n#pragma domain Unlit2D\n"
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
        "#pragma shader \"L\"\n#pragma domain Unlit2D\n"
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
    CHECK(unlit.valid, "fragment-only Unlit2D shader parses");
    const std::string uv = ShaderParser::assembleStage(unlit, ShaderStage::Vertex);
    CHECK(uv.find("a_position") != std::string::npos, "canonical vertex stage injected");
    CHECK(uv.find("FrameConstants") != std::string::npos, "canonical vertex reads the FrameConstants UBO");
    CHECK(uv.find("v_worldPos") == std::string::npos, "Unlit2D canonical vertex has no world-pos varying");

    ParsedShader lit = ShaderParser::parse(FRAG_ONLY_LIT);
    CHECK(lit.valid, "fragment-only Lit2D shader parses");
    const std::string lv = ShaderParser::assembleStage(lit, ShaderStage::Vertex);
    CHECK(lv.find("v_worldPos = world.xy;") != std::string::npos,
          "Lit2D canonical vertex forwards world position");
    const std::string lf = ShaderParser::assembleStage(lit, ShaderStage::Fragment);
    CHECK(lf.find("applyLighting2D") != std::string::npos, "Lit2D fragment gets the lighting helper injected");

    ParsedShader pp = ShaderParser::parse(FRAG_ONLY_POSTPROCESS);
    CHECK(pp.valid, "fragment-only PostProcess shader parses");
    const std::string ppv = ShaderParser::assembleStage(pp, ShaderStage::Vertex);
    CHECK(ppv.find("gl_Position = vec4(a_position, 0.0, 1.0);") != std::string::npos &&
          ppv.find("u_projection *") == std::string::npos,
          "PostProcess canonical vertex is the clip-space pass-through (no projection)");

    ParsedShader unknownDomain = ShaderParser::parse(FRAG_ONLY_UNKNOWN_DOMAIN);
    CHECK(!unknownDomain.valid, "a domain with no canonical vertex still errors");

    ParsedShader authored = ShaderParser::parse(SRC);
    const std::string av = ShaderParser::assembleStage(authored, ShaderStage::Vertex);
    CHECK(av.find("a_pos") != std::string::npos, "an authored vertex stage is untouched");

    const std::string af = ShaderParser::assembleStage(authored, ShaderStage::Fragment);
    CHECK(av.find("uniform TimeConstants") != std::string::npos &&
          af.find("uniform TimeConstants") != std::string::npos,
          "u_time clock block injected into both stages");
    CHECK(af.find("vec4 u_viewport") != std::string::npos, "u_viewport rides the injected block");

    ParsedShader reserved = ShaderParser::parse(
        "#pragma shader \"R\"\n#pragma version 300 es\n#pragma domain Unlit2D\n"
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

    if (g_failures == 0) {
        std::printf("\nALL SHADER-VARIANT TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
