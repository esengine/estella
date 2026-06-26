// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "RenderStage.hpp"
#include "RenderItem.hpp"
#include "BlendMode.hpp"
#include "TransientBufferPool.hpp"

#include <algorithm>
#include <cstring>

namespace esengine {

static constexpr u32 MAX_CMD_TEXTURE_SLOTS = 8;

static constexpr u16 CMD_STATE_SCISSOR       = 0x01;
static constexpr u16 CMD_STATE_STENCIL_WRITE = 0x02;
static constexpr u16 CMD_STATE_STENCIL_TEST  = 0x04;
static constexpr u16 CMD_STATE_CUSTOM_DRAW   = 0x08;

struct DrawCommand {
    u64 sort_key = 0;

    u32 index_offset = 0;
    u32 index_count = 0;
    u32 vertex_byte_offset = 0;

    u32 shader_id = 0;
    BlendMode blend_mode = BlendMode::Normal;
    LayoutId layout_id = LayoutId::Batch;

    // The material handle this draw resolved from (0 = none). Identity for sort + merge so
    // distinct materials never coalesce, and the lookup key for per-material GPU state.
    u32 material_id = 0;
    // Pipeline depth/cull state, resolved from the material (or defaults). depth_write stays
    // on with the test off — the engine's 2D state — unless a material overrides it.
    bool depth_test = false;
    bool depth_write = true;
    u8 cull = 0;  ///< CullMode: 0 = none, 1 = back, 2 = front.

    u8 texture_count = 0;
    u32 texture_ids[MAX_CMD_TEXTURE_SLOTS] = {};

    u16 state_flags = 0;
    ScissorRect scissor;
    i32 stencil_ref = 0;

    Entity entity = INVALID_ENTITY;
    RenderType type = RenderType::Sprite;
    i32 layer = 0;
    u32 entity_count = 1;
    bool merged = false;

    // > 0 selects an instanced draw: index_count indices drawn instance_count times,
    // with per-instance attributes based at vertex_byte_offset (see LayoutId::ParticleInstance).
    u32 instance_count = 0;

    // Vertices owned by this command (from vertex_byte_offset). Needed so the merge pass
    // can rewrite their texIndex when coalescing into a multi-texture batch.
    u32 vertex_count = 0;

    // Texture is no longer part of the sort key: dropping it lets draws that differ only
    // by texture sort adjacent and coalesce into one multi-texture batch (up to 8 textures,
    // selected per-vertex in the shader). Order within a layer is otherwise unchanged.
    // Material identity sorts above depth (like shader does) so same-material draws group
    // adjacent for the merge, at the usual batching-over-cross-material-depth tradeoff.
    static u64 buildSortKey(RenderStage stage, i32 layer, u32 shaderId,
                            BlendMode blend, u16 stateFlags, f32 depth, u32 materialId = 0) {
        u64 stageKey = static_cast<u64>(stage) << 60;

        i32 normalizedLayer = std::clamp(layer + 32768, 0, 65535);
        u64 layerKey = static_cast<u64>(normalizedLayer & 0xFFFF) << 44;

        u64 shaderKey = static_cast<u64>(shaderId & 0xFF) << 36;
        u64 blendKey = static_cast<u64>(blend) << 33;
        u64 flagsKey = static_cast<u64>(stateFlags & 0x03) << 31;
        u64 materialKey = (static_cast<u64>(materialId) & 0x1FFFF) << 14;

        u32 depthBits;
        if (stage == RenderStage::Transparent || stage == RenderStage::Overlay) {
            f32 invDepth = 1.0f - (depth * 0.5f + 0.5f);
            depthBits = static_cast<u32>(invDepth * 16383.0f);
        } else {
            f32 normDepth = depth * 0.5f + 0.5f;
            depthBits = static_cast<u32>(normDepth * 16383.0f);
        }
        u64 depthKey = static_cast<u64>(depthBits & 0x3FFF);

        return stageKey | layerKey | shaderKey | blendKey | flagsKey | materialKey | depthKey;
    }

    /** @brief Finds @p texId in this command's texture set, adds it (returns its slot), or
     *         -1 if the set is full. Used by the merge to assign per-vertex sampler slots. */
    i32 addTextureSlot(u32 texId) {
        for (u8 i = 0; i < texture_count; ++i) {
            if (texture_ids[i] == texId) return static_cast<i32>(i);
        }
        if (texture_count >= MAX_CMD_TEXTURE_SLOTS) return -1;
        texture_ids[texture_count] = texId;
        return static_cast<i32>(texture_count++);
    }

    bool canMergeWith(const DrawCommand& next) const {
        // Instanced draws are one command per emitter — never coalesce them.
        if (instance_count != 0 || next.instance_count != 0) return false;
        if (shader_id != next.shader_id) return false;
        if (blend_mode != next.blend_mode) return false;
        if (layout_id != next.layout_id) return false;
        // Same material handle => same uniforms/textures/depth/cull; different ones must not
        // coalesce. material_id 0 (no material) shares the path's defaults, so they still merge.
        if (material_id != next.material_id) return false;
        if (state_flags != next.state_flags) return false;
        if (state_flags & CMD_STATE_SCISSOR) {
            if (scissor != next.scissor) return false;
        }
        if (state_flags & (CMD_STATE_STENCIL_WRITE | CMD_STATE_STENCIL_TEST)) {
            if (stencil_ref != next.stencil_ref) return false;
        }
        // Texture compatibility is decided by the merge (the combined set must fit in 8
        // slots), not here, so different-texture draws can coalesce.
        if (index_offset + index_count != next.index_offset) return false;
        return true;
    }
};

}  // namespace esengine
