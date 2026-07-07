// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WebGPU bring-up (REARCH_WGSL Phase 2 slices 2+3) — NOT a doctest harness.
 *
 * A browser-run program: the host page acquires a GPUDevice (navigator.gpu) and
 * hands it over via Module.preinitializedWebGPUDevice; this program then drives
 * the REAL WebGPUDevice through the same RHI calls the engine's render path
 * makes. Each frame renders BOTH engine shader twins in one pass — pipeline
 * switch + bind-group rebuild included:
 *   - shape twin: a magenta SDF circle, top-center (slice 2)
 *   - batch twin (default variant): two quads sharing one draw, selecting
 *     different sampler slots per-vertex via texIndex — red left, green right
 *     (slice 3: texture views + shared sampler as bind group 1)
 * The electron runner (desktop/scripts/webgpu-bringup.mjs) asserts the pixels.
 */
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"

#include <emscripten.h>
#include <emscripten/html5.h>

#include <cstdio>

using namespace esengine;

// WGSL twin of src/esengine/data/shaders/shape.esshader — same attribute
// locations (Shape layout 0..3), same FrameConstants block (UBO binding 0),
// same SDF math line for line. `v` instead of `in` (a WGSL reserved word).
static const char* kShapeWGSL_Vertex = R"(
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) position : vec2f,
    @location(1) uv : vec2f,
    @location(2) color : vec4f,
    @location(3) shapeInfo : vec4f,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) uv : vec2f,
    @location(1) color : vec4f,
    @location(2) shapeInfo : vec4f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.position, 0.0, 1.0);
    out.uv = v.uv;
    out.color = v.color;
    out.shapeInfo = v.shapeInfo;
    return out;
}
)";

static const char* kShapeWGSL_Fragment = R"(
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) uv : vec2f,
    @location(1) color : vec4f,
    @location(2) shapeInfo : vec4f,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let halfSize = v.shapeInfo.yz;
    let cornerRadius = v.shapeInfo.w;
    let p = v.uv * halfSize;
    let shapeType = v.shapeInfo.x;

    var dist : f32;
    if (shapeType < 0.5) {
        let r = min(halfSize.x, halfSize.y);
        dist = length(p) - r;
    } else if (shapeType < 1.5) {
        let r = min(halfSize.x, halfSize.y);
        let elongation = halfSize - vec2f(r, r);
        let q = abs(p) - elongation;
        dist = length(max(q, vec2f(0.0, 0.0))) - r;
    } else {
        let r = min(cornerRadius, min(halfSize.x, halfSize.y));
        let q = abs(p) - halfSize + vec2f(r, r);
        dist = length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
    }

    let fw = fwidth(dist);
    let alpha = 1.0 - smoothstep(-fw, fw, dist);
    if (alpha < 0.001) { discard; }
    return vec4f(v.color.rgb, v.color.a * alpha);
}
)";

// WGSL twin of the batch shader's DEFAULT variant (batch.esshader): Batch layout
// attributes 0..3 (pos, unorm8x4 color, uv, texIndex), FrameConstants at group 0,
// and the multi-texture set as bind group 1 — 8 texture_2d at bindings 0..7 plus
// one shared sampler at binding 8 (the WGSL spelling of u_textures[8]).
// textureSampleLevel(…, 0) keeps sampling uniform-flow-legal inside the branch
// chain; 2D sprites sample mip 0 (the mipped path is a phase-3 topic).
static const char* kBatchWGSL_Vertex = R"(
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn {
    @location(0) position : vec2f,
    @location(1) color : vec4f,
    @location(2) uv : vec2f,
    @location(3) texIndex : f32,
};
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) color : vec4f,
    @location(1) uv : vec2f,
    @location(2) texIndex : f32,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.pos = frame.projection * vec4f(v.position, 0.0, 1.0);
    out.color = v.color;
    out.uv = v.uv;
    out.texIndex = v.texIndex;
    return out;
}
)";

