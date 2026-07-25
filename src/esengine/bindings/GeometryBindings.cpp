// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include "GeometryBindings.hpp"
#include "ActiveContext.hpp"
#include "BoundarySpan.hpp"
#include "../renderer/GfxDevice.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../renderer/Buffer.hpp"
#include "../renderer/MaterialStore.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <vector>
#include <string>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

#define g_device (ctx().tryGet<GfxDevice>())
#define g_initialized (ctx().state().initialized)
#define g_geometryManager (ctx().tryGet<GeometryManager>())
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())
#define g_immediateDraw (ctx().tryGet<ImmediateDraw>())
#define g_immediateDrawActive (ctx().state().immediate_draw_active)
#define g_currentViewProjection (ctx().state().current_view_projection)
#define g_renderContext (ctx().tryGet<RenderContext>())

static void flushImmediateDrawIfActive() {
    if (g_immediateDrawActive && g_immediateDraw) {
        g_immediateDraw->flush();
    }
}

// Bind + submit a custom geometry through the device (indexed or arrays).
static void drawGeometry(GfxDevice& device, CustomGeometry& geom) {
    geom.bind(device);
    if (geom.hasIndices()) {
        auto* ib = geom.indexBuffer();
        if (ib) {
            auto type = ib->is16Bit() ? GfxDataType::UnsignedShort : GfxDataType::UnsignedInt;
            device.drawElements(geom.getIndexCount(), type, 0);
        }
    } else {
        device.drawArrays(0, geom.getVertexCount());
    }
}

// A mesh draw's pipeline: the requested shader + this geometry's vertex layout,
// with blend/depth taken from the immediate-draw session state (Draw.setBlendMode /
// setDepthTest apply to mesh draws too). The pipeline cache dedupes repeats.
static void applyMeshPipeline(GfxDevice& device, const Shader& shader, const CustomGeometry& geom) {
    PipelineDesc desc{};
    desc.program = shader.handle();
    desc.vertexLayout = geom.layoutHandle();
    desc.blendEnabled = true;
    desc.depthWrite = true;
    if (auto* imm = g_immediateDraw) {
        desc.blend = imm->blendMode();
        desc.depthTest = imm->depthTest();
    }
    device.invalidatePipelineCache();
    device.setPipeline(device.createPipeline(desc));
}

u32 geometry_create() {
    if (!g_geometryManager) return 0;
    return g_geometryManager->create();
}

void geometry_init(u32 handle, uintptr_t verticesPtr, u32 vertexCount,
                   uintptr_t layoutPtr, u32 layoutCount, bool dynamic) {
    if (!g_geometryManager || verticesPtr == 0 || layoutPtr == 0) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    static constexpr u32 MAX_ATTRS = 8;
    if (layoutCount == 0 || layoutCount > MAX_ATTRS) {
        ES_LOG_WARN("geometry_init: invalid layoutCount {}, max {}", layoutCount, MAX_ATTRS);
        return;
    }

    const i32* layoutData = boundarySpan<i32>(layoutPtr, layoutCount, "geometry_init.layout");
    if (!layoutData) return;

    static constexpr const char* ATTR_NAMES[] = {
        "a_attr0", "a_attr1", "a_attr2", "a_attr3",
        "a_attr4", "a_attr5", "a_attr6", "a_attr7"
    };

    std::vector<VertexAttribute> attrs;
    attrs.reserve(layoutCount);
    for (u32 i = 0; i < layoutCount; ++i) {
        attrs.emplace_back(static_cast<ShaderDataType>(layoutData[i]), ATTR_NAMES[i]);
    }

    VertexLayout layout(std::move(attrs));
    const f32* vertices = boundarySpan<f32>(
        verticesPtr, static_cast<u64>(vertexCount) * (layout.getStride() / sizeof(f32)),
        "geometry_init.vertices");
    if (!vertices) return;
    geom->init(ctx().require<GfxDevice>(), vertices, vertexCount, std::move(layout), dynamic);
}

void geometry_setIndices16(u32 handle, uintptr_t indicesPtr, u32 indexCount) {
    if (!g_geometryManager || indicesPtr == 0) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const u16* indices = boundarySpan<u16>(indicesPtr, indexCount, "geometry_setIndices16");
    if (!indices) return;
    geom->setIndices(indices, indexCount);
}

void geometry_setIndices32(u32 handle, uintptr_t indicesPtr, u32 indexCount) {
    if (!g_geometryManager || indicesPtr == 0) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const u32* indices = boundarySpan<u32>(indicesPtr, indexCount, "geometry_setIndices32");
    if (!indices) return;
    geom->setIndices(indices, indexCount);
}

void geometry_updateVertices(u32 handle, uintptr_t verticesPtr, u32 vertexCount, u32 offset) {
    if (!g_geometryManager || verticesPtr == 0) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const f32* vertices = boundarySpan<f32>(
        verticesPtr, static_cast<u64>(vertexCount) * (geom->getVertexStride() / sizeof(f32)),
        "geometry_updateVertices");
    if (!vertices) return;
    geom->updateVertices(vertices, vertexCount, offset);
}

void geometry_release(u32 handle) {
    if (!g_geometryManager) return;
    g_geometryManager->release(handle);
}

bool geometry_isValid(u32 handle) {
    if (!g_geometryManager) return false;
    return g_geometryManager->isValid(handle);
}

