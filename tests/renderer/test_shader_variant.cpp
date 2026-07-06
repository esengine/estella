// Native harness for the shader variant (feature-permutation) system (RC7-6).
//
// Compiles ShaderParser.cpp directly — no GL/engine link, so it runs on any C++20
// toolchain — and asserts the compile-time variant mechanism: #pragma feature is
// captured, requested features are injected as #define right after #version (so the
// shader body can #ifdef them), and variantKey is an order-independent cache key.

#include "esengine/resource/ShaderParser.hpp"

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
void main() { fragColor = vec4(es_applyLighting2D(v_color.rgb, vec3(0.0, 0.0, 1.0), v_worldPos), v_color.a); }
#pragma end
)";

static const char* FRAG_ONLY_POSTPROCESS = R"(#pragma shader "NoCanonical"
#pragma version 300 es
#pragma domain PostProcess

#pragma fragment
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
#pragma end
)";

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
    CHECK(lv.find("v_worldPos = a_position") != std::string::npos, "Lit2D canonical vertex forwards world position");
    const std::string lf = ShaderParser::assembleStage(lit, ShaderStage::Fragment);
    CHECK(lf.find("es_applyLighting2D") != std::string::npos, "Lit2D fragment gets the lighting helper injected");

    ParsedShader pp = ShaderParser::parse(FRAG_ONLY_POSTPROCESS);
    CHECK(!pp.valid, "non-2D domain without a vertex stage still errors");

    ParsedShader authored = ShaderParser::parse(SRC);
    const std::string av = ShaderParser::assembleStage(authored, ShaderStage::Vertex);
    CHECK(av.find("a_pos") != std::string::npos, "an authored vertex stage is untouched");
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

    if (g_failures == 0) {
        std::printf("\nALL SHADER-VARIANT TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
