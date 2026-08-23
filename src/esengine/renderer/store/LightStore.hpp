// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LightStore.hpp
 * @brief   Engine-side 2D light registry — the per-frame LightConstants UBO and its CPU mirror.
 * @details The render collect path clears this each frame, then accumulates the scene's enabled
 *          Light components into it (point/directional into the lights array, ambient summed
 *          into the ambient term). flush() uploads the mirror once and binds it at
 *          LIGHT_CONSTANTS_BINDING, so every Lit shader reads the same lighting UBO. Owned by
 *          RenderContext so both the render path and any future SDK push reach one store / one UBO.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../rhi/GfxEnums.hpp"
#include "./LightConstants.hpp"

#include <glm/glm.hpp>

namespace esengine {

class GfxDevice;

/**
 * @brief Holds the per-frame 2D lights and their GPU UBO. Mirrors MaterialStore's UBO lifecycle
 *        (lazy create, dirty upload, device-owned free).
 */
class LightStore {
public:
    /// The render path uses this device to create/upload/delete the lighting UBO.
    void setDevice(GfxDevice* device) { device_ = device; }

    /// Forgets the UBO after a device loss WITHOUT deleting it — the buffer died
    /// with the device, and the upload path creates a fresh one on demand.
    void recreateGpuResources() {
        ubo_ = BufferHandle::Invalid;
        dirty_ = true;
    }

    /// Begins a frame's collection: zeroes ambient + all light slots (inactive slots contribute
    /// nothing because their intensity is 0) and marks the UBO for re-upload.
    void clear() {
        data_ = LightConstants{};
        count_ = 0;
        hasEnvironment_ = false;
        dirty_ = true;
    }

    /// Adds an ambient term (rgb already scaled by intensity). Ambient lights sum rather than
    /// occupy a slot. The alpha tracks the active non-ambient light count for shader early-out.
    void addAmbient(const glm::vec3& color) {
        data_.ambient.x += color.x;
        data_.ambient.y += color.y;
        data_.ambient.z += color.z;
        dirty_ = true;
    }

    /// Appends a point/directional light. Silently drops past MAX_LIGHTS (the fixed shader loop
    /// bound); callers keep the most significant lights first if they exceed the cap.
    void addLight(const GpuLight& light) {
        if (count_ >= MAX_LIGHTS) return;
        data_.lights[count_++] = light;
        data_.ambient.w = static_cast<f32>(count_);
        dirty_ = true;
    }

    /// Hands over the shadow tiles a frame rendered: per tile a world -> clip matrix
    /// and the atlas rect it was drawn into (bias in w), plus the params whose x is
    /// the master switch. Zeroed when nothing cast, so no matrix outlives its map.
    void setShadowTiles(const glm::mat4* matrices, const glm::vec4* tiles, u32 count,
                        const glm::vec4& params) {
        for (u32 i = 0; i < MAX_SHADOW_TILES; ++i) {
            data_.shadowMatrix[i] = i < count ? matrices[i] : glm::mat4(1.0f);
            data_.shadowTile[i] = i < count ? tiles[i] : glm::vec4(0.0f);
        }
        data_.shadowParams = params;
        dirty_ = true;
    }

    /// Names the atlas tiles light @p slot casts into. What lets a fragment read the
    /// right map once more than one light has rendered one; a slot nobody names keeps
    /// the zeroed count, which is a light with no map.
    void setLightShadowTiles(u32 slot, u32 first, u32 tiles) {
        if (slot >= count_) return;
        // The two the atlas decides, and nothing else: z is the light's own source size,
        // written when it was collected and not this pass's to overwrite.
        data_.lights[slot].shadowMap.x = static_cast<f32>(first);
        data_.lights[slot].shadowMap.y = static_cast<f32>(tiles);
        dirty_ = true;
    }

    /// Sets the frame's environment: nine irradiance coefficients, the reflection
    /// params, and the tint scaling both. The FIRST ambient light carrying one wins —
    /// several environments do not sum the way flat terms do.
    /// @return false when one was already set this frame.
    bool setEnvironment(const glm::vec3* irradiance, const glm::vec4& params,
                        const glm::vec3& tint) {
        if (hasEnvironment_) return false;
        for (usize i = 0; i < 9; ++i) data_.envIrradiance[i] = glm::vec4(irradiance[i], 0.0f);
        data_.envParams = params;
        data_.envTint = glm::vec4(tint, 0.0f);
        hasEnvironment_ = true;
        dirty_ = true;
        return true;
    }

    bool hasEnvironment() const { return hasEnvironment_; }

    /// Appends a world-space AABB occluder (minX, minY, maxX, maxY). Silently drops past
    /// MAX_OCCLUDERS_2D. With no occluders added, the injected shader shadow test is a no-op.
    void addOccluder(const glm::vec4& box) {
        const u32 n = static_cast<u32>(data_.occluderCount.x);
        if (n >= MAX_OCCLUDERS_2D) return;
        data_.occluders[n] = box;
        data_.occluderCount.x = static_cast<f32>(n + 1);
        dirty_ = true;
    }

    /// Uploads the mirror (when dirty) and binds it at LIGHT_CONSTANTS_BINDING. Called once per
    /// frame in flush(); the binding persists, only the contents change. No-op without a device.
    void uploadAndBind();

    /// Frees the GPU UBO. Call while the device is still valid (RenderContext::shutdown).
    void free();

    u32 count() const { return count_; }
    const LightConstants& data() const { return data_; }

private:
    LightConstants data_{};
    u32 count_ = 0;
    bool hasEnvironment_ = false;
    BufferHandle ubo_ = BufferHandle::Invalid;
    bool dirty_ = true;
    GfxDevice* device_ = nullptr;
};

}  // namespace esengine