void draw_mesh(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr) {
    if (!g_initialized || !g_geometryManager || !g_resourceManager) return;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return;

    Shader* shader = g_resourceManager->getShader(resource::ShaderHandle(shaderHandle));
    if (!shader) return;

    flushImmediateDrawIfActive();

    const f32* transformData = boundarySpan<f32>(transformPtr, 16, "draw_mesh.transform");
    if (!transformData) return;
    glm::mat4 transform = glm::make_mat4(transformData);

    applyMeshPipeline(*g_device, *shader, *geom);
    shader->setUniform("u_projection", g_currentViewProjection);
    shader->setUniform("u_model", transform);
    shader->commitParams();

    drawGeometry(*g_device, *geom);
}

bool draw_meshWithMaterial(u32 geometryHandle, u32 materialId) {
    if (!g_initialized || !g_geometryManager) return false;
    auto* rc = g_renderContext;
    if (!rc) return false;

    // Route through the reflected path only when the material's shader registered a
    // #pragma-param layout (compileEsshader). A raw-GLSL createShader program has no
    // layout — return false so the SDK falls back to the legacy uniform-stream path.
    const MaterialRecord* rec = rc->materials().find(materialId);
    if (!rec || !rc->materials().layoutFor(rec->shader)) return false;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return true;  // routed modern; nothing to draw

    flushImmediateDrawIfActive();

    // The material record supplies the full pipeline state (same resolve as
    // DrawList::execute); positioning comes from FrameConstants + params in the
    // shader — no per-draw loose uniforms, so the draw is backend-neutral.
    GfxDevice& device = *g_device;
    PipelineDesc desc{};
    desc.program = ShaderHandle{rec->shader};
    desc.vertexLayout = geom->layoutHandle();
    desc.blend = rec->blend;
    desc.blendEnabled = true;
    desc.depthTest = rec->depthTest;
    desc.depthWrite = rec->depthWrite;
    desc.cullEnabled = rec->cull != CullMode::None;
    desc.cullFront = rec->cull == CullMode::Front;
    device.invalidatePipelineCache();
    device.setPipeline(device.createPipeline(desc));

    // Per-material constants (binding 1): upload-if-dirty + bind, plus texture params.
    rc->materials().bindForDraw(materialId);

    drawGeometry(device, *geom);
    return true;
}

void draw_meshWithUniforms(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr,
                           uintptr_t uniformsPtr, u32 uniformCount) {
    if (!g_initialized || !g_geometryManager || !g_resourceManager) return;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return;

    Shader* shader = g_resourceManager->getShader(resource::ShaderHandle(shaderHandle));
    if (!shader) return;

    flushImmediateDrawIfActive();

    const f32* transformData = boundarySpan<f32>(transformPtr, 16, "draw_meshWithUniforms.transform");
    if (!transformData) return;
    glm::mat4 transform = glm::make_mat4(transformData);

    applyMeshPipeline(*g_device, *shader, *geom);
    shader->setUniform("u_projection", g_currentViewProjection);
    shader->setUniform("u_model", transform);

    static constexpr const char* UNIFORM_NAMES[] = {
        "u_time", "u_color", "u_intensity", "u_scale", "u_offset",
        "u_param0", "u_param1", "u_param2", "u_param3", "u_param4",
        "u_vec0", "u_vec1", "u_vec2", "u_vec3",
        "u_texture0", "u_texture1", "u_texture2", "u_texture3"
    };
    static constexpr u32 UNIFORM_NAME_COUNT = sizeof(UNIFORM_NAMES) / sizeof(UNIFORM_NAMES[0]);

    const f32* uniforms = boundarySpan<f32>(uniformsPtr, uniformCount, "draw_meshWithUniforms.uniforms");
    if (uniformCount != 0 && !uniforms) return;
    u32 idx = 0;

    // Each record is [type, nameId, payload...]; a truncated record must stop the
    // walk instead of reading past uniformCount.
    while (idx + 2 <= uniformCount) {
        auto type = static_cast<i32>(uniforms[idx++]);
        auto nameId = static_cast<i32>(uniforms[idx++]);
        const u32 arity = (type == 10) ? 2u : (type >= 1 && type <= 4 ? static_cast<u32>(type) : 0u);
        if (uniformCount - idx < arity) break;

        const char* name = (nameId >= 0 && static_cast<u32>(nameId) < UNIFORM_NAME_COUNT)
                         ? UNIFORM_NAMES[nameId] : "u_unknown";

        switch (type) {
            case 1: {
                f32 value = uniforms[idx++];
                shader->setUniform(name, value);
                break;
            }
            case 2: {
                glm::vec2 value(uniforms[idx], uniforms[idx + 1]);
                idx += 2;
                shader->setUniform(name, value);
                break;
            }
            case 3: {
                glm::vec3 value(uniforms[idx], uniforms[idx + 1], uniforms[idx + 2]);
                idx += 3;
                shader->setUniform(name, value);
                break;
            }
            case 4: {
                glm::vec4 value(uniforms[idx], uniforms[idx + 1],
                               uniforms[idx + 2], uniforms[idx + 3]);
                idx += 4;
                shader->setUniform(name, value);
                break;
            }
            case 10: {
                i32 slot = static_cast<i32>(uniforms[idx++]);
                u32 textureId = static_cast<u32>(uniforms[idx++]);
                g_device->bindTexture(static_cast<u32>(slot), TextureHandle{textureId});
                shader->setUniform(name, slot);
                break;
            }
            default:
                break;
        }
    }

    // Lifted uniforms (everything above except the sampler slots) live in the
    // shader's DrawParams block; flush + bind them for this draw.
    shader->commitParams();

    drawGeometry(*g_device, *geom);
}

}  // namespace esengine

