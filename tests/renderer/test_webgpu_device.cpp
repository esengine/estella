// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// WebGPU backend slice 1 (REARCH_WGSL Phase 2): the pure enum→WGPU mapping layer
// and the null-device-safe WebGPUDevice skeleton, compiled against the REAL Dawn
// C headers (emdawnwebgpu port) so every descriptor spelling is checked by the
// compiler long before a live adapter exists.
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include "esengine/renderer/webgpu/WebGPUMappings.hpp"

#include <string>

using namespace esengine;
using namespace esengine::webgpu;

TEST_CASE("blend table mirrors the GL backend's semantics") {
    auto normal = toWGPUBlend(BlendMode::Normal);
    CHECK(normal.color.srcFactor == WGPUBlendFactor_SrcAlpha);
    CHECK(normal.color.dstFactor == WGPUBlendFactor_OneMinusSrcAlpha);

    auto additive = toWGPUBlend(BlendMode::Additive);
    CHECK(additive.color.dstFactor == WGPUBlendFactor_One);

    auto lighten = toWGPUBlend(BlendMode::Lighten);
    CHECK(lighten.color.operation == WGPUBlendOperation_Max);
    auto darken = toWGPUBlend(BlendMode::Darken);
    CHECK(darken.color.operation == WGPUBlendOperation_Min);

    // Overlay has no fixed-function form — renders as Normal, like GLDevice.
    auto overlay = toWGPUBlend(BlendMode::Overlay);
    CHECK(overlay.color.srcFactor == WGPUBlendFactor_SrcAlpha);
}

TEST_CASE("vertex formats cover every attribute the engine's streams declare") {
    // Batch: f32x2 pos, unorm8x4 color, f32x2 uv, f32 texIndex.
    CHECK(toWGPUVertexFormat(2, GfxDataType::Float, false) == WGPUVertexFormat_Float32x2);
    CHECK(toWGPUVertexFormat(4, GfxDataType::UnsignedByte, true) == WGPUVertexFormat_Unorm8x4);
    CHECK(toWGPUVertexFormat(1, GfxDataType::Float, false) == WGPUVertexFormat_Float32);
    // Shape: f32x4 ×2. Particle instance: f32x2/f32/unorm8x4 mix — all covered above.
    CHECK(toWGPUVertexFormat(4, GfxDataType::Float, false) == WGPUVertexFormat_Float32x4);
    // A combination no engine stream produces must map to Undefined (hard error).
    CHECK(toWGPUVertexFormat(3, GfxDataType::UnsignedByte, true) == kInvalidVertexFormat);
}

TEST_CASE("index, texture, sampler, and buffer mappings") {
    CHECK(toWGPUIndexFormat(GfxDataType::UnsignedInt) == WGPUIndexFormat_Uint32);
    CHECK(toWGPUIndexFormat(GfxDataType::UnsignedShort) == WGPUIndexFormat_Uint16);
    CHECK(toWGPUIndexFormat(GfxDataType::Float) == WGPUIndexFormat_Undefined);

    CHECK(toWGPUTextureFormat(GfxPixelFormat::RGBA8) == WGPUTextureFormat_RGBA8Unorm);
    CHECK(toWGPUTextureFormat(GfxPixelFormat::Depth24Stencil8) == WGPUTextureFormat_Depth24PlusStencil8);
    CHECK(toWGPUCompressedFormat(GfxCompressedFormat::ETC2_RGBA8) == WGPUTextureFormat_ETC2RGBA8Unorm);

    CHECK(toWGPUAddressMode(TextureWrap::ClampToEdge) == WGPUAddressMode_ClampToEdge);
    CHECK(toWGPUFilter(TextureFilter::Nearest) == WGPUFilterMode_Nearest);

    CHECK((toWGPUBufferUsage(GfxBufferUsage::Uniform) & WGPUBufferUsage_Uniform) != 0);
    CHECK((toWGPUBufferUsage(GfxBufferUsage::Index) & WGPUBufferUsage_CopyDst) != 0);
}

