// Native MSVC/CTest harness for Shader (RC5-GfxDevice).
//
// Compiles the CONVERTED Shader.cpp against MockGfxDevice. The fact this links at
// all proves Shader no longer touches GL (it includes no GL headers); the asserts
// confirm it routes create/uniform/reflect/delete through GfxDevice.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/rhi/Shader.hpp"
#include "esengine/renderer/store/LightConstants.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    MockGfxDevice d;

    {
        auto shader = Shader::create(d, "vs", "fs");
        CHECK(shader != nullptr, "Shader::create returns a shader on link success");
        CHECK(d.createProgramCalls == 1, "create routes compile/link through device.createProgram");
        CHECK(shader->isValid(), "shader is valid (programId from device)");
        CHECK(shader->getProgramId() == 1, "programId is the device-returned id");
        CHECK(d.getActiveUniformsCalls == 1, "reflection routes through device.getActiveUniforms");

        // compile() pins the engine-injected samplers to their units, so the counts
        // the rest of this block asserts start from what that seeding left behind.
        CHECK(d.setUniform1iCalls == 1
                  && d.lastUniform1iVal == static_cast<i32>(SHADOW_MAP_TEXTURE_UNIT),
              "compile pins the injected shadow sampler to its texture unit");
        CHECK(d.useProgramCalls == 2, "seeding it binds and unbinds the program");

        shader->setUniform("u_tex", 3);
        CHECK(d.setUniform1iCalls == 2, "setUniform(name,int) routes through device.setUniform1i");
        CHECK(d.lastUniform1iVal == 3, "uniform value forwarded");

        shader->setUniform("u_color", glm::vec4(1, 0, 0, 1));
        CHECK(d.setUniform4fCalls == 1, "setUniform(name,vec4) routes through device.setUniform4f");

        shader->bind();
        CHECK(d.useProgramCalls == 3 && d.lastProgram == ShaderHandle{1}, "bind routes through device.useProgram");
        shader->unbind();
        CHECK(d.useProgramCalls == 4 && d.lastProgram == ShaderHandle::Invalid,
              "unbind routes through device.useProgram(Invalid)");

        // shader destructed at scope end -> device.deleteProgram
    }
    CHECK(d.deleteProgramCalls == 1, "destructor routes through device.deleteProgram");

    // Language capability gate (REARCH_WGSL Phase 1): a source language the
    // backend cannot compile fails fast BEFORE any createProgram call, with a log.
    {
        MockGfxDevice gate;  // wgslSupported = false
        const int callsBefore = gate.createProgramCalls;
        auto rejected = Shader::create(gate, "vs", "fs", GfxShaderLanguage::WGSL);
        CHECK(rejected == nullptr, "unsupported language fails Shader::create");
        CHECK(gate.createProgramCalls == callsBefore, "gate fires before createProgram");

        gate.wgslSupported = true;
        auto accepted = Shader::create(gate, "vs", "fs", GfxShaderLanguage::WGSL);
        CHECK(accepted != nullptr, "capable backend accepts the language");
        CHECK(gate.lastShaderLanguage == GfxShaderLanguage::WGSL,
              "language tag reaches createProgram in the source descriptor");
        CHECK(accepted->language() == GfxShaderLanguage::WGSL, "shader records its source language");
    }

    if (g_failures == 0) {
        std::printf("\nALL SHADER DEVICE TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
