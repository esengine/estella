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

#include <cmath>
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
        tiledCount_ = 0;
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

    /// Appends a light the loop's sixteen did not have room for, to be read through the tile masks: it marks every tile of
    /// @p viewProjection its sphere (@p position, @p radius) can reach. Returns false past MAX_TILED_LIGHTS.
    bool addTiledLight(const GpuLight& light, const glm::mat4& viewProjection, const glm::vec3& position, f32 radius) {
        if (tiledCount_ >= MAX_TILED_LIGHTS) return false;
        data_.tiledLights[tiledCount_] = light;
        markLightTiles(viewProjection, position, radius, tiledCount_, reinterpret_cast<u32(*)[4]>(data_.tileMask));
        ++tiledCount_;
        data_.tileInfo = glm::vec4(static_cast<f32>(tiledCount_), static_cast<f32>(TILE_COLUMNS), static_cast<f32>(TILE_ROWS), 0.0f);
        dirty_ = true;
        return true;
    }

    /// Hides the tiled lights from the passes that follow, which draw through another camera (a planar reflection): their masks
    /// were made for the camera this frame is seen from and would be read by pixels they mean nothing to. A false brings them back.
    void suspendTiled(bool suspended) {
        const f32 count = suspended ? 0.0f : static_cast<f32>(tiledCount_);
        if (data_.tileInfo.x == count) return;
        data_.tileInfo.x = count;
        dirty_ = true;
    }

    u32 tiledCount() const { return tiledCount_; }

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
        // The layer range this light carries above the count is not the atlas's to overwrite either.
        const f32 range = std::floor(data_.lights[slot].shadowMap.y / LIGHT_TILE_BITS);
        data_.lights[slot].shadowMap.x = static_cast<f32>(first);
        data_.lights[slot].shadowMap.y = static_cast<f32>(tiles) + LIGHT_TILE_BITS * range;
        dirty_ = true;
    }

    /// The frame's environment. The FIRST ambient light carrying one wins — several
    /// do not sum the way flat terms do. `yaw` turns it about +Y in RADIANS and rides
    /// in the tint's alpha, which std140 pads into existence whether it is used or not.
    /// @return false when one was already set this frame.
    bool setEnvironment(const glm::vec3* irradiance, const glm::vec4& params,
                        const glm::vec3& tint, f32 yaw) {
        if (hasEnvironment_) return false;
        for (usize i = 0; i < 9; ++i) data_.envIrradiance[i] = glm::vec4(irradiance[i], 0.0f);
        data_.envParams = params;
        data_.envTint = glm::vec4(tint, yaw);
        hasEnvironment_ = true;
        dirty_ = true;
        return true;
    }

    bool hasEnvironment() const { return hasEnvironment_; }

    /**
     * @brief Points the frame at a BAKED atlas: its format, and a box per column.
     *
     * @details Overwrites `envParams` because the atlas the frame binds is this
     *          one — the columns past 0 are the scene's rooms, and column 0 is the
     *          sky as the bake saw it. The irradiance and the tint stay the ambient
     *          light's: the diffuse half is not what a reflection atlas holds.
     */
    void setReflections(const glm::vec4& params, const glm::vec4* boxes, u32 count) {
        data_.envParams = params;
        data_.reflParams.x = static_cast<f32>(count) + 1.0f;
        for (u32 i = 0; i < count * 2 && i < 2 * MAX_REFLECTION_PROBES; ++i) {
            data_.reflBox[i] = boxes[i];
        }
        dirty_ = true;
    }

    /// How baked reflection columns are shown this frame: their brightness and the colour they keep.
    void setReflectionTone(f32 scale, f32 saturation) {
        data_.reflParams.y = scale;
        data_.reflParams.z = saturation;
        dirty_ = true;
    }

    /// What baked indirect light is multiplied by this frame: the day's or the weather's say on a bake of one moment.
    void setBakedTint(const glm::vec3& tint) {
        data_.bakedTint = glm::vec4(tint, 1.0f);
        dirty_ = true;
    }

    /// Gives light @p slot a channel of the frame's 2D shadow mask, and says the mask
    /// exists. A slot nobody names keeps the -1 it was collected with, which is a light
    /// that lights without shadowing.
    void setLightShadow2DChannel(u32 slot, u32 channel) {
        if (slot >= count_ || channel >= MAX_SHADOW_2D_LIGHTS) return;
        data_.lights[slot].shadowMap.w = static_cast<f32>(channel);
        dirty_ = true;
    }

    /// Gives light @p slot a channel of the frame's shape mask. A slot nobody names
    /// keeps -1, which is a light with no shape of its own — it lights a full circle.
    void setLightShape2DChannel(u32 slot, u32 channel) {
        if (slot >= count_ || channel >= MAX_SHAPE_2D_LIGHTS) return;
        data_.lights[slot].falloff.w = static_cast<f32>(channel);
        dirty_ = true;
    }

    /// Where the camera about to draw sits inside the masks (xy = low corner, zw = size,
    /// as fractions of one). A zero size says the frame has none; set per camera,
    /// because two cameras read two different parts of one screen-space target.
    void setMask2DRect(const glm::vec4& rect) {
        data_.mask2DRect = rect;
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
    u32 tiledCount_ = 0;
    bool hasEnvironment_ = false;
    BufferHandle ubo_ = BufferHandle::Invalid;
    bool dirty_ = true;
    GfxDevice* device_ = nullptr;
};

}  // namespace esengine