static const char* kBatchWGSL_Fragment = R"(
@group(1) @binding(0) var t0 : texture_2d<f32>;
@group(1) @binding(1) var t1 : texture_2d<f32>;
@group(1) @binding(2) var t2 : texture_2d<f32>;
@group(1) @binding(3) var t3 : texture_2d<f32>;
@group(1) @binding(4) var t4 : texture_2d<f32>;
@group(1) @binding(5) var t5 : texture_2d<f32>;
@group(1) @binding(6) var t6 : texture_2d<f32>;
@group(1) @binding(7) var t7 : texture_2d<f32>;
@group(1) @binding(8) var samp : sampler;

struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) color : vec4f,
    @location(1) uv : vec2f,
    @location(2) texIndex : f32,
};

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let idx = i32(v.texIndex + 0.5);
    var c : vec4f;
    if (idx == 0) { c = textureSampleLevel(t0, samp, v.uv, 0.0); }
    else if (idx == 1) { c = textureSampleLevel(t1, samp, v.uv, 0.0); }
    else if (idx == 2) { c = textureSampleLevel(t2, samp, v.uv, 0.0); }
    else if (idx == 3) { c = textureSampleLevel(t3, samp, v.uv, 0.0); }
    else if (idx == 4) { c = textureSampleLevel(t4, samp, v.uv, 0.0); }
    else if (idx == 5) { c = textureSampleLevel(t5, samp, v.uv, 0.0); }
    else if (idx == 6) { c = textureSampleLevel(t6, samp, v.uv, 0.0); }
    else { c = textureSampleLevel(t7, samp, v.uv, 0.0); }
    return c * v.color;
}
)";

namespace {

WebGPUDevice* g_device = nullptr;
PipelineHandle g_shapePipeline{}, g_batchPipeline{};
BufferHandle g_shapeVbo{}, g_batchVbo{}, g_ibo6{}, g_ibo12{}, g_ubo{};
TextureHandle g_texRed{}, g_texGreen{};
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
    RenderPassDesc pass{};
    pass.clearColor = true;
    pass.clearColorValue[0] = 0.05f;
    pass.clearColorValue[1] = 0.05f;
    pass.clearColorValue[2] = 0.30f;
    pass.clearColorValue[3] = 1.0f;

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
    g_device->bindTexture(0, g_texRed);
    g_device->bindTexture(1, g_texGreen);
    g_device->setVertexBuffer(0, g_batchVbo, 0);
    g_device->setIndexBuffer(g_ibo12);
    g_device->drawElements(12, GfxDataType::UnsignedShort, 0);

    g_device->endRenderPass();

    if (++g_frames == 3) {
        std::printf("BRINGUP_FRAMES_OK\n");
        emscripten_cancel_main_loop();
    }
}

TextureHandle makeSolidTexture(u8 r, u8 g, u8 b) {
    u8 pixels[4 * 4 * 4];
    for (int i = 0; i < 16; ++i) {
        pixels[i * 4 + 0] = r;
        pixels[i * 4 + 1] = g;
        pixels[i * 4 + 2] = b;
        pixels[i * 4 + 3] = 255;
    }
    TextureDesc td{};
    td.width = 4;
    td.height = 4;
    td.format = GfxPixelFormat::RGBA8;
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

    // --- Batch scene: left quad samples slot 0 (red), right quad slot 1 (green).
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

    g_texRed = makeSolidTexture(255, 0, 0);
    g_texGreen = makeSolidTexture(0, 255, 0);
    if (g_texRed == TextureHandle::Invalid || g_texGreen == TextureHandle::Invalid) {
        std::printf("BRINGUP_FAIL textures\n");
        return 1;
    }

    // --- Programs + layouts + pipelines (the engine's streams, byte for byte).
    ShaderHandle shapeProgram = device.createProgram(
        GfxShaderSource{GfxShaderLanguage::WGSL, kShapeWGSL_Vertex, kShapeWGSL_Fragment},
        nullptr, 0, nullptr, nullptr);
    ShaderHandle batchProgram = device.createProgram(
        GfxShaderSource{GfxShaderLanguage::WGSL, kBatchWGSL_Vertex, kBatchWGSL_Fragment},
        nullptr, 0, nullptr, nullptr);
    if (shapeProgram == ShaderHandle::Invalid || batchProgram == ShaderHandle::Invalid) {
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

    std::printf("BRINGUP_INIT_OK\n");
    emscripten_set_main_loop(renderFrame, 0, /*simulate_infinite_loop=*/false);
    return 0;
}
