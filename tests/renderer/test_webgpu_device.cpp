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
