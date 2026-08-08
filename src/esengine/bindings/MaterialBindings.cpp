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

#include <cstdlib>
#include <sstream>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

#define g_renderContext (ctx().tryGet<RenderContext>())
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())

// Float component count for a std140 param type (textures have no block slot).
static u32 materialParamArity(resource::ShaderPropertyType t) {
    using PT = resource::ShaderPropertyType;
    switch (t) {
        case PT::Float: case PT::Int: return 1;
        case PT::Vec2: return 2;
        case PT::Vec3: return 3;
        case PT::Vec4: case PT::Color: return 4;
        default: return 0;
    }
}

// Build the engine-side layout from a parsed shader's #pragma param reflection: non-texture
// params into the std140 block (declared order == offset order), texture params into sampler
// slots (their reflected units, >= MATERIAL_TEXTURE_UNIT_BASE).
static MaterialUniformLayout buildMaterialLayout(const resource::ParsedShader& parsed,
                                                 const RenderContext& rc) {
    MaterialUniformLayout layout;
    layout.blockSize = parsed.materialBlockSize;
    for (const auto& p : parsed.properties) {
        if (!p.fromParam) continue;
        if (p.type == resource::ShaderPropertyType::Texture) {
            if (p.textureUnit >= 0) {
                // Resolve the param's `default(<name>)` to a built-in default texture, bound when
                // a material leaves the param unset.
                layout.textures.push_back({ p.name, static_cast<u32>(p.textureUnit),
                                            materialDefaultByName(p.defaultValue) });
            }
        } else if (p.std140Offset >= 0) {
            MaterialParamSlot slot{ p.name, static_cast<u32>(p.std140Offset), materialParamArity(p.type) };
            // default(a,b,c,d) csv → the slot's initial block value.
            std::istringstream csv(p.defaultValue);
            std::string tok;
            for (u32 i = 0; i < slot.arity && std::getline(csv, tok, ','); ++i) {
                slot.defaults[i] = std::strtof(tok.c_str(), nullptr);
            }
            layout.params.push_back(slot);
        }
    }
    return layout;
}

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
    resource::ShaderHandle handle = rm->createShader(vert, frag, /*rewriteLoose=*/false,
                                                     rm->preferredShaderLanguage());
    if (!handle.isValid()) return 0;
    if (auto* rc = g_renderContext) {
        if (Shader* s = rm->getShader(handle)) {
            rc->materials().registerLayout(s->getProgramId(), buildMaterialLayout(parsed, *rc));
            // Point each texture param's sampler at its unit, once per program (GLSL ES 300 has
            // no layout(binding=); mirrors the batch path's u_textures setup in RenderFrame).
            // Sampler seeding is a GLSL concept; on WGSL the unit rides the bind group.
            if (s->language() == GfxShaderLanguage::GLSL_ES300) {
                s->bind();
                for (const auto& p : parsed.properties) {
                    if (p.fromParam && p.type == resource::ShaderPropertyType::Texture && p.textureUnit >= 0) {
                        s->setUniform(p.name, static_cast<i32>(p.textureUnit));
                    }
                }
                s->unbind();
            }
        }
    }
    return handle.id();
}

void material_define(u32 materialId, u32 shaderHandle, u32 blendMode, u32 flags) {
    auto* rc = g_renderContext;
    if (!rc) return;
    u32 programId = 0;
    if (shaderHandle != 0) {
        if (auto* rm = g_resourceManager) {
            if (Shader* s = rm->getShader(resource::ShaderHandle(shaderHandle))) {
                programId = s->getProgramId();
            }
        }
    }
    MaterialRecord rec;
    rec.shader = programId;
    rec.blend = static_cast<BlendMode>(blendMode);
    rec.depthTest = (flags & 0x1u) != 0;
    rec.depthWrite = (flags & 0x2u) != 0;
    rec.cull = static_cast<CullMode>((flags >> 2) & 0x3u);
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
