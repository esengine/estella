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

    static u64 buildSortKey(RenderStage stage, i32 layer, u32 shaderId,
                            BlendMode blend, u16 stateFlags,
                            u32 textureId, f32 depth) {
        u64 stageKey = static_cast<u64>(stage) << 60;

        i32 normalizedLayer = std::clamp(layer + 32768, 0, 65535);
        u64 layerKey = static_cast<u64>(normalizedLayer & 0xFFFF) << 44;

        u64 shaderKey = static_cast<u64>(shaderId & 0xFF) << 36;
        u64 blendKey = static_cast<u64>(blend) << 33;
        u64 flagsKey = static_cast<u64>(stateFlags & 0x03) << 31;
        u64 texKey = static_cast<u64>(textureId & 0x1FFFF) << 14;

        u32 depthBits;
        if (stage == RenderStage::Transparent || stage == RenderStage::Overlay) {
            f32 invDepth = 1.0f - (depth * 0.5f + 0.5f);
            depthBits = static_cast<u32>(invDepth * 16383.0f);
        } else {
            f32 normDepth = depth * 0.5f + 0.5f;
            depthBits = static_cast<u32>(normDepth * 16383.0f);
        }
        u64 depthKey = static_cast<u64>(depthBits & 0x3FFF);

        return stageKey | layerKey | shaderKey | blendKey | flagsKey | texKey | depthKey;
    }

    bool canMergeWith(const DrawCommand& next) const {
        if (shader_id != next.shader_id) return false;
        if (blend_mode != next.blend_mode) return false;
        if (layout_id != next.layout_id) return false;
        if (state_flags != next.state_flags) return false;
        if (state_flags & CMD_STATE_SCISSOR) {
            if (scissor != next.scissor) return false;
        }
        if (state_flags & (CMD_STATE_STENCIL_WRITE | CMD_STATE_STENCIL_TEST)) {
            if (stencil_ref != next.stencil_ref) return false;
        }
        if (texture_count != next.texture_count) return false;
        if (texture_count > 0 &&
            std::memcmp(texture_ids, next.texture_ids,
                        texture_count * sizeof(u32)) != 0) {
            return false;
        }
        if (index_offset + index_count != next.index_offset) return false;
        return true;
    }
};

}  // namespace esengine
