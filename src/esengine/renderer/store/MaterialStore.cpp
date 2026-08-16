// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialStore.cpp
 * @brief   GPU-touching parts of MaterialStore (per-material UBO lifecycle + binding).
 */
#include "./MaterialStore.hpp"

#include "../../resource/ResourceManager.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../rhi/GfxEnums.hpp"
#include "../rhi/Texture.hpp"
#include "./MaterialConstants.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../rhi/Shader.hpp"
#include "../../core/Log.hpp"

namespace esengine {

void MaterialStore::undefine(u32 materialId) {
    auto it = materials_.find(materialId);
    if (it == materials_.end()) return;
    if (it->second.ubo != BufferHandle::Invalid && device_) device_->deleteBuffer(it->second.ubo);
    materials_.erase(it);
}

void MaterialStore::clear() {
    if (device_) {
        for (auto& [id, rec] : materials_) {
            if (rec.ubo != BufferHandle::Invalid) device_->deleteBuffer(rec.ubo);
        }
    }
    materials_.clear();
    layouts_.clear();
}

void MaterialStore::recreateGpuResources() {
    // Buffers are dropped, not deleted: they died with the device. The material
    // RECORDS stay, so every materialId the scene refers to still resolves and
    // bindForDraw re-creates the UBO from the parameters it already holds.
    for (auto& [id, rec] : materials_) {
        rec.ubo = BufferHandle::Invalid;
        rec.uboDirty = true;
    }
}

u32 MaterialStore::meshProgram(u32 materialId, resource::ResourceManager& resources,
                               bool withNormals, bool skinned, bool envMapped) const {
    const MaterialRecord* rec = find(materialId);
    if (!rec || !rec->shaderRef.isValid()) return 0;
    // Keyed by shader AND vertex shape: a layout may not declare an attribute its
    // shader ignores, so geometry with normals — or posed by bones — needs its own.
    const u64 key = static_cast<u64>(rec->shaderRef.id())
                  | (withNormals ? (1ull << 32) : 0ull)
                  | (skinned ? (1ull << 33) : 0ull)
                  | (envMapped ? (1ull << 34) : 0ull);

    auto cached = mesh_programs_.find(key);
    if (cached != mesh_programs_.end()) return cached->second;

    auto src = sources_.find(rec->shaderRef.id());
    if (src == sources_.end()) {
        mesh_programs_[key] = 0;
        return 0;
    }

    // The SAME source and features plus MESH: the author's fragment is untouched
    // and only the engine's vertex stage changes, which is what makes this one
    // material rather than two that must be kept in step.
    resource::ParsedShader parsed = resource::ShaderParser::parse(src->second.source);
    std::vector<std::string> features = resource::ShaderParser::splitFeatures(src->second.features);
    features.push_back("MESH");
    if (withNormals) features.push_back("MESH_NORMALS");
    if (skinned) features.push_back("SKINNED");
    // Resident geometry carries the frame's shadow map on its own slot 2 and the
    // reflection on slot 3; the batch variant of the same material must not, which
    // is why these ride the mesh path.
    features.push_back("ES_RECEIVE_SHADOW");
    if (envMapped) features.push_back("ES_ENV_MAP");
    const auto target = resources.preferredShaderTarget();
    const std::string vert = resource::ShaderParser::assembleStage(
        parsed, resource::ShaderStage::Vertex, "", features, target);
    const std::string frag = resource::ShaderParser::assembleStage(
        parsed, resource::ShaderStage::Fragment, "", features, target);
    // Only a shader whose vertex stage is the ENGINE's can be retargeted: one that
    // writes its own decides how a vertex reaches clip space, and adding MESH to it
    // would compile a program that still ignores the per-object transform.
    if (!parsed.vertexIsCanonical) {
        ES_LOG_WARN("MaterialStore: material {} writes its own vertex stage, so it cannot draw "
                    "resident geometry (only a shader on the engine's vertex stage can)", materialId);
        mesh_programs_[key] = 0;
        return 0;
    }
    if (!parsed.valid || vert.empty() || frag.empty()) {
        ES_LOG_WARN("MaterialStore: no mesh variant for material {} ({})",
                    materialId, parsed.valid ? "stage assembly failed" : parsed.errorMessage);
        mesh_programs_[key] = 0;
        return 0;
    }

    resource::ShaderHandle handle = resources.createShader(vert, frag, /*rewriteLoose=*/false,
                                                           resources.preferredShaderLanguage());
    Shader* shader = resources.getShader(handle);
    if (!shader || !shader->isValid()) {
        mesh_programs_[key] = 0;
        return 0;
    }
    // Same sampler seeding the batch variant gets: GLSL ES 300 has no
    // layout(binding=), so each program points its texture params at their units.
    if (shader->language() == GfxShaderLanguage::GLSL_ES300) {
        shader->bind();
        for (const auto& p : parsed.properties) {
            if (p.fromParam && p.type == resource::ShaderPropertyType::Texture && p.textureUnit >= 0) {
                shader->setUniform(p.name, static_cast<i32>(p.textureUnit));
            }
        }
        shader->unbind();
    }
    // No layout of its own: uniforms pack through the material's shaderRef, and
    // this variant declares the same params, so its handle is never looked up.
    const u32 program = shader->getProgramId();
    mesh_programs_[key] = program;
    return program;
}

void MaterialStore::refreshShaderPrograms(resource::ResourceManager& resources) {
    // The cached program id is the one thing a record holds that the device can
    // invalidate; shaderRef is what makes recomputing it possible at all.
    for (auto& [id, rec] : materials_) {
        rec.shader = 0;
        if (Shader* shader = resources.getShader(rec.shaderRef)) rec.shader = shader->getProgramId();
    }
}

void MaterialStore::bindForDraw(u32 materialId) {
    if (!device_) return;
    auto it = materials_.find(materialId);
    if (it == materials_.end()) return;
    MaterialRecord& rec = it->second;

    auto lit = layouts_.find(rec.shaderRef.id());
    if (lit != layouts_.end()) ensureDefaults(rec, lit->second);

    // Per-material constants UBO (binding 1) — present only when the shader declares params.
    if (!rec.uboBytes.empty()) {
        const u32 byteSize = static_cast<u32>(rec.uboBytes.size());
        if (rec.ubo == BufferHandle::Invalid) {
            rec.ubo = device_->createBuffer({GfxBufferUsage::Uniform, byteSize, /*dynamic=*/true},
                                            rec.uboBytes.data());
            rec.uboDirty = false;
        } else if (rec.uboDirty) {
            // Full re-spec (not a sub-update): orphans the old store so a draw still
            // reading it does not stall the upload.
            device_->resizeBuffer(rec.ubo, byteSize, rec.uboBytes.data());
            rec.uboDirty = false;
        }
        device_->setUniformBuffer(MATERIAL_CONSTANTS_BINDING, rec.ubo);
    }

    // Texture params — bound to their sampler units (>= MATERIAL_TEXTURE_UNIT_BASE), above the
    // batch path's 0..7. Iterate the shader's layout (not just the material's explicit bindings)
    // so an unset param binds its declared default (white/black/flatnormal) instead of sampling
    // whatever stale texture is at the unit.
    if (lit != layouts_.end()) {
        for (const auto& slot : lit->second.textures) {
            TextureHandle gpu = builtinDefault(slot.defaultTexture);
            for (const auto& b : rec.textures) {
                if (b.unit != slot.unit) continue;
                // Resolved HERE rather than cached at set time. A pool lookup is
                // an array index next to the GL call it precedes, and it is what
                // lets a texture re-uploaded behind its handle reach the material.
                if (resources_) {
                    if (Texture* texture = resources_->getTexture(b.texture)) {
                        gpu = texture->handle();
                    }
                }
                break;
            }
            if (gpu != TextureHandle::Invalid) device_->bindTexture(slot.unit, gpu);
        }
    }
}

TextureHandle MaterialStore::builtinDefault(MaterialDefaultTexture which) const {
    switch (which) {
    case MaterialDefaultTexture::Black:      return defaultBlack_;
    case MaterialDefaultTexture::FlatNormal: return defaultFlatNormal_;
    case MaterialDefaultTexture::White:      break;
    }
    return defaultWhite_;
}

}  // namespace esengine
