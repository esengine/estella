// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialBindings.cpp
 * @brief   Implementation of the material / `.esshader` entry points.
 */

#include "MaterialBindings.hpp"
#include "ActiveContext.hpp"

#include "../core/Log.hpp"
#include "../renderer/store/MaterialStore.hpp"
#include "../renderer/frame/RenderContext.hpp"
#include "../renderer/rhi/Shader.hpp"
#include "../renderer/rhi/Texture.hpp"
#include "../resource/ResourceManager.hpp"
#include "../resource/ShaderParser.hpp"

#include <algorithm>
#include <cstdlib>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

#define g_renderContext (ctx().tryGet<RenderContext>())
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())

u32 material_compileEsshader(const std::string& source, const std::string& featuresCsv) {
    auto* rm = g_resourceManager;
    if (!rm) return 0;
    resource::ParsedShader parsed = resource::ShaderParser::parse(source);
    if (!parsed.valid) {
        ES_LOG_ERROR("material_compileEsshader: parse failed: {}", parsed.errorMessage);
        return 0;
    }
    const std::vector<std::string> features = resource::ShaderParser::splitFeatures(featuresCsv);
    // Assemble both stages for the backend's language — a material .esshader
    // carries its WGSL twin in-file, and a missing twin surfaces here as a
    // descriptive assembly error rather than a backend compile failure.
    const auto target = rm->preferredShaderTarget();
    const std::string vert = resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features, target);
    const std::string frag = resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features, target);
    if (vert.empty() || frag.empty()) {
        ES_LOG_ERROR("material_compileEsshader: stage assembly failed for '{}'", parsed.name);
        return 0;
    }
    // No DrawParams rewrite: assembled material sources already carry their
    // params in MaterialConstants; only sampler uniforms remain loose.
    // A material shader the package ships, and a post-process effect: both known to compile, so with the async policy on they are queued
    // and waited for by whoever draws with them, not one by one here.
    resource::ShaderHandle handle = rm->createShader(vert, frag, /*rewriteLoose=*/false,
                                                     rm->preferredShaderLanguage(), rm->deferLinks());
    if (!handle.isValid()) return 0;
    if (auto* rc = g_renderContext) {
        if (Shader* s = rm->getShader(handle)) {
            rc->materials().registerLayout(handle, MaterialStore::layoutOf(parsed));
            // Kept so the same material can be compiled for another vertex source
            // (GPU-resident geometry) without the author's file being read again.
            rc->materials().rememberSource(handle, source, featuresCsv);
            // Through the store's own seeding, not a copy of it: a device
            // recovery has to redo exactly this, and two spellings of "which
            // unit does this sampler read" is how one of them stops being done.
            MaterialStore::seedSamplers(*s, parsed);
        }
    }
    return handle.id();
}

void material_define(u32 materialId, u32 shaderHandle, u32 blendMode, u32 flags,
                     i32 depthBias) {
    auto* rc = g_renderContext;
    if (!rc) return;
    // The handle is the identity; the program id is a cache of what it currently
    // resolves to, refreshed by refreshShaderPrograms when the device rebuilds it.
    MaterialRecord rec;
    rec.shaderRef = resource::ShaderHandle(shaderHandle);
    if (auto* rm = g_resourceManager) {
        if (Shader* s = rm->getShader(rec.shaderRef)) rec.shader = s->getProgramId();
    }
    rec.blend = static_cast<BlendMode>(blendMode);
    rec.depthTest = (flags & 0x1u) != 0;
    rec.depthWrite = (flags & 0x2u) != 0;
    rec.cull = static_cast<CullMode>((flags >> 2) & 0x3u);
    // Its own parameter and not another flag bit: this is a VALUE, and packing
    // one into a word of booleans is how two sides come to disagree about it.
    rec.depthBias = static_cast<i16>(std::clamp(depthBias, -32768, 32767));
    rc->materials().define(materialId, rec);
}

void material_setUniform(u32 materialId, const std::string& name, u32 arity,
                         f32 v0, f32 v1, f32 v2, f32 v3) {
    auto* rc = g_renderContext;
    if (!rc) return;
    const f32 vals[4] = { v0, v1, v2, v3 };
    rc->materials().setUniform(materialId, name, vals, arity);
}

void material_setTexture(u32 materialId, const std::string& name, u32 textureHandle) {
    auto* rc = g_renderContext;
    if (!rc) return;
    // The handle is stored as-is. Resolving it here would freeze the material to
    // the GPU object the texture happened to have at this moment, which is the
    // one thing a re-upload behind that handle must not need to undo.
    rc->materials().setTexture(materialId, name, resource::TextureHandle(textureHandle));
}

void material_undefine(u32 materialId) {
    if (auto* rc = g_renderContext) rc->materials().undefine(materialId);
}

}  // namespace esengine
