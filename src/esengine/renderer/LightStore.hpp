// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LightStore.hpp
 * @brief   Engine-side 2D light registry — the per-frame LightConstants UBO and its CPU mirror.
 * @details The render collect path clears this each frame, then accumulates the scene's enabled
 *          Light2D components into it (point/directional into the lights array, ambient summed
 *          into the ambient term). flush() uploads the mirror once and binds it at
 *          LIGHT_CONSTANTS_BINDING, so every Lit2D shader reads the same lighting UBO. Owned by
 *          RenderContext so both the render path and any future SDK push reach one store / one UBO.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "LightConstants.hpp"

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

    /// Begins a frame's collection: zeroes ambient + all light slots (inactive slots contribute
    /// nothing because their intensity is 0) and marks the UBO for re-upload.
    void clear() {
        data_ = LightConstants{};
        count_ = 0;
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

    /// Appends a point/directional light. Silently drops past MAX_LIGHTS_2D (the fixed shader loop
    /// bound); callers keep the most significant lights first if they exceed the cap.
    void addLight(const GpuLight2D& light) {
        if (count_ >= MAX_LIGHTS_2D) return;
        data_.lights[count_++] = light;
        data_.ambient.w = static_cast<f32>(count_);
        dirty_ = true;
    }

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
    u32 ubo_ = 0;
    bool dirty_ = true;
    GfxDevice* device_ = nullptr;
};

}  // namespace esengine
