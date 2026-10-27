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
#include "../rhi/ShaderEmbeds.generated.hpp"

#include <cstdlib>

namespace esengine {

MaterialStore::~MaterialStore() {
    clear();
    if (resources_) resources_->clearShaderRetiredCallback(this);
}

void MaterialStore::setResourceManager(resource::ResourceManager* resources) {
    if (resources_ == resources) return;
    if (resources_) { clear(); resources_->clearShaderRetiredCallback(this); }
    resources_ = resources;
    if (resources_) resources_->setShaderRetiredCallback(this, [](void* owner, resource::ShaderHandle shader) {
        static_cast<MaterialStore*>(owner)->forgetShader(shader);
    });
}

void MaterialStore::forgetShader(resource::ShaderHandle shader) {
    layouts_.erase(shader.id());
    sources_.erase(shader.id());
    auto found = mesh_programs_.find(shader.id());
    if (found == mesh_programs_.end()) return;
    auto variants = std::move(found->second);
    mesh_programs_.erase(found);
    // Detach before returning handles: their retirement can notify this store again.
    if (resources_) for (const auto& [shape, handle] : variants) resources_->releaseShader(handle);
}

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
    sources_.clear();
    auto variants = std::move(mesh_programs_);
    mesh_programs_.clear();
    if (resources_) for (const auto& [source, programs] : variants)
        for (const auto& [shape, handle] : programs) resources_->releaseShader(handle);
}

u32 MaterialStore::meshProgram(u32 materialId, resource::ResourceManager& resources,
                               bool withNormals, bool skinned, bool envMapped,
                               bool lightmapped, bool gbuffer, bool tangents, bool tipPass) const {
    // Only for a shader that has something to write: one that never mentions the feature would
    // compile the same program twice and then be declared to write an output it does not have.
    if (gbuffer) {
        const MaterialRecord* rec = find(materialId);
        const auto src = rec && rec->shaderRef.isValid() ? sources_.find(rec->shaderRef.id()) : sources_.end();
        gbuffer = src != sources_.end() && src->second.mentionsGbuffer;
    }
    // Keyed by shader AND vertex shape: a layout may not declare an attribute its
    // shader ignores, so geometry with normals — or posed by bones — needs its own.
    const u64 shape = (withNormals ? (1ull << 32) : 0ull)
                    | (skinned ? (1ull << 33) : 0ull)
                    | (envMapped ? (1ull << 34) : 0ull)
                    | (lightmapped ? (1ull << 36) : 0ull)
                    | (gbuffer ? (1ull << 38) : 0ull)
                    | (tangents && withNormals ? (1ull << 39) : 0ull)
                    | (tipPass ? (1ull << 40) : 0ull);
    // A program already made for this shader and vertex shape is the answer, and almost every draw of a frame asks for one: it is looked up before
    // the feature list is built, since building it (nine strings and the vector that holds them) was most of what a cached answer cost.
    if (const MaterialRecord* rec = find(materialId); rec && rec->shaderRef.isValid()) {
        if (const auto bucket = mesh_programs_.find(rec->shaderRef.id()); bucket != mesh_programs_.end()) {
            if (const auto hit = bucket->second.find(shape); hit != bucket->second.end()) {
                const Shader* shader = resources.getShader(hit->second);
                const u32 cached = shader ? shader->getProgramId() : 0;
                if (gbuffer && cached != 0) gbuffer_programs_.insert(cached);
                return cached;
            }
        }
    }
    std::vector<std::string> features{ "MESH" };
    if (withNormals) features.push_back("MESH_NORMALS");
    if (skinned) features.push_back("SKINNED");
    if (lightmapped) features.push_back("MESH_LIGHTMAP");
    if (tangents && withNormals) features.push_back("MESH_TANGENTS");
    // Resident geometry carries the frame's shadow map on its own slot 2 and the
    // reflection on slot 3; the batch variant of the same material must not, which
    // is why these ride the mesh path.
    features.push_back("ES_RECEIVE_SHADOW");
    if (envMapped) features.push_back("ES_ENV_MAP");
    // As above: this vertex source gives the fragment a real world position, so a
    // positional light is read from where it is rather than from the plane.
    features.push_back("ES_SURFACE_3D");
    if (gbuffer) features.push_back("ES_GBUFFER");
    if (tipPass) features.push_back("ES_TIP_PASS");
    const u32 program = variantProgram(materialId, resources, shape, features, "resident geometry");
    if (gbuffer && program != 0) gbuffer_programs_.insert(program);
    return program;
}

