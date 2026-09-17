// Shared test double for the renderer GPU abstraction (GfxDevice).
//
// Records the device calls the renderer harnesses assert on; every other method
// is a no-op stub. Implementing the full GfxDevice contract here also proves the
// interface stays self-consistent as it evolves.
#pragma once

#include "esengine/renderer/rhi/GfxDevice.hpp"

#include <cstring>
#include <vector>

namespace esengine {

struct MockGfxDevice final : GfxDevice {
    // Device-loss entry points a backend calls on itself. Protected on GfxDevice,
    // so a harness driving the state machine needs them republished here.
    using GfxDevice::markDeviceLost;
    using GfxDevice::setDeviceIdentity;

    // Which clip volume this stand-in keeps; settable so one harness can drive
    // both conventions rather than only the one the host happens to run.
    ClipDepthRange clipRange = ClipDepthRange::MinusOneToOne;

    // Stands in for a backend that can (or cannot) get its device back.
    bool recreateSucceeds = true;
    int recreateCalls = 0;
    int identityCaptures = 0;
    bool recreateDevice() override { ++recreateCalls; return recreateSucceeds; }
    void captureDeviceIdentity() override { ++identityCaptures; }

    // call counters
    // The render state a draw resolved to, as the pipeline saw it.
    PipelineDesc lastPipelineDesc{};
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
    // Ordered call logs, for harnesses asserting on a SEQUENCE rather than a
    // count: which target each pass opened, and what was bound where.
    struct Viewport { i32 x, y; u32 w, h; };
    std::vector<RenderPassDesc> passLog;
    std::vector<std::pair<u32, TextureHandle>> bindLog;
    std::vector<Viewport> viewportLog;
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
    // How many times the frame was declared over. A backend that borrows the
    // swapchain image gives it back here, so a frame that says so twice releases
    // an image it no longer holds — invisible on the GL backends, which stub this.
    int endFrameCalls = 0;
    void endFrame() override { ++endFrameCalls; }

    int requestReadbackCalls = 0;
    int takeReadbackCalls = 0;
    int discardReadbackCalls = 0;

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
    std::vector<u8> lastCreateBufferBytes;
    TextureDesc lastTextureDesc{};
    bool lastCreateTextureHadPixels = false;
    std::vector<u8> lastCreateTextureBytes;
    /// What a program's block index lookup answers; GL-shaped by default "absent".
    u32 blockIndexAnswer = GFX_INVALID_UNIFORM_BLOCK;
    std::vector<std::pair<u32, u32>> blockBindingLog;
    TextureHandle lastDeletedTexture = TextureHandle::Invalid;
    GfxCompressedFormat lastCompressedFormat = GfxCompressedFormat::ETC2_RGBA8;
    u32 lastCompressedByteLength = 0;
    u32 lastCompressedMipLevels = 0;
    FramebufferDesc lastFramebufferDesc{};
    u32 lastDrawIndexCount = 0;
    u32 lastDrawIndexByteOffset = 0;
    u32 lastDrawInstanceCount = 0;

    ClipDepthRange clipDepthRange() const override { return clipRange; }

    void init() override {}
    void shutdown() override {}

    void setViewport(i32 x, i32 y, u32 w, u32 h) override { viewportLog.push_back({x, y, w, h}); }
    void clearStencil(i32) override {}

    void setScissorTest(bool) override {}
    void setScissor(i32, i32, i32, i32) override {}

    /** Set false to make allocation fail, the way a GPU out of memory does — the
     *  path a caller's "leaves it as it found it" promise is only true along. */
    bool createBufferSucceeds = true;

    void setUniformBuffer(u32 slot, BufferHandle buffer) override {
        ++setUniformBufferCalls;
        lastUniformBufferSlot = slot;
        lastUniformBuffer = buffer;
    }
    void setVertexBuffer(u32, BufferHandle buffer, u32) override { ++setVertexBufferCalls; lastVbo = buffer; }
    void setIndexBuffer(BufferHandle buffer) override { ++setIndexBufferCalls; lastIbo = buffer; }

    void bindTexture(u32 unit, TextureHandle texture) override {
        ++bindTextureCalls;
        bindLog.push_back({unit, texture});
    }
    bool supportsCompressedFormat(GfxCompressedFormat) override { return compressedSupported; }
    bool supportsFloatTargets() override { return true; }
    // No multisampling: these tests exercise the device seam, not a resolve.
    u32 maxSamples() override { return 1; }

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::GLSL_ES300 || (wgslSupported && language == GfxShaderLanguage::WGSL);
    }

    /// Answers as GL does; a test that cares sets it.
    bool originTopLeft = false;
    bool textureOriginTopLeft() const override { return originTopLeft; }
    void setStencilReference(i32) override {}

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

    void beginRenderPass(const RenderPassDesc& desc) override {
        ++beginRenderPassCalls;
        lastPassDesc = desc;
        passLog.push_back(desc);
    }
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

    void beginTimerQuery(u32) override {}
    void endTimerQuery() override {}
    bool timerDisjoint() override { return false; }
    bool getTimerQueryNs(u32, u64*) override { return false; }

