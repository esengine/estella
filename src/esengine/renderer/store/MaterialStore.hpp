// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialStore.hpp
 * @brief   Engine-side material registry — the resolved "how to draw" for a material handle.
 * @details A material is a first-class engine object: the SDK pushes its resolved render
 *          state here (defineMaterial) when the material is created or edited, and the
 *          render path looks it up by the handle a component carries (e.g. Sprite::material).
 *          This replaces the dead pull-callback + cache, where C++ called back into JS per
 *          material and the resolved data never reached a draw.
 *
 *          Per-material shader parameters live in a std140 MaterialConstants UBO (binding 1):
 *          a shader authored with `#pragma param` registers its layout here, and setUniform
 *          packs named values into the material's byte buffer by reflected offset. The render
 *          path uploads (when dirty) and binds that UBO per draw via bindForDraw.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../resource/Handle.hpp"
#include "../draw/BlendMode.hpp"
#include "../rhi/GfxEnums.hpp"

#include <algorithm>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {

namespace resource { class ResourceManager; }


class GfxDevice;

/** @brief Triangle culling mode baked into a material's pipeline. */
enum class CullMode : u8 {
    None = 0,
    Back = 1,
    Front = 2,
};

/** @brief One scalar/vector param's slot in a shader's std140 MaterialConstants block. */
struct MaterialParamSlot {
    std::string name;
    u32 offset = 0;  ///< std140 byte offset within the block.
    u32 arity = 1;   ///< Float component count (1..4); textures are not slots.
    f32 defaults[4] = {0, 0, 0, 0};  ///< Shader-declared default(...); the block's initial value.
};

/** @brief Which built-in texture a param falls back to when a material leaves it unset. */
enum class MaterialDefaultTexture : u8 { White, Black, FlatNormal };

/** @brief Maps a shader's declared `default(<name>)` to the built-in it names. */
inline MaterialDefaultTexture materialDefaultByName(const std::string& name) {
    if (name == "black") return MaterialDefaultTexture::Black;
    if (name == "flatnormal" || name == "normal") return MaterialDefaultTexture::FlatNormal;
    return MaterialDefaultTexture::White;  // "white" / empty / unknown
}

/** @brief A texture param's sampler unit (>= MATERIAL_TEXTURE_UNIT_BASE, above the batch's 0..7). */
struct MaterialTextureSlot {
    std::string name;
    u32 unit = 0;
    /// The shader's declared `default(white|black|flatnormal)`, kept as the CHOICE
    /// rather than the resolved id: the built-ins are re-created when the device
    /// is, and an id resolved at registration would outlive the texture it names.
    MaterialDefaultTexture defaultTexture = MaterialDefaultTexture::White;
};

/** @brief A material's bound texture at a sampler unit. */
struct MaterialTextureBinding {
    u32 unit = 0;
    /// The resource handle, NOT a resolved GPU id. Resolving at bind time is what
    /// lets the texture behind it be re-uploaded — by a hot update, or by a device
    /// loss — without every material that references it having to be re-bound.
    resource::TextureHandle texture;
};

/** @brief A shader's layout: std140 block (scalar/vector params) + texture sampler slots. */
struct MaterialUniformLayout {
    u32 blockSize = 0;
    std::vector<MaterialParamSlot> params;
    std::vector<MaterialTextureSlot> textures;

    const MaterialParamSlot* find(const std::string& name) const {
        for (const auto& p : params) {
            if (p.name == name) return &p;
        }
        return nullptr;
    }
    const MaterialTextureSlot* findTexture(const std::string& name) const {
        for (const auto& t : textures) {
            if (t.name == name) return &t;
        }
        return nullptr;
    }
};

/**
 * @brief A material's resolved render state (P0) plus its packed std140 constants (P1).
 */
struct MaterialRecord {
    /// The identity: what the layout is filed under, and what survives the
    /// program being rebuilt. `shader` below caches what it currently resolves
    /// to, because the collect path reads that per entity.
    resource::ShaderHandle shaderRef;
    u32 shader = 0;  ///< Program id; 0 means "use the path's default batch shader".
    BlendMode blend = BlendMode::Normal;
    bool depthTest = false;
    bool depthWrite = true;
    CullMode cull = CullMode::None;

