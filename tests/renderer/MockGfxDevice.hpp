// Shared test double for the renderer GPU abstraction (GfxDevice).
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
    int beginRenderPassCalls = 0;
    int endRenderPassCalls = 0;
    int createProgramCalls = 0;
    int deleteProgramCalls = 0;
    int setUniform1iCalls = 0;
    int setUniform4fCalls = 0;
    int getActiveUniformsCalls = 0;
    int createTextureCalls = 0;
    int createCompressedTextureCalls = 0;
    int importExternalTextureCalls = 0;
    int deleteTextureCalls = 0;
    int updateTextureCalls = 0;
    int setTextureParamsCalls = 0;
    int generateMipmapsCalls = 0;
    int createFramebufferCalls = 0;
    int deleteFramebufferCalls = 0;
    int createBufferCalls = 0;
    int deleteBufferCalls = 0;
    int updateBufferCalls = 0;
    int resizeBufferCalls = 0;
    int setUniformBufferCalls = 0;
    int createVertexLayoutCalls = 0;
    int deleteVertexLayoutCalls = 0;
    int setVertexBufferCalls = 0;
    int setIndexBufferCalls = 0;
    int setPipelineCalls = 0;

    u32 nextTextureId = 100;
    u32 nextBufferId = 200;
    u32 nextFramebufferId = 500;
    u32 nextVertexLayoutId = 800;
    u32 nextPipelineId = 0;

    bool createTextureFails = false;  // toggle to exercise the OOM / lost-context path (-> Invalid)
    bool compressedSupported = true;  // toggle to exercise the RGBA8 fallback path

    // last args
    ShaderHandle lastProgram = ShaderHandle::Invalid;
    VertexLayoutDesc lastVertexLayoutDesc{};
    BufferHandle lastVbo = BufferHandle::Invalid;
    BufferHandle lastIbo = BufferHandle::Invalid;
    RenderPassDesc lastPassDesc{};
    i32 lastUniform1iLoc = -999, lastUniform1iVal = 0;
    BufferDesc lastBufferDesc{};
    bool lastCreateBufferHadData = false;
    TextureDesc lastTextureDesc{};
    bool lastCreateTextureHadPixels = false;
    TextureHandle lastDeletedTexture = TextureHandle::Invalid;
    GfxCompressedFormat lastCompressedFormat = GfxCompressedFormat::ETC2_RGBA8;
    u32 lastCompressedByteLength = 0;
    FramebufferDesc lastFramebufferDesc{};

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

    BufferHandle createBuffer(const BufferDesc& desc, const void* initialData) override {
        ++createBufferCalls;
        lastBufferDesc = desc;
        lastCreateBufferHadData = initialData != nullptr;
        return BufferHandle{nextBufferId++};
    }
    void deleteBuffer(BufferHandle) override { ++deleteBufferCalls; }
    void updateBuffer(BufferHandle, u32, const void*, u32) override { ++updateBufferCalls; }
    void resizeBuffer(BufferHandle, u32, const void*) override { ++resizeBufferCalls; }
    void setUniformBuffer(u32, BufferHandle) override { ++setUniformBufferCalls; }

    VertexLayoutHandle createVertexLayout(const VertexLayoutDesc& desc) override {
        ++createVertexLayoutCalls;
        lastVertexLayoutDesc = desc;
        return VertexLayoutHandle{nextVertexLayoutId++};
    }
    void deleteVertexLayout(VertexLayoutHandle) override { ++deleteVertexLayoutCalls; }
    void setVertexBuffer(u32, BufferHandle buffer, u32) override { ++setVertexBufferCalls; lastVbo = buffer; }
    void setIndexBuffer(BufferHandle buffer) override { ++setIndexBufferCalls; lastIbo = buffer; }

    TextureHandle createTexture(const TextureDesc& desc, const void* pixels) override {
        ++createTextureCalls;
        lastTextureDesc = desc;
        lastCreateTextureHadPixels = pixels != nullptr;
        return createTextureFails ? TextureHandle::Invalid : TextureHandle{nextTextureId++};
    }
    TextureHandle createCompressedTexture(const TextureDesc& desc, GfxCompressedFormat format,
                                          const void*, u32 byteLength) override {
        ++createCompressedTextureCalls;
        lastTextureDesc = desc;
        lastCompressedFormat = format;
        lastCompressedByteLength = byteLength;
        return TextureHandle{nextTextureId++};
    }
    TextureHandle importExternalTexture(u32 nativeId, const TextureDesc& desc) override {
        ++importExternalTextureCalls;
        lastTextureDesc = desc;
        return TextureHandle{nativeId};
    }
    void deleteTexture(TextureHandle texture) override { ++deleteTextureCalls; lastDeletedTexture = texture; }
    void updateTexture(TextureHandle, i32, i32, u32, u32, const void*, bool) override { ++updateTextureCalls; }
    void setTextureParams(TextureHandle, TextureFilter, TextureFilter, TextureWrap, TextureWrap) override {
        ++setTextureParamsCalls;
    }
    void generateMipmaps(TextureHandle) override { ++generateMipmapsCalls; }
    void bindTexture(u32, TextureHandle) override { ++bindTextureCalls; }
    bool supportsCompressedFormat(GfxCompressedFormat) override { return compressedSupported; }

    ShaderHandle createProgram(const char*, const char*, const GfxAttribBinding*, u32,
                               std::string*, GfxShaderStage* stage) override {
        ++createProgramCalls;
        if (stage) *stage = GfxShaderStage::None;
        return ShaderHandle{1};  // pretend link succeeds, program 1
    }
    void deleteProgram(ShaderHandle) override { ++deleteProgramCalls; }
    void useProgram(ShaderHandle program) override { ++useProgramCalls; lastProgram = program; }
    i32 getUniformLocation(ShaderHandle, const char*) override { return 0; }
    i32 getAttribLocation(ShaderHandle, const char*) override { return 0; }
    void setUniform1i(i32 loc, i32 v) override { ++setUniform1iCalls; lastUniform1iLoc = loc; lastUniform1iVal = v; }
    void setUniform1f(i32, f32) override {}
    void setUniform2f(i32, f32, f32) override {}
    void setUniform3f(i32, f32, f32, f32) override {}
    void setUniform4f(i32, f32, f32, f32, f32) override { ++setUniform4fCalls; }
    void setUniformMat3(i32, const f32*) override {}
    void setUniformMat4(i32, const f32*) override {}
    std::vector<GfxUniformInfo> getActiveUniforms(ShaderHandle) override { ++getActiveUniformsCalls; return {}; }

    u32 getUniformBlockIndex(ShaderHandle, const char*) override { return GFX_INVALID_UNIFORM_BLOCK; }
    void uniformBlockBinding(ShaderHandle, u32, u32) override {}

    PipelineHandle createPipeline(const PipelineDesc&) override { return static_cast<PipelineHandle>(++nextPipelineId); }
    void setPipeline(PipelineHandle) override { ++setPipelineCalls; }
    void setStencilReference(i32) override {}
    void invalidatePipelineCache() override {}

    void drawElements(u32, GfxDataType, u32) override {}
    void drawArrays(u32, u32) override {}
    void drawElementsInstanced(u32, GfxDataType, u32, u32) override {}

    FramebufferHandle createFramebuffer(const FramebufferDesc& desc) override {
        ++createFramebufferCalls;
        lastFramebufferDesc = desc;
        return FramebufferHandle{nextFramebufferId++};
    }
    void deleteFramebuffer(FramebufferHandle) override { ++deleteFramebufferCalls; }
    void beginRenderPass(const RenderPassDesc& desc) override { ++beginRenderPassCalls; lastPassDesc = desc; }
    void endRenderPass() override { ++endRenderPassCalls; }

    void readPixels(i32, i32, u32, u32, GfxPixelFormat, void*) override {}

    u32 createTimerQuery() override { return 0; }  // report "no GPU timing" like a bare backend
    void beginTimerQuery(u32) override {}
    void endTimerQuery() override {}
    bool timerDisjoint() override { return false; }
    bool getTimerQueryNs(u32, u64*) override { return false; }

    void setWireframe(bool) override {}
    u32 getError() override { return 0; }
    std::string getString(GfxStringName) override { return {}; }
    i32 getInt(GfxIntParam) override { return 16; }
};

}  // namespace esengine