u32 MaterialStore::shadowProgram(u32 materialId, resource::ResourceManager& resources,
                                  bool withNormals, bool skinned, bool tangents) const {
    const MaterialRecord* rec = find(materialId);
    if (!rec || !rec->shaderRef.isValid()) return 0;
    const u64 shape = (1ull << 37) | (withNormals ? (1ull << 32) : 0ull) | (skinned ? (1ull << 33) : 0ull)
                    | (tangents && withNormals ? (1ull << 39) : 0ull);
    auto& variants = mesh_programs_[rec->shaderRef.id()];
    auto cached = variants.find(shape);
    if (cached != variants.end()) {
        const Shader* shader = resources.getShader(cached->second);
        return shader ? shader->getProgramId() : 0;
    }
    auto src = sources_.find(rec->shaderRef.id());
    if (src == sources_.end()) {
        variants[shape] = {};
        return 0;
    }

    // The engine's mesh depth shader, handed the material's hook and the block it reads. The
    // material's own fragment is not used: a shadow map wants depth, not colour.
    const resource::ParsedShader material = resource::ShaderParser::parse(src->second.source);
    resource::ParsedShader depth = resource::ShaderParser::parse(ShaderEmbeds::MESH);
    const bool hooked = !material.vertexHook.empty();
    const bool cutout = material.coverageParam == "u_alphaCutoff";
    if (!material.valid || !depth.valid || (!hooked && !cutout)) {
        variants[shape] = {};
        return 0;
    }
    depth.properties = material.properties;
    depth.materialBlockSize = material.materialBlockSize;
    depth.vertexHook = material.vertexHook;
    depth.wgslVertexHook = material.wgslVertexHook;

    std::vector<std::string> features;
    if (withNormals) features.emplace_back("MESH_NORMALS");
    // A depth pass has no use for a tangent frame, and the vertex stage of SHADOW_DEPTH does not write the varying the fragment prelude would then read.
    // The variant is still keyed by `tangents` so a mesh with and without them keeps its own program.
    if (skinned) features.emplace_back("SKINNED");
    features.emplace_back("SHADOW_DEPTH");
    if (hooked) features.emplace_back("ES_MATERIAL_VERTEX");
    if (cutout) features.emplace_back("SHADOW_ALPHA");
    const auto target = resources.preferredShaderTarget();
    const std::string vert = resource::ShaderParser::assembleStage(depth, resource::ShaderStage::Vertex, "", features, target);
    const std::string frag = resource::ShaderParser::assembleStage(depth, resource::ShaderStage::Fragment, "", features, target);
    if (vert.empty() || frag.empty()) {
        ES_LOG_WARN("MaterialStore: no shadow program for material {} (stage assembly failed)", materialId);
        variants[shape] = {};
        return 0;
    }
    // Deferred: the program is waited for by the first draw that uses it, so the programs a frame asks for together compile together.
    resource::ShaderHandle handle = resources.createShaderWithBindings(vert, frag, {}, resources.preferredShaderLanguage(), /*deferLink=*/true);
    Shader* shader = resources.getShader(handle);
    if (!shader || !shader->isValid()) {
        resources.releaseShader(handle);
        variants[shape] = {};
        return 0;
    }
    // The samplers the hook reads (the terrain's height pages) sit on the units the material declares them on; a program left unseeded reads unit 0.
    seedSamplers(*shader, material);
    const u32 program = shader->getProgramId();
    variants[shape] = handle;
    return program;
}