    /// Packed std140 MaterialConstants payload (sized to the shader's blockSize), the GPU
    /// UBO it uploads to (lazy), and whether the bytes changed since the last upload.
    std::vector<u8> uboBytes;
    BufferHandle ubo = BufferHandle::Invalid;
    bool uboDirty = false;

    /// Texture params bound to sampler units, by handle (see MaterialTextureBinding).
    std::vector<MaterialTextureBinding> textures;
};

/**
 * @brief Maps a material handle to its resolved record. Owned by RenderContext so it is
 *        reachable from both the SDK binding (push) and the render collect path (read).
 */
class MaterialStore {
public:
    /// The render path uses this device to create/upload/delete per-material UBOs.
    void setDevice(GfxDevice* device) { device_ = device; }

    /// Resolves texture handles at bind time; without one, texture params bind nothing.
    void setResourceManager(resource::ResourceManager* resources) { resources_ = resources; }

    /// The context's current built-in fallbacks. Pushed rather than cached from a
    /// resolved id, so re-creating them after a device loss reaches the materials too.
    void setBuiltinDefaults(TextureHandle white, TextureHandle black, TextureHandle flatNormal) {
        defaultWhite_ = white;
        defaultBlack_ = black;
        defaultFlatNormal_ = flatNormal;
    }

    /// The context's current fallback for a declared `default(...)`. One authority,
    /// so the post-process pipeline's params fall back to the same textures.
    TextureHandle builtinDefault(MaterialDefaultTexture which) const;

    /// Drops every material UBO after a device loss, keeping the records so the
    /// scene's materialIds stay meaningful. See the definition.
    void recreateGpuResources();

    /// Re-resolves each material's cached program id from its shader handle, after
    /// the device rebuilt the programs behind them.
    void refreshShaderPrograms(resource::ResourceManager& resources);

    /// Keeps a material shader's SOURCE beside its handle, so the same material can
    /// be compiled for another vertex source later. Without it the store holds only
    /// the assembled program and a variant would need the author's file again.
    void rememberSource(resource::ShaderHandle shader, std::string source, std::string features) {
        if (shader.isValid()) sources_[shader.id()] = { std::move(source), std::move(features) };
    }

    /// The program that draws @p materialId on GPU-RESIDENT geometry, compiled on
    /// first use and cached. @p withNormals selects the variant for geometry that
    /// carries them, @p skinned the one posed by bones instead of a per-object
    /// matrix. 0 when the material's source was never kept or the variant fails —
    /// the caller then falls back rather than drawing it wrong.
    u32 meshProgram(u32 materialId, resource::ResourceManager& resources,
                    bool withNormals = false, bool skinned = false,
                    bool envMapped = false) const;

    /// Registers (or replaces) a shader's MaterialConstants layout — called when a shader
    /// authored with #pragma param is compiled, so materials on it can pack their uniforms.
    /// Filed under the HANDLE, not the program id: rebuilding the program (a
    /// device loss, a shader reload) changes the id, and a layout filed under the
    /// old one would be unreachable from the material that still names it.
    void registerLayout(resource::ShaderHandle shader, MaterialUniformLayout layout) {
        if (shader.isValid()) layouts_[shader.id()] = std::move(layout);
    }

    /// Pushes a material's resolved render state. Preserves any already-packed constants
    /// (an edit such as setBlendMode re-pushes state without clobbering uniforms); a shader
    /// change invalidates the old constants since the layout differs.
    void define(u32 materialId, const MaterialRecord& record) {
        if (materialId == 0) return;
        auto it = materials_.find(materialId);
        if (it == materials_.end()) {
            materials_[materialId] = record;
            return;
        }
        MaterialRecord& rec = it->second;
        const bool shaderChanged = rec.shaderRef != record.shaderRef;
        const BufferHandle ubo = rec.ubo;
        std::vector<u8> bytes = std::move(rec.uboBytes);
        std::vector<MaterialTextureBinding> texs = std::move(rec.textures);
        rec = record;        // render state
        rec.ubo = ubo;       // keep the GPU buffer
        if (shaderChanged) {
            rec.uboBytes.clear();   // old layout invalid; re-packed on next set
            rec.textures.clear();
        } else {
            rec.uboBytes = std::move(bytes);
            rec.textures = std::move(texs);
        }
        rec.uboDirty = true; // re-upload on next bind
    }