TEST_CASE("stencil modes translate to the same table GLDevice applies") {
    auto write = toWGPUStencilFace(GfxStencilMode::Write);
    CHECK(write.compare == WGPUCompareFunction_Always);
    CHECK(write.passOp == WGPUStencilOperation_Replace);

    auto test = toWGPUStencilFace(GfxStencilMode::Test);
    CHECK(test.compare == WGPUCompareFunction_Equal);
    CHECK(test.passOp == WGPUStencilOperation_Keep);

    // The applyStencilMode mask table: Write fills, Test reads only.
    CHECK(toWGPUStencilWriteMask(GfxStencilMode::Write) == 0xFFu);
    CHECK(toWGPUStencilWriteMask(GfxStencilMode::Test) == 0x00u);
    CHECK(toWGPUStencilWriteMask(GfxStencilMode::Off) == 0x00u);
}

TEST_CASE("pipeline depth-stencil state carries GL semantics exactly") {
    // GL: a disabled depth test neither compares nor writes — even when the
    // pipeline asks for depth writes (glDepthMask is inert without the test).
    PipelineDesc off{};
    off.depthTest = false;
    off.depthWrite = true;
    auto dsOff = toWGPUDepthStencil(off, WGPUTextureFormat_Depth24PlusStencil8);
    CHECK(dsOff.format == WGPUTextureFormat_Depth24PlusStencil8);
    CHECK(dsOff.depthCompare == WGPUCompareFunction_Always);
    CHECK(dsOff.depthWriteEnabled == WGPUOptionalBool_False);

    // GL never calls glDepthFunc, so an enabled test compares with the default Less.
    PipelineDesc on{};
    on.depthTest = true;
    on.depthWrite = true;
    on.stencil = GfxStencilMode::Write;
    auto dsOn = toWGPUDepthStencil(on, WGPUTextureFormat_Depth24Plus);
    CHECK(dsOn.depthCompare == WGPUCompareFunction_Less);
    CHECK(dsOn.depthWriteEnabled == WGPUOptionalBool_True);
    CHECK(dsOn.stencilFront.passOp == WGPUStencilOperation_Replace);
    CHECK(dsOn.stencilBack.passOp == WGPUStencilOperation_Replace);
    CHECK(dsOn.stencilWriteMask == 0xFFu);

    // Stencil-plane detection drives whether a pass may spell stencil load-ops.
    CHECK(hasStencilPlanes(WGPUTextureFormat_Depth24PlusStencil8));
    CHECK(!hasStencilPlanes(WGPUTextureFormat_Depth24Plus));
    CHECK(!hasStencilPlanes(WGPUTextureFormat_Undefined));
}

TEST_CASE("group-1 unit→binding convention: disjoint maps covering one u32 mask") {
    // Engine units 0..7: textures at 0..7, samplers at 8..15.
    CHECK(textureBindingForUnit(0) == 0u);
    CHECK(textureBindingForUnit(7) == 7u);
    CHECK(samplerBindingForUnit(0) == 8u);
    CHECK(samplerBindingForUnit(7) == 15u);
    // Material units 8..15 (MATERIAL_TEXTURE_UNIT_BASE range): textures at
    // 16..23, samplers at 24..31.
    CHECK(textureBindingForUnit(8) == 16u);
    CHECK(textureBindingForUnit(15) == 23u);
    CHECK(samplerBindingForUnit(8) == 24u);
    CHECK(samplerBindingForUnit(15) == 31u);

    // Bijection: the 16 units' texture+sampler bindings tile bits 0..31 exactly.
    u32 mask = 0;
    for (u32 unit = 0; unit < kGroup1TextureUnits; ++unit) {
        mask |= (1u << textureBindingForUnit(unit));
        mask |= (1u << samplerBindingForUnit(unit));
    }
    CHECK(mask == 0xFFFFFFFFu);
}

TEST_CASE("binding-mask scan mirrors the declarations an explicit layout carries") {
    // A batch-like fragment: the full group-1 texture/sampler set.
    const char* batchish = R"(
@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(7) var t7 : texture_2d<f32>;
@group(1) @binding(8) var s0 : sampler;
@group(1) @binding(15) var s7 : sampler;
)";
    CHECK(scanWGSLBindingMask(batchish, 1) == ((1u << 0) | (1u << 7) | (1u << 8) | (1u << 15)));
    CHECK(scanWGSLBindingMask(batchish, 0) == 0u);

    // A shader over several UBO slots — the engine's 0..4 binding map.
    const char* ubos = R"(
