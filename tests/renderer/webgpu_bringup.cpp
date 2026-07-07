// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WebGPU bring-up (REARCH_WGSL Phase 2 slice 2) — NOT a doctest harness.
 *
 * A browser-run program: the host page acquires a GPUDevice (navigator.gpu) and
 * hands it over via Module.preinitializedWebGPUDevice; this program then drives
 * the REAL WebGPUDevice through the same RHI calls the engine's render path
 * makes — surface pass with a load-op clear, lazy pipeline from the Shape layout,
 * group-0 FrameConstants bind group, one indexed draw of the shape-shader WGSL
 * twin — and renders a red SDF circle on a dark blue clear. The electron runner
 * (desktop/scripts/webgpu-bringup.mjs) asserts the pixels.
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

namespace {

WebGPUDevice* g_device = nullptr;
PipelineHandle g_pipeline{};
BufferHandle g_vbo{}, g_ibo{}, g_ubo{};
int g_frames = 0;

// One ShapeVertex (mirrors the engine's Shape stream, stride 48).
struct ShapeVertex {
    f32 px, py, ux, uy;
    f32 cr, cg, cb, ca;
    f32 shapeType, halfW, halfH, cornerRadius;
};

void renderFrame() {
    RenderPassDesc pass{};
    pass.clearColor = true;
    pass.clearDepth = false;
    pass.clearColorValue[0] = 0.05f;
    pass.clearColorValue[1] = 0.05f;
    pass.clearColorValue[2] = 0.30f;
    pass.clearColorValue[3] = 1.0f;

    g_device->beginRenderPass(pass);
    g_device->setPipeline(g_pipeline);
    g_device->setUniformBuffer(0, g_ubo);
    g_device->setVertexBuffer(0, g_vbo, 0);
    g_device->setIndexBuffer(g_ibo);
    g_device->drawElements(6, GfxDataType::UnsignedShort, 0);
    g_device->endRenderPass();

    if (++g_frames == 3) {
        std::printf("BRINGUP_FRAMES_OK\n");
        emscripten_cancel_main_loop();
    }
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

    // A quad in clip space; uv spans ±1 so p = uv*halfSize inscribes the circle.
    const ShapeVertex verts[4] = {
        {-0.8f, -0.8f, -1, -1, 1, 0, 0, 1, /*circle*/ 0, 100, 100, 0},
        { 0.8f, -0.8f,  1, -1, 1, 0, 0, 1, 0, 100, 100, 0},
        { 0.8f,  0.8f,  1,  1, 1, 0, 0, 1, 0, 100, 100, 0},
        {-0.8f,  0.8f, -1,  1, 1, 0, 0, 1, 0, 100, 100, 0},
    };
    const u16 indices[6] = {0, 1, 2, 2, 3, 0};
    g_vbo = device.createBuffer({GfxBufferUsage::Vertex, sizeof(verts), false}, verts);
    g_ibo = device.createBuffer({GfxBufferUsage::Index, sizeof(indices), false}, indices);

    ShaderHandle program = device.createProgram(
        GfxShaderSource{GfxShaderLanguage::WGSL, kShapeWGSL_Vertex, kShapeWGSL_Fragment},
        nullptr, 0, nullptr, nullptr);
    if (program == ShaderHandle::Invalid) {
        std::printf("BRINGUP_FAIL program\n");
        return 1;
    }

    // The engine's Shape layout, byte for byte (TransientBufferPool::setupStream).
    VertexLayoutDesc layout{};
    layout.attributeCount = 4;
    layout.strides[0] = 48;
    layout.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    layout.attributes[1] = {1, 2, GfxDataType::Float, false, 8, 0};
    layout.attributes[2] = {2, 4, GfxDataType::Float, false, 16, 0};
    layout.attributes[3] = {3, 4, GfxDataType::Float, false, 32, 0};

    PipelineDesc pd{};
    pd.program = program;
    pd.vertexLayout = device.createVertexLayout(layout);
    pd.blend = BlendMode::Normal;
    pd.blendEnabled = true;
    g_pipeline = device.createPipeline(pd);

    std::printf("BRINGUP_INIT_OK\n");
    emscripten_set_main_loop(renderFrame, 0, /*simulate_infinite_loop=*/false);
    return 0;
}