    void setWireframe(bool) override {}
    u32 getError() override { return 0; }
    std::string getString(GfxStringName) override { return {}; }
    i32 getInt(GfxIntParam) override { return 16; }

protected:
    bool backendCreateBuffer(u32, const BufferDesc& desc, const void* data) override {
        ++createBufferCalls;
        lastBufferDesc = desc;
        lastCreateBufferHadData = data != nullptr;
        if (data) {
            lastCreateBufferBytes.assign(static_cast<const u8*>(data), static_cast<const u8*>(data) + desc.size);
        } else {
            lastCreateBufferBytes.clear();
        }
        return createBufferSucceeds;
    }
    void backendDeleteBuffer(u32) override { ++deleteBufferCalls; }
    void backendUpdateBuffer(u32, u32, const void* data, u32 sizeBytes) override {
        ++updateBufferCalls;
        lastUpdateData.assign(static_cast<const u8*>(data), static_cast<const u8*>(data) + sizeBytes);
    }
    void backendResizeBuffer(u32, const BufferDesc&, const void*) override { ++resizeBufferCalls; }

    bool backendCreateTexture(u32, const TextureDesc& desc, const void* pixels) override {
        ++createTextureCalls;
        lastTextureDesc = desc;
        lastCreateTextureHadPixels = pixels != nullptr;
        if (pixels) {
            const usize bytes = static_cast<usize>(desc.width) * desc.height * gfxBytesPerPixel(desc.format);
            lastCreateTextureBytes.assign(static_cast<const u8*>(pixels), static_cast<const u8*>(pixels) + bytes);
        } else {
            lastCreateTextureBytes.clear();
        }
        return !createTextureFails;
    }
    bool backendCreateCompressedTexture(u32, const TextureDesc& desc, GfxCompressedFormat format,
                                        const void*, u32 byteLength, u32 mipLevels) override {
        ++createCompressedTextureCalls;
        lastTextureDesc = desc;
        lastCompressedFormat = format;
        lastCompressedByteLength = byteLength;
        lastCompressedMipLevels = mipLevels;
        return true;
    }
    bool backendAdoptTexture(u32, u32 nativeId, const TextureDesc& desc) override {
        ++importExternalTextureCalls;
        lastTextureDesc = desc;
        return nativeId != 0;
    }
    void backendDeleteTexture(u32 id) override { ++deleteTextureCalls; lastDeletedTexture = TextureHandle{id}; }
    void backendMoveTexture(u32, u32) override {}
    void backendUpdateTexture(u32, i32, i32, u32, u32, const void*, bool) override { ++updateTextureCalls; }
    void backendSetTextureParams(u32, const TextureDesc&) override { ++setTextureParamsCalls; }
    void backendGenerateMipmaps(u32) override { ++generateMipmapsCalls; }

    bool backendCreateProgram(u32, const GfxShaderSource& source, const GfxAttribBinding*, u32,
                              std::string*, GfxShaderStage* stage) override {
        ++createProgramCalls;
        lastShaderLanguage = source.language;
        if (stage) *stage = GfxShaderStage::None;
        return true;
    }
    void backendDeleteProgram(u32) override { ++deleteProgramCalls; }
    void backendUseProgram(u32 id) override { ++useProgramCalls; lastProgram = ShaderHandle{id}; }
    i32 backendUniformLocation(u32, const char*) override { return 0; }
    i32 backendAttribLocation(u32, const char*) override { return 0; }
    void backendSetUniform(i32 location, const GfxUniformValue& value) override {
        switch (value.type) {
        case GfxUniformValue::Type::Int:
            ++setUniform1iCalls;
            lastUniform1iLoc = location;
            lastUniform1iVal = value.i;
            break;
        case GfxUniformValue::Type::Float: ++setUniform1fCalls; break;
        case GfxUniformValue::Type::Vec4: ++setUniform4fCalls; break;
        default: break;
        }
    }
    std::vector<GfxUniformInfo> backendActiveUniforms(u32) override { ++getActiveUniformsCalls; return {}; }
    u32 backendUniformBlockIndex(u32, const char*) override { return blockIndexAnswer; }
    void backendUniformBlockBinding(u32, u32 block, u32 binding) override {
        blockBindingLog.push_back({block, binding});
    }

    bool backendAcceptsVertexLayout(const VertexLayoutDesc& desc) override {
        ++createVertexLayoutCalls;
        lastVertexLayoutDesc = desc;
        return true;
    }
    void backendDeleteVertexLayout(u32) override { ++deleteVertexLayoutCalls; }
    void backendSetPipeline(u32, const PipelineDesc& desc) override {
        ++setPipelineCalls;
        lastPipelineDesc = desc;
    }
    void backendInvalidatePipelineCache() override {}

    bool backendCreateFramebuffer(u32, const FramebufferDesc& desc) override {
        ++createFramebufferCalls;
        lastFramebufferDesc = desc;
        return true;
    }
    void backendDeleteFramebuffer(u32) override { ++deleteFramebufferCalls; }

    // No GPU timing, like a bare backend.
    bool backendCreateTimerQuery(u32) override { return false; }
    u32 backendReadbackCount() const override { return 0; }
};

}  // namespace esengine