@group(0) @binding(0) var<uniform> frame : FrameConstants;
@group(0) @binding(3) var<uniform> time : TimeConstants;
@group(0) @binding(4) var<uniform> params : DrawParams;
)";
    CHECK(scanWGSLBindingMask(ubos, 0) == ((1u << 0) | (1u << 3) | (1u << 4)));
    CHECK(scanWGSLBindingMask(ubos, 1) == 0u);

    // Material texture params ride the extended group-1 range (units 8..15 →
    // texture bindings 16..23, samplers 24..31).
    const char* material = R"(
@group(1) @binding(16) var u_mask : texture_2d<f32>;
@group(1) @binding(24) var u_mask_s : sampler;
)";
    CHECK(scanWGSLBindingMask(material, 1) == ((1u << 16) | (1u << 24)));

    CHECK(scanWGSLBindingMask(nullptr, 0) == 0u);
    CHECK(scanWGSLBindingMask("no bindings here", 0) == 0u);
}

TEST_CASE("colour formats that a pass validates apart get variant slots apart") {
    // WebGPU validates a pipeline's colour format against the pass and rejects
    // the command buffer when they differ. A surface is BGRA and a render target
    // RGBA, so a shared slot takes the whole frame down.
    CHECK(WebGPUDevice::colorVariantOf(WGPUTextureFormat_BGRA8Unorm)
          != WebGPUDevice::colorVariantOf(WGPUTextureFormat_RGBA8Unorm));
    CHECK(WebGPUDevice::colorVariantOf(WGPUTextureFormat_RGBA8UnormSrgb)
          != WebGPUDevice::colorVariantOf(WGPUTextureFormat_RGBA8Unorm));
    CHECK(WebGPUDevice::colorVariantOf(WGPUTextureFormat_RGBA16Float)
          != WebGPUDevice::colorVariantOf(WGPUTextureFormat_RGBA8Unorm));
    // Every slot is inside the variant table the pipeline record allocates.
    CHECK(WebGPUDevice::colorVariantOf(WGPUTextureFormat_BGRA8Unorm) < WebGPUDevice::kColorVariantCount);
    CHECK(WebGPUDevice::colorVariantOf(WGPUTextureFormat_RGBA16Float) < WebGPUDevice::kColorVariantCount);
}

TEST_CASE("pass load-ops: full-target clear is a real load-op, a scoped clear is not") {
    CHECK(toWGPULoadOp(/*clear*/ true, /*scoped*/ false) == WGPULoadOp_Clear);
    CHECK(toWGPULoadOp(true, true) == WGPULoadOp_Load);   // region clear → emulate, load first
    CHECK(toWGPULoadOp(false, false) == WGPULoadOp_Load);

    RenderPassDesc desc{};
    desc.clearColorValue[0] = 0.25f;
    desc.clearColorValue[3] = 0.5f;
    auto color = toWGPUClearColor(desc);
    CHECK(color.r == doctest::Approx(0.25));
    CHECK(color.a == doctest::Approx(0.5));
}

TEST_CASE("a lost device issues no more handles") {
    WebGPUDevice device;
    device.init();

    VertexLayoutDesc layout{};
    layout.attributeCount = 1;
    layout.strides[0] = 8;
    layout.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    REQUIRE(device.createVertexLayout(layout) != VertexLayoutHandle::Invalid);

    device.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "the host took the context");

    CHECK(device.deviceStatus() == GfxDeviceStatus::Lost);
    // Registering a layout is descriptor-only bookkeeping — it succeeds with no
    // GPU device at all, as the case below asserts. So this refusal is the loss
    // guard and nothing else.
    CHECK(device.createVertexLayout(layout) == VertexLayoutHandle::Invalid);

    REQUIRE(device.deviceLostInfo() != nullptr);
    const std::string report = gfxFormatDeviceLost(*device.deviceLostInfo());
    CHECK(report.find("context-lost") != std::string::npos);
    CHECK(report.find("WebGPU") != std::string::npos);
}

