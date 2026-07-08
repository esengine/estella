// Shared test double for the renderer GPU abstraction (GfxDevice).
//
// Records the device calls the renderer harnesses assert on; every other method
// is a no-op stub. Implementing the full GfxDevice contract here also proves the
// interface stays self-consistent as it evolves.
#pragma once

#include "esengine/renderer/GfxDevice.hpp"

#include <cstring>
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
    int setUniform1fCalls = 0;
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
    int drawElementsCalls = 0;
    int drawElementsInstancedCalls = 0;
    int requestReadbackCalls = 0;
    int takeReadbackCalls = 0;
    int discardReadbackCalls = 0;

    u32 nextTextureId = 100;
    u32 nextBufferId = 200;
    u32 nextFramebufferId = 500;
    u32 nextVertexLayoutId = 800;
    u32 nextPipelineId = 0;
    u32 nextReadbackId = 900;

    FramebufferHandle lastReadbackTarget = FramebufferHandle::Default;
    u32 lastReadbackW = 0;
    u32 lastReadbackH = 0;

    bool createTextureFails = false;  // toggle to exercise the OOM / lost-context path (-> Invalid)
    bool compressedSupported = true;  // toggle to exercise the RGBA8 fallback path
    bool wgslSupported = false;       // toggle to exercise the language capability gate
    GfxShaderLanguage lastShaderLanguage = GfxShaderLanguage::GLSL_ES300;

    // last args
    ShaderHandle lastProgram = ShaderHandle::Invalid;
    VertexLayoutDesc lastVertexLayoutDesc{};
    BufferHandle lastVbo = BufferHandle::Invalid;
    BufferHandle lastIbo = BufferHandle::Invalid;
    RenderPassDesc lastPassDesc{};
    i32 lastUniform1iLoc = -999, lastUniform1iVal = 0;
    u32 lastUniformBufferSlot = 0xFFFFFFFFu;
    BufferHandle lastUniformBuffer = BufferHandle::Invalid;
    std::vector<u8> lastUpdateData;
    BufferDesc lastBufferDesc{};
    bool lastCreateBufferHadData = false;
    TextureDesc lastTextureDesc{};
    bool lastCreateTextureHadPixels = false;
    TextureHandle lastDeletedTexture = TextureHandle::Invalid;
    GfxCompressedFormat lastCompressedFormat = GfxCompressedFormat::ETC2_RGBA8;
    u32 lastCompressedByteLength = 0;
    FramebufferDesc lastFramebufferDesc{};
    u32 lastDrawIndexCount = 0;
    u32 lastDrawIndexByteOffset = 0;
    u32 lastDrawInstanceCount = 0;

    void init() override {}
    void shutdown() override {}

    void setViewport(i32, i32, u32, u32) override {}
    void clearStencil(i32) override {}

    void setScissorTest(bool) override {}
    void setScissor(i32, i32, i32, i32) override {}

    BufferHandle createBuffer(const BufferDesc& desc, const void* initialData) override {
        ++createBufferCalls;
        lastBufferDesc = desc;
        lastCreateBufferHadData = initialData != nullptr;
        return BufferHandle{nextBufferId++};
    }
    void deleteBuffer(BufferHandle) override { ++deleteBufferCalls; }
    void updateBuffer(BufferHandle, u32, const void* data, u32 sizeBytes) override {
        ++updateBufferCalls;
        lastUpdateData.assign(static_cast<const u8*>(data), static_cast<const u8*>(data) + sizeBytes);
    }
    void resizeBuffer(BufferHandle, u32, const void*) override { ++resizeBufferCalls; }
    void setUniformBuffer(u32 slot, BufferHandle buffer) override {
        ++setUniformBufferCalls;
        lastUniformBufferSlot = slot;
        lastUniformBuffer = buffer;
    }

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

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::GLSL_ES300 || (wgslSupported && language == GfxShaderLanguage::WGSL);
    }
    ShaderHandle createProgram(const GfxShaderSource& source, const GfxAttribBinding*, u32,
                               std::string*, GfxShaderStage* stage) override {
        ++createProgramCalls;
        lastShaderLanguage = source.language;
        if (stage) *stage = GfxShaderStage::None;
        return ShaderHandle{1};  // pretend link succeeds, program 1
    }
    void deleteProgram(ShaderHandle) override { ++deleteProgramCalls; }
    void useProgram(ShaderHandle program) override { ++useProgramCalls; lastProgram = program; }
    i32 getUniformLocation(ShaderHandle, const char*) override { return 0; }
    i32 getAttribLocation(ShaderHandle, const char*) override { return 0; }
    void setUniform1i(i32 loc, i32 v) override { ++setUniform1iCalls; lastUniform1iLoc = loc; lastUniform1iVal = v; }
    void setUniform1f(i32, f32) override { ++setUniform1fCalls; }
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

    void drawElements(u32 indexCount, GfxDataType, u32 byteOffset) override {
        ++drawElementsCalls;
        lastDrawIndexCount = indexCount;
        lastDrawIndexByteOffset = byteOffset;
    }
    void drawArrays(u32, u32) override {}
    void drawElementsInstanced(u32 indexCount, GfxDataType, u32, u32 instanceCount) override {
        ++drawElementsInstancedCalls;
        lastDrawIndexCount = indexCount;
        lastDrawInstanceCount = instanceCount;
    }

    FramebufferHandle createFramebuffer(const FramebufferDesc& desc) override {
        ++createFramebufferCalls;
        lastFramebufferDesc = desc;
        return FramebufferHandle{nextFramebufferId++};
    }
    void deleteFramebuffer(FramebufferHandle) override { ++deleteFramebufferCalls; }
    void beginRenderPass(const RenderPassDesc& desc) override { ++beginRenderPassCalls; lastPassDesc = desc; }
    void endRenderPass() override { ++endRenderPassCalls; }

    // Async readback seam: every request is immediately Ready (the GL shape);
    // takeReadback fills a fixed pattern so callers can assert data flow.
    ReadbackHandle requestReadback(FramebufferHandle target, u32 w, u32 h) override {
        ++requestReadbackCalls;
        lastReadbackTarget = target;
        lastReadbackW = w;
        lastReadbackH = h;
        return static_cast<ReadbackHandle>(nextReadbackId++);
    }
    GfxReadbackStatus pollReadback(ReadbackHandle) override { return GfxReadbackStatus::Ready; }
    bool takeReadback(ReadbackHandle, void* dest, usize destSize) override {
        ++takeReadbackCalls;
        std::memset(dest, 0x42, destSize);
        return true;
    }
    void discardReadback(ReadbackHandle) override { ++discardReadbackCalls; }

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
