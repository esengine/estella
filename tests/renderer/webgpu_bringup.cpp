// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WebGPU bring-up (REARCH_WGSL Phase 2) — NOT a doctest harness.
 *
 * A browser-run program: the host page acquires a GPUDevice (navigator.gpu) and
 * hands it over via Module.preinitializedWebGPUDevice; this program then drives
 * the REAL WebGPUDevice through the same RHI calls the engine's render path
 * makes, with the WGSL twins assembled from the embedded .esshaders by
 * ShaderParser (the production path's source). Each frame is THREE passes:
 *   A. offscreen: a framebuffer with color + depth-stencil attachments, all
 *      load-op cleared (color green) — the right batch quad then SAMPLES the
 *      rendered color target
 *   B. main (the surface + its companion depth-stencil):
 *      act 1  shape twin — magenta SDF circle
 *      act 2  batch twin — two quads in one draw with per-vertex sampler-slot
 *             selection; slot 0 is a 2x2 checker sampled NEAREST (the sampler
 *             cache assert: linear would blend the texels), slot 1 the
 *             offscreen render
 *      act 3  stencil mask — a Write-mode rect stamps ref 1, an oversized
 *             Test-mode cyan rect lands only inside it; then a MID-PASS
 *             clearStencil(0) (the stencil-write triangle emulation) and a
 *             second Test-mode rect that must stay invisible
 *   C. region-scoped clear: a surface pass whose RenderPassDesc carries a clear
 *      REGION — the load-op contract's WebGPU emulation paints a yellow square
 * The electron runner (desktop/scripts/webgpu-bringup.mjs) asserts the pixels.
 */
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include "esengine/renderer/ShaderEmbeds.generated.hpp"
#include "esengine/resource/ShaderParser.hpp"

#include <emscripten.h>
#include <emscripten/html5.h>

#include <array>
#include <cstdio>

using namespace esengine;

namespace {

WebGPUDevice* g_device = nullptr;
PipelineHandle g_shapePipeline{}, g_batchPipeline{};
PipelineHandle g_maskWritePipeline{}, g_maskTestPipeline{};
BufferHandle g_shapeVbo{}, g_batchVbo{}, g_stencilVbo{}, g_ibo6{}, g_ibo12{}, g_ibo18{}, g_ubo{};
TextureHandle g_texChecker{}, g_texOffscreen{}, g_texOffscreenDepth{};
FramebufferHandle g_offscreenFb{};
int g_frames = 0;

// Mirrors the engine's Shape stream vertex (stride 48).
struct ShapeVertex {
    f32 px, py, ux, uy;
    f32 cr, cg, cb, ca;
    f32 shapeType, halfW, halfH, cornerRadius;
};

// Mirrors the engine's Batch stream vertex (stride 24).
struct BatchVertex {
    f32 px, py;
    u32 color;
    f32 ux, uy;
    f32 texIndex;
};

void renderFrame() {
    // Pass A: offscreen — full-target load-op clears on color AND depth-stencil.
    RenderPassDesc off{};
    off.target = g_offscreenFb;
    off.clearColor = true;
    off.clearColorValue[1] = 1.0f;
    off.clearColorValue[3] = 1.0f;
    off.clearDepth = true;
    off.clearStencil = true;
    g_device->beginRenderPass(off);
    g_device->endRenderPass();

    // Pass B: the main scene.
    RenderPassDesc pass{};
    pass.clearColor = true;
    pass.clearColorValue[0] = 0.05f;
    pass.clearColorValue[1] = 0.05f;
    pass.clearColorValue[2] = 0.30f;
    pass.clearColorValue[3] = 1.0f;
    pass.clearDepth = true;
    pass.clearStencil = true;

    g_device->beginRenderPass(pass);

    // Act 1: shape twin — magenta SDF circle, top-center.
    g_device->setPipeline(g_shapePipeline);
    g_device->setUniformBuffer(0, g_ubo);
    g_device->setVertexBuffer(0, g_shapeVbo, 0);
    g_device->setIndexBuffer(g_ibo6);
    g_device->drawElements(6, GfxDataType::UnsignedShort, 0);

    // Act 2: batch twin — two quads in ONE draw, per-vertex sampler selection.
    g_device->setPipeline(g_batchPipeline);
    g_device->setUniformBuffer(0, g_ubo);
    g_device->bindTexture(0, g_texChecker);
    g_device->bindTexture(1, g_texOffscreen);  // render-to-texture output from pass A
    g_device->setVertexBuffer(0, g_batchVbo, 0);
    g_device->setIndexBuffer(g_ibo12);
    g_device->drawElements(12, GfxDataType::UnsignedShort, 0);

    // Act 3: the stencil mask flow (Write → Test → mid-pass reset → Test).
    // Textures stay bound from act 2 — the shape-family pipelines must keep
    // their group-0-only layout regardless.
    g_device->setPipeline(g_maskWritePipeline);
    g_device->setUniformBuffer(0, g_ubo);
    g_device->setVertexBuffer(0, g_stencilVbo, 0);
    g_device->setIndexBuffer(g_ibo18);
    g_device->setStencilReference(1);
    g_device->drawElements(6, GfxDataType::UnsignedShort, 0);

    g_device->setPipeline(g_maskTestPipeline);
    g_device->setStencilReference(1);
    g_device->drawElements(6, GfxDataType::UnsignedShort, 12);

    g_device->clearStencil(0);

    g_device->setPipeline(g_maskTestPipeline);
    g_device->setStencilReference(1);
    g_device->drawElements(6, GfxDataType::UnsignedShort, 24);

    g_device->endRenderPass();

    // Pass C: a region-scoped clear on the surface — loadOp must LOAD (keeping
    // the scene) and the emulation triangle paints only the region yellow.
    RenderPassDesc scoped{};
    scoped.clearColor = true;
    scoped.clearColorValue[0] = 1.0f;
    scoped.clearColorValue[1] = 1.0f;
    scoped.clearColorValue[3] = 1.0f;
    scoped.clearX = 96;
    scoped.clearY = 96;
    scoped.clearW = 64;
    scoped.clearH = 64;
    g_device->beginRenderPass(scoped);
    g_device->endRenderPass();

    if (++g_frames == 3) {
        std::printf("BRINGUP_FRAMES_OK\n");
        emscripten_cancel_main_loop();
    }
}

TextureHandle makeCheckerTexture() {
    // 2x2 red/blue checker sampled NEAREST: texel centers sit at uv 0.25/0.75,
    // so any off-center sample point separates nearest (pure texel) from
    // linear (a visible blend) — the sampler-cache pixel assert.
    const u8 red[4] = {255, 0, 0, 255};
    const u8 blue[4] = {0, 0, 255, 255};
    u8 pixels[2 * 2 * 4];
    const u8* rows[4] = {red, blue, blue, red};
    for (int i = 0; i < 4; ++i) {
        for (int c = 0; c < 4; ++c) pixels[i * 4 + c] = rows[i][c];
    }
    TextureDesc td{};
    td.width = 2;
    td.height = 2;
    td.format = GfxPixelFormat::RGBA8;
    td.minFilter = TextureFilter::Nearest;
    td.magFilter = TextureFilter::Nearest;
    return g_device->createTexture(td, pixels);
}

}  // namespace

int main() {
    WGPUDevice raw = emscripten_webgpu_get_device();
    if (!raw) {
        std::printf("BRINGUP_FAIL no preinitialized device\n");
        return 1;
    }

    static WebGPUDevice device(raw);
    g_device = &device;

    if (!device.configureSurface("#canvas", 256, 256)) {
        std::printf("BRINGUP_FAIL surface\n");
        return 1;
    }

    // FrameConstants: identity projection (positions are authored in clip space).
    const f32 identity[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    g_ubo = device.createBuffer({GfxBufferUsage::Uniform, sizeof(identity), false}, identity);

    // --- Shape scene: small circle, top-center (clip y 0.55..0.95).
    const ShapeVertex shapeVerts[4] = {
        {-0.25f, 0.55f, -1, -1, 1, 0, 1, 1, /*circle*/ 0, 100, 100, 0},
        { 0.25f, 0.55f,  1, -1, 1, 0, 1, 1, 0, 100, 100, 0},
        { 0.25f, 0.95f,  1,  1, 1, 0, 1, 1, 0, 100, 100, 0},
        {-0.25f, 0.95f, -1,  1, 1, 0, 1, 1, 0, 100, 100, 0},
    };
    const u16 quadIdx[6] = {0, 1, 2, 2, 3, 0};
    g_shapeVbo = device.createBuffer({GfxBufferUsage::Vertex, sizeof(shapeVerts), false}, shapeVerts);
    g_ibo6 = device.createBuffer({GfxBufferUsage::Index, sizeof(quadIdx), false}, quadIdx);

    // --- Batch scene: left quad samples slot 0 (checker), right quad slot 1 (green).
    const u32 white = 0xFFFFFFFFu;
    const BatchVertex batchVerts[8] = {
        {-0.9f, -0.9f, white, 0, 0, 0}, {-0.1f, -0.9f, white, 1, 0, 0},
        {-0.1f,  0.3f, white, 1, 1, 0}, {-0.9f,  0.3f, white, 0, 1, 0},
        { 0.1f, -0.9f, white, 0, 0, 1}, { 0.9f, -0.9f, white, 1, 0, 1},
        { 0.9f,  0.3f, white, 1, 1, 1}, { 0.1f,  0.3f, white, 0, 1, 1},
    };
    const u16 batchIdx[12] = {0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4};
    g_batchVbo = device.createBuffer({GfxBufferUsage::Vertex, sizeof(batchVerts), false}, batchVerts);
    g_ibo12 = device.createBuffer({GfxBufferUsage::Index, sizeof(batchIdx), false}, batchIdx);

    // --- Stencil scene (SDF rects, shapeType 2 with radius 0): quad 0 = the
    // mask (top-left), quad 1 = an oversized cyan rect testing INTO the mask,
    // quad 2 = an orange rect drawn after the mid-pass stencil reset (top-right,
    // must stay invisible).
    auto rect = [](f32 x0, f32 y0, f32 x1, f32 y1, f32 r, f32 g, f32 b) {
        return std::array<ShapeVertex, 4>{{
            {x0, y0, -1, -1, r, g, b, 1, 2, 100, 100, 0},
            {x1, y0,  1, -1, r, g, b, 1, 2, 100, 100, 0},
            {x1, y1,  1,  1, r, g, b, 1, 2, 100, 100, 0},
            {x0, y1, -1,  1, r, g, b, 1, 2, 100, 100, 0},
        }};
    };
    ShapeVertex stencilVerts[12];
    const auto mask = rect(-0.9f, 0.5f, -0.5f, 0.9f, 1, 1, 1);
    const auto cyan = rect(-0.95f, 0.45f, -0.3f, 0.95f, 0, 1, 1);
    const auto orange = rect(0.3f, 0.45f, 0.95f, 0.95f, 1, 0.5f, 0);
    for (int i = 0; i < 4; ++i) {
        stencilVerts[i] = mask[i];
        stencilVerts[4 + i] = cyan[i];
        stencilVerts[8 + i] = orange[i];
    }
    const u16 stencilIdx[18] = {0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4, 8, 9, 10, 10, 11, 8};
    g_stencilVbo = device.createBuffer({GfxBufferUsage::Vertex, sizeof(stencilVerts), false}, stencilVerts);
    g_ibo18 = device.createBuffer({GfxBufferUsage::Index, sizeof(stencilIdx), false}, stencilIdx);

    g_texChecker = makeCheckerTexture();
    // The right quad's texture is RENDERED, not uploaded: an offscreen target
    // cleared green by pass A each frame — now with depth-stencil planes.
    TextureDesc offDesc{};
    offDesc.width = 4;
    offDesc.height = 4;
    offDesc.format = GfxPixelFormat::RGBA8;
    g_texOffscreen = device.createTexture(offDesc, nullptr);
    TextureDesc offDepthDesc{};
    offDepthDesc.width = 4;
    offDepthDesc.height = 4;
    offDepthDesc.format = GfxPixelFormat::Depth24Stencil8;
    g_texOffscreenDepth = device.createTexture(offDepthDesc, nullptr);
    if (g_texChecker == TextureHandle::Invalid || g_texOffscreen == TextureHandle::Invalid ||
        g_texOffscreenDepth == TextureHandle::Invalid) {
        std::printf("BRINGUP_FAIL textures\n");
        return 1;
    }
    FramebufferDesc fbDesc{};
    fbDesc.color0 = g_texOffscreen;
    fbDesc.depthStencil = g_texOffscreenDepth;
    g_offscreenFb = device.createFramebuffer(fbDesc);

    // --- Programs + layouts + pipelines (the engine's streams, byte for byte,
    // with the WGSL twins assembled from the embedded .esshaders).
    const auto assembleWGSL = [](const char* embed, resource::ShaderStage stage) {
        auto parsed = resource::ShaderParser::parse(embed);
        return resource::ShaderParser::assembleStage(parsed, stage, "", {},
                                                     resource::ShaderTargetLanguage::WGSL);
    };
    const std::string shapeVs = assembleWGSL(ShaderEmbeds::SHAPE, resource::ShaderStage::Vertex);
    const std::string shapeFs = assembleWGSL(ShaderEmbeds::SHAPE, resource::ShaderStage::Fragment);
    const std::string batchVs = assembleWGSL(ShaderEmbeds::BATCH, resource::ShaderStage::Vertex);
    const std::string batchFs = assembleWGSL(ShaderEmbeds::BATCH, resource::ShaderStage::Fragment);
    ShaderHandle shapeProgram = device.createProgram(
        GfxShaderSource{GfxShaderLanguage::WGSL, shapeVs.c_str(), shapeFs.c_str()},
        nullptr, 0, nullptr, nullptr);
    ShaderHandle batchProgram = device.createProgram(
        GfxShaderSource{GfxShaderLanguage::WGSL, batchVs.c_str(), batchFs.c_str()},
        nullptr, 0, nullptr, nullptr);
    if (shapeVs.empty() || shapeFs.empty() || batchVs.empty() || batchFs.empty() ||
        shapeProgram == ShaderHandle::Invalid || batchProgram == ShaderHandle::Invalid) {
        std::printf("BRINGUP_FAIL programs\n");
        return 1;
    }

    VertexLayoutDesc shapeLayout{};
    shapeLayout.attributeCount = 4;
    shapeLayout.strides[0] = 48;
    shapeLayout.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    shapeLayout.attributes[1] = {1, 2, GfxDataType::Float, false, 8, 0};
    shapeLayout.attributes[2] = {2, 4, GfxDataType::Float, false, 16, 0};
    shapeLayout.attributes[3] = {3, 4, GfxDataType::Float, false, 32, 0};

    VertexLayoutDesc batchLayout{};
    batchLayout.attributeCount = 4;
    batchLayout.strides[0] = 24;
    batchLayout.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    batchLayout.attributes[1] = {1, 4, GfxDataType::UnsignedByte, true, 8, 0};
    batchLayout.attributes[2] = {2, 2, GfxDataType::Float, false, 12, 0};
    batchLayout.attributes[3] = {3, 1, GfxDataType::Float, false, 20, 0};

    PipelineDesc shapePd{};
    shapePd.program = shapeProgram;
    shapePd.vertexLayout = device.createVertexLayout(shapeLayout);
    g_shapePipeline = device.createPipeline(shapePd);

    PipelineDesc batchPd{};
    batchPd.program = batchProgram;
    batchPd.vertexLayout = device.createVertexLayout(batchLayout);
    g_batchPipeline = device.createPipeline(batchPd);

    // The mask pipelines are the shape pipeline in the engine's two stencil
    // modes (Write = no color, Replace; Test = Equal, keep) — the same
    // PipelineDesc split DrawList uses for mask draws.
    PipelineDesc maskWritePd = shapePd;
    maskWritePd.stencil = GfxStencilMode::Write;
    g_maskWritePipeline = device.createPipeline(maskWritePd);

    PipelineDesc maskTestPd = shapePd;
    maskTestPd.stencil = GfxStencilMode::Test;
    g_maskTestPipeline = device.createPipeline(maskTestPd);

    std::printf("BRINGUP_INIT_OK\n");
    emscripten_set_main_loop(renderFrame, 0, /*simulate_infinite_loop=*/false);
    return 0;
}
