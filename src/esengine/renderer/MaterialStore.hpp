// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
 *            Licensed under the PolyForm Noncommercial License 1.0.0.
 */
#pragma once

#include "../core/Types.hpp"
#include "BlendMode.hpp"

#include <algorithm>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {

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
};

/** @brief A texture param's sampler unit (>= MATERIAL_TEXTURE_UNIT_BASE, above the batch's 0..7). */
struct MaterialTextureSlot {
    std::string name;
    u32 unit = 0;
    /// GL texture bound when a material leaves this param unset — the shader's declared
    /// `default(white|black|flatnormal)`. Resolved once when the layout is registered.
    u32 defaultGlTexture = 0;
};

/** @brief A material's bound texture: the GL texture id at a sampler unit. */
struct MaterialTextureBinding {
    u32 unit = 0;
    u32 glTexture = 0;
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
    u32 shader = 0;  ///< Shader program; 0 means "use the path's default batch shader".
    BlendMode blend = BlendMode::Normal;
    bool depthTest = false;
    bool depthWrite = true;
    CullMode cull = CullMode::None;

    /// Packed std140 MaterialConstants payload (sized to the shader's blockSize), the GPU
    /// UBO it uploads to (lazy), and whether the bytes changed since the last upload.
    std::vector<u8> uboBytes;
    u32 ubo = 0;
    bool uboDirty = false;

    /// Texture params bound to sampler units (GL texture ids, resolved at set time).
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

    /// Registers (or replaces) a shader's MaterialConstants layout — called when a shader
    /// authored with #pragma param is compiled, so materials on it can pack their uniforms.
    void registerLayout(u32 shaderId, MaterialUniformLayout layout) {
        if (shaderId != 0) layouts_[shaderId] = std::move(layout);
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
        const bool shaderChanged = rec.shader != record.shader;
        const u32 ubo = rec.ubo;
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
        auto lit = layouts_.find(rec.shader);
        if (lit == layouts_.end()) return;
        const MaterialParamSlot* slot = lit->second.find(name);
        if (!slot) return;
        if (rec.uboBytes.size() < lit->second.blockSize) {
            rec.uboBytes.resize(lit->second.blockSize, 0);
        }
        const u32 n = std::min(arity, slot->arity);
        std::memcpy(rec.uboBytes.data() + slot->offset, values, n * sizeof(f32));
        rec.uboDirty = true;
    }

    /// Binds a GL texture id to a named texture param's sampler unit. No-op if the material,
    /// its layout, or the texture param is unknown. Render path binds it in bindForDraw.
    void setTexture(u32 materialId, const std::string& name, u32 glTexture) {
        auto it = materials_.find(materialId);
        if (it == materials_.end()) return;
        auto lit = layouts_.find(it->second.shader);
        if (lit == layouts_.end()) return;
        const MaterialTextureSlot* slot = lit->second.findTexture(name);
        if (!slot) return;
        for (auto& b : it->second.textures) {
            if (b.unit == slot->unit) { b.glTexture = glTexture; return; }
        }
        it->second.textures.push_back({ slot->unit, glTexture });
    }

    void undefine(u32 materialId);

    /// The record for @p materialId, or nullptr if the handle is 0 / unregistered.
    const MaterialRecord* find(u32 materialId) const {
        if (materialId == 0) return nullptr;
        auto it = materials_.find(materialId);
        return it != materials_.end() ? &it->second : nullptr;
    }

    /// Uploads (when dirty) and binds the material's MaterialConstants UBO at binding 1.
    /// No-op for materials whose shader declares no params (uboBytes stays empty).
    void bindForDraw(u32 materialId);

    /// Frees every per-material GPU UBO and clears all records/layouts. Call while the
    /// device is still valid (RenderContext::shutdown).
    void clear();

private:
    std::unordered_map<u32, MaterialRecord> materials_;
    std::unordered_map<u32, MaterialUniformLayout> layouts_;
    GfxDevice* device_ = nullptr;
};

}  // namespace esengine
