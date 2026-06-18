// Native MSVC/CTest harness for Shader (RC5-GfxDevice).
//
// Compiles the CONVERTED Shader.cpp against MockGfxDevice. The fact this links at
// all proves Shader no longer touches GL (it includes no GL headers); the asserts
// confirm it routes create/uniform/reflect/delete through GfxDevice.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/Shader.hpp"

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

        shader->setUniform("u_tex", 3);
        CHECK(d.setUniform1iCalls == 1, "setUniform(name,int) routes through device.setUniform1i");
        CHECK(d.lastUniform1iVal == 3, "uniform value forwarded");

        shader->setUniform("u_color", glm::vec4(1, 0, 0, 1));
        CHECK(d.setUniform4fCalls == 1, "setUniform(name,vec4) routes through device.setUniform4f");

        shader->bind();
        CHECK(d.useProgramCalls == 1 && d.lastProgram == 1, "bind routes through device.useProgram");
        shader->unbind();
        CHECK(d.useProgramCalls == 2 && d.lastProgram == 0, "unbind routes through device.useProgram(0)");

        // shader destructed at scope end -> device.deleteProgram
    }
    CHECK(d.deleteProgramCalls == 1, "destructor routes through device.deleteProgram");

    if (g_failures == 0) {
        std::printf("\nALL SHADER DEVICE TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