TEST_CASE("null-device skeleton: language gate + graceful degradation + bookkeeping") {
    WebGPUDevice device;  // no WGPUDevice — bookkeeping-only mode
    CHECK(!device.hasDevice());

    // The capability gate is the WGSL mirror of GLDevice's.
    CHECK(device.supportsShaderLanguage(GfxShaderLanguage::WGSL));
    CHECK(!device.supportsShaderLanguage(GfxShaderLanguage::GLSL_ES300));

    // GPU-touching creation degrades to Invalid with a log, never UB.
    CHECK(device.createBuffer({GfxBufferUsage::Vertex, 256, true}, nullptr) == BufferHandle::Invalid);
    CHECK(device.createTexture({}, nullptr) == TextureHandle::Invalid);

    // Descriptor-only bookkeeping works without a device: layouts validate their
    // attributes against the WGPU format table and round-trip.
    VertexLayoutDesc batch{};
    batch.attributeCount = 4;
    batch.strides[0] = 24;
    batch.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    batch.attributes[1] = {1, 4, GfxDataType::UnsignedByte, true, 8, 0};
    batch.attributes[2] = {2, 2, GfxDataType::Float, false, 12, 0};
    batch.attributes[3] = {3, 1, GfxDataType::Float, false, 20, 0};
    auto layout = device.createVertexLayout(batch);
    REQUIRE(layout != VertexLayoutHandle::Invalid);
    REQUIRE(device.layoutDesc(layout) != nullptr);
    CHECK(device.layoutDesc(layout)->strides[0] == 24);

    VertexLayoutDesc bad{};
    bad.attributeCount = 1;
    bad.attributes[0] = {0, 3, GfxDataType::UnsignedByte, true, 0, 0};  // no WGPU spelling
    CHECK(device.createVertexLayout(bad) == VertexLayoutHandle::Invalid);

    // Pipelines retain their descriptors for the slice-2 lazy build.
    PipelineDesc pd{};
    pd.blend = BlendMode::Additive;
    pd.vertexLayout = layout;
    auto pipeline = device.createPipeline(pd);
    REQUIRE(device.pipelineDesc(pipeline) != nullptr);
    CHECK(device.pipelineDesc(pipeline)->blend == BlendMode::Additive);

    // GL-shaped introspection reports "absent" so Shader::compile skips block wiring.
    CHECK(device.getUniformBlockIndex(ShaderHandle{1}, "FrameConstants") == GFX_INVALID_UNIFORM_BLOCK);
    CHECK(device.getString(GfxStringName::ShadingLanguageVersion) == "WGSL");
}

TEST_CASE("null-device readback: requests degrade to Invalid, polls report Failed") {
    WebGPUDevice device;

    // No device — a request cannot be issued.
    CHECK(device.requestReadback(FramebufferHandle{7}, 4, 4) == ReadbackHandle::Invalid);
    // Zero-sized requests are rejected regardless of device state.
    CHECK(device.requestReadback(FramebufferHandle{7}, 0, 4) == ReadbackHandle::Invalid);

    // Unknown handles poll as Failed and take as false; discard is a safe no-op.
    CHECK(device.pollReadback(ReadbackHandle{42}) == GfxReadbackStatus::Failed);
    u8 pixels[4] = {};
    CHECK(!device.takeReadback(ReadbackHandle{42}, pixels, sizeof(pixels)));
    device.discardReadback(ReadbackHandle{42});
}

TEST_CASE("write sizes round the ALLOCATION, never the read out of the caller's data") {
    // Buffers are allocated rounded up, so the slack to receive padding exists.
    CHECK(alignedWriteSize(0) == 0);
    CHECK(alignedWriteSize(4) == 4);
    CHECK(alignedWriteSize(6) == 8);
    CHECK(alignedWriteSize(13) == 16);

    // A size that already fits is written straight through; anything else has to be
    // staged, because reading alignedWriteSize bytes runs off the end of the source.
    // 6 bytes is a three-index u16 draw — one triangle, the smallest real case.
    for (u32 size = 0; size <= 64; ++size) {
        const bool staged = needsWriteStaging(size);
        CHECK(staged == (size % 4 != 0));
        if (!staged) CHECK(alignedWriteSize(size) == size);
        else CHECK(alignedWriteSize(size) > size);
    }
}

TEST_CASE("a write range is checked without letting offset + size wrap") {
    CHECK(writeFitsInBuffer(0, 64, 64));
    CHECK(writeFitsInBuffer(60, 4, 64));
    CHECK(!writeFitsInBuffer(60, 8, 64));
    CHECK(!writeFitsInBuffer(0, 65, 64));
    CHECK(!writeFitsInBuffer(64, 1, 64));

    // offset + size == 0x100000000, which truncates to 0 and would read as in-range.
    CHECK(!writeFitsInBuffer(0xFFFFFFF0u, 16u, 64));
    CHECK(!writeFitsInBuffer(16u, 0xFFFFFFF0u, 64));
}