u32 MaterialStore::prepassCoverageProgram(u32 materialId, resource::ResourceManager& resources,
                                          bool withNormals, bool skinned, bool tangents) const {
    const MaterialRecord* rec = find(materialId);
    if (!rec || !rec->shaderRef.isValid()) return 0;
    const u64 shape = (1ull << 41) | (withNormals ? (1ull << 32) : 0ull) | (skinned ? (1ull << 33) : 0ull)
                    | (tangents && withNormals ? (1ull << 39) : 0ull);
    auto& variants = mesh_programs_[rec->shaderRef.id()];
    auto cached = variants.find(shape);
    if (cached != variants.end()) {
        const Shader* shader = resources.getShader(cached->second);
        return shader ? shader->getProgramId() : 0;
    }
    auto src = sources_.find(rec->shaderRef.id());
    if (src == sources_.end()) {
        variants[shape] = {};
        return 0;
    }
    const resource::ParsedShader material = resource::ShaderParser::parse(src->second.source);
    resource::ParsedShader depth = resource::ShaderParser::parse(ShaderEmbeds::MESH);
    // The Model shader's coverage is what the depth fragment reproduces, and a hook would move vertices the colour pass moves its own way.
    if (!material.valid || !depth.valid || material.name != "Model" || material.coverageParam != "u_alphaCutoff" || !material.vertexHook.empty()) {
        variants[shape] = {};
        return 0;
    }
    depth.properties = material.properties;
    depth.materialBlockSize = material.materialBlockSize;

    std::vector<std::string> features;
    if (withNormals) features.emplace_back("MESH_NORMALS");
    if (skinned) features.emplace_back("SKINNED");
    features.emplace_back("SHADOW_DEPTH");
    features.emplace_back("PREPASS_COVERAGE");
    const auto target = resources.preferredShaderTarget();
    const std::string vert = resource::ShaderParser::assembleStage(depth, resource::ShaderStage::Vertex, "", features, target);
    const std::string frag = resource::ShaderParser::assembleStage(depth, resource::ShaderStage::Fragment, "", features, target);
    if (vert.empty() || frag.empty()) {
        ES_LOG_WARN("MaterialStore: no prepass program for material {} (stage assembly failed)", materialId);
        variants[shape] = {};
        return 0;
    }
    resource::ShaderHandle handle = resources.createShaderWithBindings(vert, frag, {}, resources.preferredShaderLanguage(), /*deferLink=*/true);
    Shader* shader = resources.getShader(handle);
    if (!shader || !shader->isValid()) {
        resources.releaseShader(handle);
        variants[shape] = {};
        return 0;
    }
    const u32 program = shader->getProgramId();
    variants[shape] = handle;
    return program;
}

u32 MaterialStore::particleProgram(u32 materialId, resource::ResourceManager& resources) const {
    return variantProgram(materialId, resources, 1ull << 35, { "PARTICLE" }, "particles");
}

u32 MaterialStore::variantProgram(u32 materialId, resource::ResourceManager& resources,
                                  u64 shape, std::vector<std::string> extraFeatures,
                                  const char* what) const {
    const MaterialRecord* rec = find(materialId);
    if (!rec || !rec->shaderRef.isValid()) return 0;
    auto& variants = mesh_programs_[rec->shaderRef.id()];
    auto cached = variants.find(shape);
    if (cached != variants.end()) {
        const Shader* shader = resources.getShader(cached->second);
        return shader ? shader->getProgramId() : 0;
    }

    auto src = sources_.find(rec->shaderRef.id());
    if (src == sources_.end()) {
        variants[shape] = {};
        return 0;
    }

    // The SAME source and features plus this vertex source's: the author's
    // fragment is untouched and only the engine's vertex stage changes, which is
    // what makes this one material rather than two that must be kept in step.
    resource::ParsedShader parsed = resource::ShaderParser::parse(src->second.source);
    std::vector<std::string> features = resource::ShaderParser::splitFeatures(src->second.features);
    for (auto& f : extraFeatures) features.push_back(std::move(f));
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
                    "{} (only a shader on the engine's vertex stage can)", materialId, what);
        variants[shape] = {};
        return 0;
    }
    // A full WGSL vertex twin is a translation of the BATCH vertex stage, frozen
    // into the file: compiled for this source it reads attributes the layout does
    // not have, and the device rejects the pipeline.
    const auto fullVertex = parsed.wgslStageFull.find(resource::ShaderStage::Vertex);
    if (target == resource::ShaderTargetLanguage::WGSL
        && fullVertex != parsed.wgslStageFull.end() && fullVertex->second) {
        ES_LOG_WARN("MaterialStore: material {} carries a generated WGSL vertex stage, so it "
                    "cannot draw {} — regenerate its twin", materialId, what);
        variants[shape] = {};
        return 0;
    }
    if (!parsed.valid || vert.empty() || frag.empty()) {
        ES_LOG_WARN("MaterialStore: no {} variant for material {} ({})",
                    what, materialId, parsed.valid ? "stage assembly failed" : parsed.errorMessage);
        variants[shape] = {};
        return 0;
    }

    resource::ShaderHandle handle = resources.createShader(vert, frag, /*rewriteLoose=*/false,
                                                           resources.preferredShaderLanguage(), /*deferLink=*/true);
    Shader* shader = resources.getShader(handle);
    if (!shader || !shader->isValid()) {
        resources.releaseShader(handle);
        variants[shape] = {};
        return 0;
    }
    seedSamplers(*shader, parsed);
    // No layout of its own: uniforms pack through the material's shaderRef, and
    // this variant declares the same params, so its handle is never looked up.
    const u32 program = shader->getProgramId();
    variants[shape] = handle;
    return program;
}