    /// Writes a named param's float components into the material's std140 buffer at the
    /// offset its shader's layout reflects. No-op if the material/layout/param is unknown.
    void setUniform(u32 materialId, const std::string& name, const f32* values, u32 arity) {
        auto it = materials_.find(materialId);
        if (it == materials_.end()) return;
        MaterialRecord& rec = it->second;
        auto lit = layouts_.find(rec.shaderRef.id());
        if (lit == layouts_.end()) return;
        const MaterialParamSlot* slot = lit->second.find(name);
        if (!slot) return;
        ensureDefaults(rec, lit->second);
        const u32 n = std::min(arity, slot->arity);
        std::memcpy(rec.uboBytes.data() + slot->offset, values, n * sizeof(f32));
        rec.uboDirty = true;
    }

    /// Binds a texture to a named texture param's sampler unit. No-op if the material,
    /// its layout, or the texture param is unknown. Render path resolves it in bindForDraw.
    void setTexture(u32 materialId, const std::string& name, resource::TextureHandle texture) {
        auto it = materials_.find(materialId);
        if (it == materials_.end()) return;
        auto lit = layouts_.find(it->second.shaderRef.id());
        if (lit == layouts_.end()) return;
        const MaterialTextureSlot* slot = lit->second.findTexture(name);
        if (!slot) return;
        for (auto& b : it->second.textures) {
            if (b.unit == slot->unit) { b.texture = texture; return; }
        }
        it->second.textures.push_back({ slot->unit, texture });
    }

    void undefine(u32 materialId);

    /// The record for @p materialId, or nullptr if the handle is 0 / unregistered.
    const MaterialRecord* find(u32 materialId) const {
        if (materialId == 0) return nullptr;
        auto it = materials_.find(materialId);
        return it != materials_.end() ? &it->second : nullptr;
    }

    /// The registered #pragma-param layout for a shader program, or nullptr.
    /// The post-process pipeline reads it to pack pass params through the same
    /// reflected MaterialConstants block a material would use.
    const MaterialUniformLayout* layoutFor(resource::ShaderHandle shader) const {
        auto it = layouts_.find(shader.id());
        return it != layouts_.end() ? &it->second : nullptr;
    }

    /// Uploads (when dirty) and binds the material's MaterialConstants UBO at binding 1.
    /// No-op for materials whose shader declares no params (uboBytes stays empty).
    void bindForDraw(u32 materialId);

    /// Frees every per-material GPU UBO and clears all records/layouts. Call while the
    /// device is still valid (RenderContext::shutdown).
    void clear();

private:
    /// Fills an unpacked block with the shader's param defaults, so a material that never
    /// sets a param still draws with the declared default(...) values (not zeros).
    static void ensureDefaults(MaterialRecord& rec, const MaterialUniformLayout& layout) {
        if (layout.blockSize == 0 || rec.uboBytes.size() >= layout.blockSize) return;
        rec.uboBytes.resize(layout.blockSize, 0);
        for (const auto& p : layout.params) {
            std::memcpy(rec.uboBytes.data() + p.offset, p.defaults, p.arity * sizeof(f32));
        }
        rec.uboDirty = true;
    }

    std::unordered_map<u32, MaterialRecord> materials_;
    std::unordered_map<u32, MaterialUniformLayout> layouts_;

    /// A material shader's authored source + features, filed under its handle for
    /// the same reason the layout is: a rebuilt program changes the id.
    struct ShaderSource {
        std::string source;
        std::string features;
    };
    std::unordered_map<u32, ShaderSource> sources_;
    /// Handle → the program compiled for the mesh vertex source (0 = tried and
    /// failed). Mutable because compiling it is memoization: the collect path
    /// asks a read-only store, and the answer is the same every time.
    mutable std::unordered_map<u64, u32> mesh_programs_;
    GfxDevice* device_ = nullptr;
    resource::ResourceManager* resources_ = nullptr;
    TextureHandle defaultWhite_ = TextureHandle::Invalid;
    TextureHandle defaultBlack_ = TextureHandle::Invalid;
    TextureHandle defaultFlatNormal_ = TextureHandle::Invalid;
};

}  // namespace esengine
