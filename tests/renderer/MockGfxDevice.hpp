// Shared test double for the renderer GPU abstraction (RC5-GfxDevice).
//
// Records the device calls the renderer harnesses assert on; every other method
// is a no-op stub. Implementing the full GfxDevice contract here also proves the
// interface stays self-consistent as it evolves.
#pragma once

#include "esengine/renderer/GfxDevice.hpp"

#include <vector>

namespace esengine {

struct MockGfxDevice final : GfxDevice {
    // call counters
    int useProgramCalls = 0;
    int bindTextureCalls = 0;
    int bindVertexArrayCalls = 0;
    int bindVertexBufferCalls = 0;
    int bindIndexBufferCalls = 0;
    int bindFramebufferCalls = 0;
    int createProgramCalls = 0;
    int deleteProgramCalls = 0;
    int setUniform1iCalls = 0;
    int setUniform4fCalls = 0;
    int getActiveUniformsCalls = 0;
    int createTextureCalls = 0;
    int deleteTextureCalls = 0;
    int texImage2DCalls = 0;
    int texSubImage2DCalls = 0;
    int setTextureParamsCalls = 0;
    int generateMipmapsCalls = 0;
    u32 nextTextureId = 100;
    u32 lastDeletedTexture = 0;
    int createFramebufferCalls = 0;
    int deleteFramebufferCalls = 0;
    int framebufferTexture2DCalls = 0;
    u32 nextFramebufferId = 500;
    // last args
    u32 lastProgram = 0, lastVao = 0, lastVbo = 0, lastIbo = 0, lastFbo = 0;
    i32 lastUniform1iLoc = -999, lastUniform1iVal = 0;

    void init() override {}
    void shutdown() override {}

    void setViewport(i32, i32, u32, u32) override {}
    void setClearColor(f32, f32, f32, f32) override {}
    void setClearStencil(i32) override {}
    void clear(bool, bool, bool) override {}

    void setBlendEnabled(bool) override {}
    void setBlendMode(BlendMode) override {}

    void setDepthTest(bool) override {}
    void setDepthWrite(bool) override {}

    void setStencilTest(bool) override {}
    void setStencilFunc(GfxStencilFunc, i32, u32) override {}
    void setStencilOp(GfxStencilOp, GfxStencilOp, GfxStencilOp) override {}
    void setStencilMask(u32) override {}
    void setColorMask(bool, bool, bool, bool) override {}

    void setScissorTest(bool) override {}
    void setScissor(i32, i32, i32, i32) override {}

    void setCulling(bool) override {}
    void setCullFace(bool) override {}

    void bindTexture(u32, u32 textureId) override { ++bindTextureCalls; (void)textureId; }

    u32 createProgram(const char*, const char*, const GfxAttribBinding*, u32,
                      std::string*, GfxShaderStage* stage) override {
        ++createProgramCalls;
        if (stage) *stage = GfxShaderStage::None;
        return 1;  // pretend link succeeds, program id 1
    }
    void deleteProgram(u32) override { ++deleteProgramCalls; }
    void useProgram(u32 programId) override { ++useProgramCalls; lastProgram = programId; }
    i32 getUniformLocation(u32, const char*) override { return 0; }
    i32 getAttribLocation(u32, const char*) override { return 0; }
    void setUniform1i(i32 loc, i32 v) override { ++setUniform1iCalls; lastUniform1iLoc = loc; lastUniform1iVal = v; }
    void setUniform1f(i32, f32) override {}
    void setUniform2f(i32, f32, f32) override {}
    void setUniform3f(i32, f32, f32, f32) override {}
    void setUniform4f(i32, f32, f32, f32, f32) override { ++setUniform4fCalls; }
    void setUniformMat3(i32, const f32*) override {}
    void setUniformMat4(i32, const f32*) override {}
    std::vector<GfxUniformInfo> getActiveUniforms(u32) override { ++getActiveUniformsCalls; return {}; }

    u32 createBuffer() override { return 0; }
    void deleteBuffer(u32) override {}
    void bindVertexBuffer(u32 bufferId) override { ++bindVertexBufferCalls; lastVbo = bufferId; }
    void bindIndexBuffer(u32 bufferId) override { ++bindIndexBufferCalls; lastIbo = bufferId; }
    void bufferData(GfxBufferTarget, const void*, u32, bool) override {}
    void bufferSubData(GfxBufferTarget, u32, const void*, u32) override {}

    u32 createVertexArray() override { return 0; }
    void deleteVertexArray(u32) override {}
    void bindVertexArray(u32 vaoId) override { ++bindVertexArrayCalls; lastVao = vaoId; }
    void enableVertexAttrib(u32) override {}
    void vertexAttribPointer(u32, i32, GfxDataType, bool, i32, u32) override {}
    void vertexAttribDivisor(u32, u32) override {}

    void drawElements(u32, GfxDataType, u32) override {}
    void drawArrays(u32, u32) override {}
    void drawElementsInstanced(u32, GfxDataType, u32, u32) override {}

    u32 createTexture() override { ++createTextureCalls; return nextTextureId++; }
    void deleteTexture(u32 id) override { ++deleteTextureCalls; lastDeletedTexture = id; }
    void texImage2D(u32, u32, u32, GfxPixelFormat, const void*) override { ++texImage2DCalls; }
    void texSubImage2D(u32, i32, i32, u32, u32, GfxPixelFormat, const void*) override { ++texSubImage2DCalls; }
    void setTextureParams(u32, TextureFilter, TextureFilter, TextureWrap, TextureWrap) override { ++setTextureParamsCalls; }
    void generateMipmaps(u32) override { ++generateMipmapsCalls; }
    void pixelStorei(u32, i32) override {}
    void setUnpackFlipY(bool) override {}

    u32 createFramebuffer() override { ++createFramebufferCalls; return nextFramebufferId++; }
    void deleteFramebuffer(u32) override { ++deleteFramebufferCalls; }
    void bindFramebuffer(u32 fboId) override { ++bindFramebufferCalls; lastFbo = fboId; }
    void framebufferTexture2D(u32, GfxAttachment, u32) override { ++framebufferTexture2DCalls; }
    bool checkFramebufferStatus() override { return true; }

    void readPixels(i32, i32, u32, u32, GfxPixelFormat, void*) override {}

    void setWireframe(bool) override {}
    u32 getError() override { return 0; }
};

}  // namespace esengine