namespace {

/// Float component count for a std140 param type (textures have no block slot).
u32 paramArity(resource::ShaderPropertyType t) {
    using PT = resource::ShaderPropertyType;
    switch (t) {
        case PT::Float: case PT::Int: return 1;
        case PT::Vec2: return 2;
        case PT::Vec3: return 3;
        case PT::Vec4: case PT::Color: return 4;
        default: return 0;
    }
}

}  // namespace

MaterialUniformLayout MaterialStore::layoutOf(const resource::ParsedShader& parsed) {
    MaterialUniformLayout layout;
    layout.blockSize = parsed.materialBlockSize;
    layout.coverageParam = parsed.coverageParam;
    layout.tipParam = parsed.tipParam;
    layout.hairShadowParam = parsed.hairShadowParam;
    layout.usesGBuffer = parsed.usesGBuffer;
    layout.usesLights = parsed.usesLights;
    layout.highPrecision = parsed.highPrecision;
    layout.name = parsed.name;
    layout.vertexBounds = parsed.vertexBounds;
    layout.vertexHook = !parsed.vertexHook.empty();
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
            MaterialParamSlot slot{ p.name, static_cast<u32>(p.std140Offset), paramArity(p.type) };
            // default(a,b,c,d) csv -> the slot's initial block value.
            // A trailing comma ends the list, as a stream's getline would: no empty last field.
            usize at = 0;
            for (u32 i = 0; i < slot.arity && at < p.defaultValue.size(); ++i) {
                usize comma = p.defaultValue.find(',', at);
                if (comma == std::string::npos) comma = p.defaultValue.size();
                slot.defaults[i] = std::strtof(p.defaultValue.substr(at, comma - at).c_str(), nullptr);
                at = comma + 1;
            }
            layout.params.push_back(slot);
        }
    }
    return layout;
}


void MaterialStore::seedSamplers(Shader& shader, const resource::ParsedShader& parsed) {
    if (shader.language() != GfxShaderLanguage::GLSL_ES300) return;
    std::vector<std::pair<std::string, i32>> seeds;
    for (const auto& p : parsed.properties) {
        if (p.fromParam && p.type == resource::ShaderPropertyType::Texture && p.textureUnit >= 0) {
            seeds.emplace_back(p.name, static_cast<i32>(p.textureUnit));
        }
    }
    // After the program links, which for one made with deferLink is when something first needs it.
    shader.whenLinked([seeds = std::move(seeds)](Shader& s) {
        s.bind();
        for (const auto& [name, unit] : seeds) s.setUniform(name, unit);
        s.unbind();
    });
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
                                            GfxContent::retained(), rec.uboBytes.data());
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
            // What stood behind this draw, where the frame took a copy of it; a material that named a texture there keeps its own.
            if (sceneColor_ != TextureHandle::Invalid && slot.name == "u_sceneColor") gpu = sceneColor_;
            if (sceneDepth_ != TextureHandle::Invalid && slot.name == "u_sceneDepthMap") gpu = sceneDepth_;
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
