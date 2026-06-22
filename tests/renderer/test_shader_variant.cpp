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

    if (g_failures == 0) {
        std::printf("\nALL SHADER-VARIANT TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
