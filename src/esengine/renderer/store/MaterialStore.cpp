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
    // Texture bindings are NOT covered and cannot be from here: setTexture
    // resolves a resource::TextureHandle to a raw GPU id at call time, so the
    // record no longer knows which texture it meant.
}

void MaterialStore::bindForDraw(u32 materialId) {
    if (!device_) return;
    auto it = materials_.find(materialId);
    if (it == materials_.end()) return;
    MaterialRecord& rec = it->second;

    auto lit = layouts_.find(rec.shader);
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
